import { getPostRenderValidator } from '../config/capabilities.ts'
import type { HttpPayload } from '../config/schema.ts'
import type { ResolvedDeliveryConfig } from '../config/types.ts'
import type { ContentContext } from '../core/content_runtime.ts'
import { getLogFields, type Logger } from '../core/logger.ts'
import type { EmailDeliveryRequest } from './email.ts'
import type { FileDeliveryRequest } from './file.ts'
import type { HttpDeliveryRequest } from './http.ts'

export interface DeliveryRuntime {
  push(delivery: ResolvedDeliveryConfig, templateContext: ContentContext): Promise<void>
  getDeliveryId(delivery: ResolvedDeliveryConfig): string
}

export interface DeliveryRuntimeDependencies {
  logger?: Logger
  contentRuntime: {
    renderContent(template: string, context: ContentContext): Promise<string>
    renderPayload(
      payload: HttpPayload | undefined,
      context: ContentContext,
    ): Promise<HttpPayload | undefined>
  }
  fileDelivery: {
    push(req: FileDeliveryRequest & { templateContext?: ContentContext }): Promise<void>
  }
  httpDelivery: { push(req: HttpDeliveryRequest): Promise<void> }
  emailDelivery: { push(req: EmailDeliveryRequest): Promise<void> }
}

function buildFileDeliveryRequest(
  delivery: ResolvedDeliveryConfig & {
    file: NonNullable<ResolvedDeliveryConfig['file']>
  },
  content: string,
  templateContext: ContentContext,
): FileDeliveryRequest & { templateContext?: ContentContext } {
  return {
    path: delivery.file.path,
    content,
    rotation: delivery.file.rotation,
    templateContext,
  }
}

function selectContentTemplate(delivery: ResolvedDeliveryConfig): string {
  return delivery.file?.content ?? '{{ entry.title }}'
}

function getDeliveryLogFields(
  delivery: ResolvedDeliveryConfig,
  templateContext: ContentContext,
): Record<string, unknown> {
  return {
    ...(getLogFields(templateContext) ?? {}),
    'delivery.id': delivery.id,
  }
}

function renderDeliveryContent(
  dependencies: DeliveryRuntimeDependencies,
  delivery: ResolvedDeliveryConfig,
  templateContext: ContentContext,
): Promise<string> {
  return dependencies.contentRuntime.renderContent(selectContentTemplate(delivery), templateContext)
}

async function buildHttpDeliveryRequest(
  dependencies: DeliveryRuntimeDependencies,
  delivery: ResolvedDeliveryConfig & {
    push: NonNullable<ResolvedDeliveryConfig['push']>
  },
  templateContext: ContentContext,
): Promise<HttpDeliveryRequest> {
  const logFields = getDeliveryLogFields(delivery, templateContext)
  const renderedPayload = await dependencies.contentRuntime.renderPayload(
    delivery.push.request.payload,
    templateContext,
  )

  dependencies.logger?.info('delivery payload 渲染完成', {
    module: 'delivery.runtime.render',
    'delivery.operation': 'render_payload',
    'delivery.outcome': 'success',
    ...logFields,
    'delivery.request_type': delivery.push.request.type,
  })

  dependencies.logger?.info('delivery 请求构建完成', {
    module: 'delivery.runtime.build',
    'delivery.operation': 'build_request',
    'delivery.outcome': 'success',
    ...logFields,
  })

  return {
    deliveryId: delivery.id,
    http: {
      method: delivery.push.http.method,
      url: delivery.push.http.url,
      timeout: delivery.push.http.timeout,
      headers: delivery.push.http.headers ? { ...delivery.push.http.headers } : undefined,
      proxy: delivery.push.http.proxy,
    },
    request: {
      type: delivery.push.request.type,
      payload: renderedPayload,
    },
    response: delivery.push.response ? { ...delivery.push.response } : undefined,
    templateContext,
  }
}

function validateRenderedValue(path: string, value: string): void {
  const validator = getPostRenderValidator(path)
  if (!validator) return

  const trimmed = value.trim()
  if (validator === 'non-empty' && trimmed === '') {
    throw new Error(`${path} 渲染结果不能为空`)
  }
  if (validator === 'email-address' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error(`${path} 渲染结果不是合法邮箱地址: ${value}`)
  }
}

async function renderStringArray(
  values: string[] | undefined,
  dependencies: DeliveryRuntimeDependencies,
  templateContext: ContentContext,
  capabilityPath: string,
): Promise<string[] | undefined> {
  if (!values) return undefined

  const rendered = await Promise.all(
    values.map((value) => dependencies.contentRuntime.renderContent(value, templateContext)),
  )
  rendered.forEach((value) => validateRenderedValue(capabilityPath, value))
  return rendered
}

