import { z } from 'zod'
import { attachAiEntryRuntime, getAiEntryRuntime } from '../core/ai_runtime.ts'
import { renderContent } from '../core/content_runtime.ts'
import { getLogFields, type Logger } from '../core/logger.ts'
import type { HttpClient } from '../core/http_client.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import type {
  HttpPayload,
  HttpRequestType,
  PushHttpConfig,
  PushRequestConfig,
  PushResponseConfig,
} from '../config/schema.ts'

export interface HttpDeliveryRequest {
  deliveryId: string
  http: PushHttpConfig
  request: PushRequestConfig
  response?: PushResponseConfig
  templateContext?: Record<string, unknown>
}

export interface HttpDeliveryFactoryOptions {
  logger?: Logger
  httpClient: HttpClient
  renderContent?: (template: string, context: Record<string, unknown>) => Promise<string>
}

export interface HttpDelivery {
  push(req: HttpDeliveryRequest): Promise<void>
}

const queryPayloadSchema = z.union([z.string(), z.record(z.string(), z.unknown())])
const formPayloadSchema = z.record(z.string(), z.unknown())

type HttpDeliveryFailureReason =
  | 'transport_error'
  | 'response_parse_error'
  | 'response_predicate_render_error'
  | 'response_message_render_error'
  | 'response_predicate_false'
  | 'http_status_not_ok'

type AnnotatedHttpDeliveryError = Error & {
  safeLogMessage?: string
  logMessage?: string
  deliveryReason?: HttpDeliveryFailureReason
  httpStatus?: number
}

function buildQueryString(payload: HttpPayload | undefined): string {
  if (payload === undefined) return ''

  const parsed = parseWithFirstIssue(
    queryPayloadSchema,
    payload,
    'HTTP query payload 必须是对象或字符串',
  )
  if (typeof parsed === 'string') return parsed

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(parsed)) {
    params.append(key, value === null ? '' : String(value))
  }
  return params.toString()
}

function stringifyFormValue(value: unknown): string {
  if (value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function buildBody(type: HttpRequestType, payload: HttpPayload | undefined): BodyInit | undefined {
  if (payload === undefined) return undefined
  if (type === 'query') return undefined
  if (type === 'form') {
    const parsed = parseWithFirstIssue(formPayloadSchema, payload, 'HTTP form payload 必须是对象')
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(parsed)) {
      params.append(key, stringifyFormValue(value))
    }
    return params.toString()
  }
  if (typeof payload === 'string') return payload
  return JSON.stringify(payload)
}

function buildRequestInit(req: HttpDeliveryRequest): { url: string; init: RequestInit } {
  const headers = new Headers(req.http.headers ?? {})

  let url = req.http.url
  if (req.request.type === 'query') {
    const query = buildQueryString(req.request.payload)
    if (query) {
      url = `${url}${url.includes('?') ? '&' : '?'}${query}`
    }
  }

  const body = buildBody(req.request.type, req.request.payload)
  if (req.request.type === 'form' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
  }
  if (req.request.type === 'body' && body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return {
    url,
    init: {
      method: req.http.method,
      headers,
      body,
    },
  }
}

async function normalizeResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('Content-Type') ?? ''
  const bodyText = await response.text()
  let body: unknown = bodyText
  if (contentType.includes('application/json') && bodyText) {
    body = JSON.parse(bodyText)
  }

  return {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}

function buildResponseTemplateContext(
  response: Record<string, unknown>,
  templateContext?: Record<string, unknown>,
): Record<string, unknown> {
  const mergedContext = {
    ...templateContext,
    ...response,
  }
  return attachAiEntryRuntime(
    mergedContext,
    templateContext ? getAiEntryRuntime(templateContext) : undefined,
  )
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function annotateError(
  error: unknown,
  params: {
    safeLogMessage: string
    deliveryReason?: HttpDeliveryFailureReason
    httpStatus?: number
  },
): AnnotatedHttpDeliveryError {
  const nextError = toError(error) as AnnotatedHttpDeliveryError
  nextError.safeLogMessage = params.safeLogMessage
  nextError.deliveryReason = params.deliveryReason
  if (params.httpStatus !== undefined) {
    nextError.httpStatus = params.httpStatus
  }
  return nextError
}

function createFailureError(params: {
  message: string
  logMessage?: string
  safeLogMessage: string
  deliveryReason: HttpDeliveryFailureReason
  httpStatus: number
}): AnnotatedHttpDeliveryError {
  const error = new Error(params.message) as AnnotatedHttpDeliveryError
  error.name = 'HttpDeliveryError'
  error.safeLogMessage = params.safeLogMessage
  error.logMessage = params.logMessage
  error.deliveryReason = params.deliveryReason
  error.httpStatus = params.httpStatus
  return error
}

export function createHttpDelivery(options: HttpDeliveryFactoryOptions): HttpDelivery {
  const renderTemplate = options.renderContent ?? renderContent

  return {
    async push(req: HttpDeliveryRequest): Promise<void> {
      const logFields = {
        ...(req.templateContext ? (getLogFields(req.templateContext) ?? {}) : {}),
        'delivery.id': req.deliveryId,
      }

      options.logger?.info('HTTP 推送开始', {
        'delivery.operation': 'push',
        'delivery.outcome': 'start',
        ...logFields,
      })

      try {
        const { url, init } = buildRequestInit(req)
        const response = await options.httpClient
          .request({
            transport: req.http,
            request: url,
            init,
          })
          .catch((error) => {
            throw annotateError(error, {
              safeLogMessage: 'HTTP 推送失败: transport_error',
              deliveryReason: 'transport_error',
            })
          })
        const predicate = req.response?.predicate
        const messageTemplate = req.response?.message
        const safeMessage = `HTTP 推送失败: status=${response.status}`

        let responseContextPromise: Promise<Record<string, unknown>> | undefined
        const getResponseContext = (): Promise<Record<string, unknown>> => {
          if (!responseContextPromise) {
            responseContextPromise = normalizeResponse(response)
              .then((normalized) => buildResponseTemplateContext(normalized, req.templateContext))
              .catch((error) => {
                throw annotateError(error, {
                  safeLogMessage: 'HTTP 推送失败: response_parse_error',
                  deliveryReason: 'response_parse_error',
                  httpStatus: response.status,
                })
              })
          }
          return responseContextPromise
        }

        if (predicate) {
          const responseContext = await getResponseContext()
          const passed = await renderTemplate(predicate, responseContext)
            .then((value) => value.trim() === 'true')
            .catch((error) => {
              throw annotateError(error, {
                safeLogMessage: 'HTTP 推送失败: response_predicate_render_error',
                deliveryReason: 'response_predicate_render_error',
                httpStatus: response.status,
              })
            })

          if (!passed) {
            const message = messageTemplate
              ? await renderTemplate(messageTemplate, responseContext).catch((error) => {
                  throw annotateError(error, {
                    safeLogMessage: 'HTTP 推送失败: response_message_render_error',
                    deliveryReason: 'response_message_render_error',
                    httpStatus: response.status,
                  })
                })
              : safeMessage
            throw createFailureError({
              message,
              logMessage: messageTemplate ? message : undefined,
              safeLogMessage: safeMessage,
              deliveryReason: 'response_predicate_false',
              httpStatus: response.status,
            })
          }
        } else if (!response.ok) {
          const message = messageTemplate
            ? await getResponseContext().then((responseContext) =>
                renderTemplate(messageTemplate, responseContext).catch((error) => {
                  throw annotateError(error, {
                    safeLogMessage: 'HTTP 推送失败: response_message_render_error',
                    deliveryReason: 'response_message_render_error',
                    httpStatus: response.status,
                  })
                }),
              )
            : safeMessage
          throw createFailureError({
            message,
            logMessage: messageTemplate ? message : undefined,
            safeLogMessage: safeMessage,
            deliveryReason: 'http_status_not_ok',
            httpStatus: response.status,
          })
        }

        options.logger?.info('HTTP 推送成功', {
          'delivery.operation': 'push',
          'delivery.outcome': 'success',
          ...logFields,
          http_status: response.status,
        })
      } catch (error) {
        const annotatedError = error as AnnotatedHttpDeliveryError
        options.logger?.error('HTTP 推送失败', {
          'delivery.operation': 'push',
          'delivery.outcome': 'failure',
          ...(annotatedError.deliveryReason
            ? { 'delivery.reason': annotatedError.deliveryReason }
            : {}),
          ...logFields,
          ...(annotatedError.httpStatus !== undefined
            ? { http_status: annotatedError.httpStatus }
            : {}),
          error_name: annotatedError.name,
          error_message:
            annotatedError.logMessage ??
            annotatedError.safeLogMessage ??
            (annotatedError.message.trim() ? annotatedError.message : 'HTTP 推送失败'),
        })
        throw annotatedError
      }
    },
  }
}