async function buildEmailDeliveryRequest(
  dependencies: DeliveryRuntimeDependencies,
  delivery: ResolvedDeliveryConfig & {
    email: NonNullable<ResolvedDeliveryConfig['email']>
  },
  templateContext: ContentContext,
): Promise<EmailDeliveryRequest> {
  const from = await dependencies.contentRuntime.renderContent(
    delivery.email.message.from,
    templateContext,
  )
  validateRenderedValue('deliveries.*.email.message.from', from)

  const subject = await dependencies.contentRuntime.renderContent(
    delivery.email.message.subject,
    templateContext,
  )
  validateRenderedValue('deliveries.*.email.message.subject', subject)

  return {
    deliveryId: delivery.id,
    templateContext,
    smtp: {
      ...delivery.email.smtp,
      auth: delivery.email.smtp.auth ? { ...delivery.email.smtp.auth } : undefined,
    },
    message: {
      from,
      to:
        (await renderStringArray(
          delivery.email.message.to,
          dependencies,
          templateContext,
          'deliveries.*.email.message.to[]',
        )) ?? [],
      cc: await renderStringArray(
        delivery.email.message.cc,
        dependencies,
        templateContext,
        'deliveries.*.email.message.cc[]',
      ),
      bcc: await renderStringArray(
        delivery.email.message.bcc,
        dependencies,
        templateContext,
        'deliveries.*.email.message.bcc[]',
      ),
      replyTo: await renderStringArray(
        delivery.email.message.replyTo,
        dependencies,
        templateContext,
        'deliveries.*.email.message.replyTo[]',
      ),
      subject,
      text:
        delivery.email.message.text === undefined
          ? undefined
          : await dependencies.contentRuntime.renderContent(
              delivery.email.message.text,
              templateContext,
            ),
      html:
        delivery.email.message.html === undefined
          ? undefined
          : await dependencies.contentRuntime.renderContent(
              delivery.email.message.html,
              templateContext,
            ),
      headers: delivery.email.message.headers
        ? Object.fromEntries(
            await Promise.all(
              Object.entries(delivery.email.message.headers).map(async ([key, value]) => [
                key,
                await dependencies.contentRuntime.renderContent(value, templateContext),
              ]),
            ),
          )
        : undefined,
    },
  }
}

export function createDeliveryRuntime(dependencies: DeliveryRuntimeDependencies): DeliveryRuntime {
  return {
    getDeliveryId(delivery: ResolvedDeliveryConfig): string {
      return delivery.id
    },

    async push(delivery: ResolvedDeliveryConfig, templateContext: ContentContext): Promise<void> {
      const logFields = getDeliveryLogFields(delivery, templateContext)

      if (delivery.file) {
        const renderedContent = await renderDeliveryContent(dependencies, delivery, templateContext)
        dependencies.logger?.info('delivery 内容渲染完成', {
          module: 'delivery.runtime.render',
          'delivery.operation': 'render_content',
          'delivery.outcome': 'success',
          ...logFields,
        })
        dependencies.logger?.info('delivery 请求构建完成', {
          module: 'delivery.runtime.build',
          'delivery.operation': 'build_request',
          'delivery.outcome': 'success',
          ...logFields,
        })
        await dependencies.fileDelivery.push(
          buildFileDeliveryRequest(
            delivery as ResolvedDeliveryConfig & {
              file: NonNullable<ResolvedDeliveryConfig['file']>
            },
            renderedContent,
            templateContext,
          ),
        )
        dependencies.logger?.info('delivery 已分发', {
          module: 'delivery.runtime.dispatch',
          'delivery.operation': 'dispatch',
          'delivery.outcome': 'success',
          ...logFields,
        })
        return
      }

      if (delivery.push) {
        await dependencies.httpDelivery.push(
          await buildHttpDeliveryRequest(
            dependencies,
            delivery as ResolvedDeliveryConfig & {
              push: NonNullable<ResolvedDeliveryConfig['push']>
            },
            templateContext,
          ),
        )
        dependencies.logger?.info('delivery 已分发', {
          module: 'delivery.runtime.dispatch',
          'delivery.operation': 'dispatch',
          'delivery.outcome': 'success',
          ...logFields,
        })
        return
      }

      if (delivery.email) {
        const emailRequest = await buildEmailDeliveryRequest(
          dependencies,
          delivery as ResolvedDeliveryConfig & {
            email: NonNullable<ResolvedDeliveryConfig['email']>
          },
          templateContext,
        )
        dependencies.logger?.info('delivery 消息渲染完成', {
          module: 'delivery.runtime.render',
          'delivery.operation': 'render_message',
          'delivery.outcome': 'success',
          ...logFields,
        })
        dependencies.logger?.info('delivery 请求构建完成', {
          module: 'delivery.runtime.build',
          'delivery.operation': 'build_request',
          'delivery.outcome': 'success',
          ...logFields,
        })
        await dependencies.emailDelivery.push(emailRequest)
        dependencies.logger?.info('delivery 已分发', {
          module: 'delivery.runtime.dispatch',
          'delivery.operation': 'dispatch',
          'delivery.outcome': 'success',
          ...logFields,
        })
        return
      }

      throw new Error(`delivery 未配置投递目标: ${delivery.id}`)
    },
  }
}
