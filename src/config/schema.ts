import { CronPattern } from 'croner'
import { z } from 'zod'
import {
  createInvalidIssueMessage,
  ISSUE_BODY_PAYLOAD_FORBIDDEN,
  ISSUE_BOOLEAN,
  ISSUE_DEPRECATED_DELIVERY_HTTP,
  ISSUE_ILLEGAL,
  ISSUE_INTEGER,
  ISSUE_REQUIRED,
  ISSUE_SOURCE_PARSER_CONFLICT,
  ISSUE_SOURCE_PUSH_FORBIDDEN,
  ISSUE_SOURCE_TRANSPORT_CONFLICT,
  ISSUE_SOURCE_TRANSPORT_REQUIRED,
  ISSUE_STRING_ARRAY,
  ISSUE_EMAIL_MESSAGE_CONTENT_REQUIRED,
} from './issue_codes.ts'
import { getConfigFieldCapability } from './capabilities.ts'
import { assertLiquidCapability } from './liquid_capabilities.ts'
import { isRuntimeDuration } from './runtime_semantics.ts'
import { assertLiquidTemplateSyntax } from '../core/liquid_runtime.ts'

export const FEED_FIELD_KEYS = [
  'title',
  'link',
  'description',
  'generator',
  'language',
  'published',
] as const
export const ENTRY_FIELD_KEYS = [
  'id',
  'title',
  'link',
  'description',
  'content',
  'published',
  'updated',
] as const

function requiredString() {
  return z.string({ error: ISSUE_REQUIRED }).superRefine((value, ctx) => {
    if (value.trim() === '') {
      ctx.addIssue({ code: 'custom', message: ISSUE_REQUIRED, input: value })
    }
  })
}

function optionalBoolean() {
  return z.boolean({ error: ISSUE_BOOLEAN }).optional()
}

function stringArraySchema() {
  return z.custom<string[]>(
    (value) => {
      return (
        Array.isArray(value) &&
        value.every((item) => typeof item === 'string' && item.trim() !== '')
      )
    },
    { message: ISSUE_STRING_ARRAY },
  )
}

function createDurationSchema(path: string, options: { allowDays?: boolean } = {}) {
  return z.string().superRefine((value, ctx) => {
    if (!isRuntimeDuration(value, options)) {
      ctx.addIssue({
        code: 'custom',
        message: `${path} 配置非法: ${String(value)}`,
      })
    }
  })
}

function createEnumSchema<const T extends readonly [string, ...string[]]>(
  values: T,
): z.ZodType<T[number]> {
  return z.string().superRefine((value, ctx) => {
    if (!values.includes(value)) {
      ctx.addIssue({
        code: 'custom',
        message: createInvalidIssueMessage(value),
      })
    }
  }) as unknown as z.ZodType<T[number]>
}

function createLiteralSchema<T extends string>(expected: T): z.ZodType<T> {
  return z.string().superRefine((value, ctx) => {
    if (value !== expected) {
      ctx.addIssue({
        code: 'custom',
        message: createInvalidIssueMessage(value),
      })
    }
  }) as unknown as z.ZodType<T>
}

function createProxySchema() {
  const allowedProtocols = ['http:', 'https:', 'socks5:'] as const

  return z.string().superRefine((value, ctx) => {
    try {
      const parsed = new URL(value)
      if (!allowedProtocols.includes(parsed.protocol as (typeof allowedProtocols)[number])) {
        ctx.addIssue({
          code: 'custom',
          message: createInvalidIssueMessage(value),
        })
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: createInvalidIssueMessage(value),
      })
    }
  })
}

export const httpPayloadSchema: z.ZodType<
  string | number | boolean | null | Array<unknown> | Record<string, unknown>
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(httpPayloadSchema),
    z.record(z.string(), httpPayloadSchema),
  ]),
)

function validateLiquidTemplate(
  template: string,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  capabilityPath?: string,
): void {
  if (capabilityPath) {
    try {
      assertLiquidCapability(capabilityPath, template)
    } catch (error) {
      ctx.addIssue({
        path,
        code: 'custom',
        message: createInvalidIssueMessage(error instanceof Error ? error.message : String(error)),
      })
      return
    }

    const capability = getConfigFieldCapability(capabilityPath)
    if (capability && !capability.allowLiquid) {
      return
    }
  }

  try {
    assertLiquidTemplateSyntax(template)
  } catch (error) {
    ctx.addIssue({
      path,
      code: 'custom',
      message: createInvalidIssueMessage(error instanceof Error ? error.message : String(error)),
    })
  }
}

function validateLiquidPayload(
  value: unknown,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  capabilityPath?: string,
): void {
  if (typeof value === 'string') {
    validateLiquidTemplate(value, ctx, path, capabilityPath)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateLiquidPayload(item, ctx, [...path, index], capabilityPath)
    })
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      validateLiquidPayload(child, ctx, [...path, key], capabilityPath)
    }
  }
}

function createMappingSchema(
  allowedKeys?: readonly string[],
  options: { validateLiquid?: boolean; capabilityPath?: string } = {},
) {
  return z.record(z.string(), z.string()).superRefine((mapping, ctx) => {
    for (const [key, value] of Object.entries(mapping)) {
      if (options.validateLiquid) {
        validateLiquidTemplate(value, ctx, [key], options.capabilityPath)
      }

      if (allowedKeys && !allowedKeys.includes(key)) {
        ctx.addIssue({
          path: [key],
          code: 'custom',
          message: ISSUE_ILLEGAL,
        })
      }
    }
  })
}

export const timezoneSchema = requiredString().superRefine((value, ctx) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: `timezone 配置非法: ${String(value)}`,
    })
  }
})

export const loggingConsoleSchema = z
  .object({
    type: createLiteralSchema('console').default('console'),
  })
  .strict()
  .prefault({})

export const loggingSchema = z
  .object({
    level: createEnumSchema(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    format: createEnumSchema(['json', 'pretty']).default('json'),
    sinks: z
      .object({
        console: loggingConsoleSchema,
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .prefault({})

export const sqliteRetentionSchema = z
  .object({
    maxAge: createDurationSchema('sqlite.retention.maxAge', { allowDays: true }).default('180d'),
    maxEntriesPerSource: z
      .number()
      .superRefine((value, ctx) => {
        if (!Number.isInteger(value) || value <= 0) {
          ctx.addIssue({
            code: 'custom',
            message: `sqlite.retention.maxEntriesPerSource 配置非法: ${String(value)}`,
          })
        }
      })
      .default(1000),
    vacuum: createEnumSchema(['off', 'afterPrune']).default('off'),
  })
  .strict()
  .prefault({})

export const sqliteSchema = z
  .object({
    path: requiredString().default('knock.db'),
    busyTimeout: createDurationSchema('sqlite.busyTimeout').default('5s'),
    journalMode: createEnumSchema(['WAL', 'DELETE']).default('WAL'),
    retention: sqliteRetentionSchema,
  })
  .strict()
  .prefault({})

export const rotationSchema = z
  .object({
    enabled: optionalBoolean(),
    size: z
      .string()
      .superRefine((value, ctx) => {
        if (
          !value
            .trim()
            .toLowerCase()
            .match(/^(\d+)(b|k|m|g)$/)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `delivery.file.rotation.size 配置非法: ${String(value)}`,
          })
        }
      })
      .optional(),
    age: createDurationSchema('delivery.file.rotation.age', { allowDays: true }).optional(),
    backups: z
      .number()
      .optional()
      .superRefine((value, ctx) => {
        if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
          ctx.addIssue({
            code: 'custom',
            message: 'delivery.file.rotation.backups 必须是正整数',
          })
        }
      }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.enabled === true && value.size === undefined && value.age === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'delivery.file.rotation 启用时必须至少配置 size 或 age',
      })
    }
  })

export const fileSchema = z
  .object({
    path: requiredString(),
    content: requiredString(),
    rotation: rotationSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateLiquidTemplate(value.content, ctx, ['content'], 'deliveries.*.file.content')
  })

function createTemplateStringArraySchema(capabilityPath: string) {
  return stringArraySchema().superRefine((items, ctx) => {
    items.forEach((item, index) => {
      validateLiquidTemplate(item, ctx, [index], capabilityPath)
    })
  })
}

const emailSmtpAuthSchema = z
  .object({
    username: requiredString(),
    password: requiredString(),
  })
  .strict()

export const emailSmtpSchema = z
  .object({
    host: requiredString(),
    port: z
      .number({ error: ISSUE_INTEGER })
      .int({ message: ISSUE_INTEGER })
      .superRefine((value, ctx) => {
        if (value < 1 || value > 65535) {
          ctx.addIssue({
            code: 'custom',
            message: createInvalidIssueMessage(String(value)),
          })
        }
      }),
    security: createEnumSchema(['implicit', 'starttls', 'none']),
    auth: emailSmtpAuthSchema.optional(),
  })
  .strict()

export const emailMessageSchema = z
  .object({
    from: requiredString(),
    to: createTemplateStringArraySchema('deliveries.*.email.message.to[]'),
    cc: createTemplateStringArraySchema('deliveries.*.email.message.cc[]').optional(),
    bcc: createTemplateStringArraySchema('deliveries.*.email.message.bcc[]').optional(),
    replyTo: createTemplateStringArraySchema('deliveries.*.email.message.replyTo[]').optional(),
    subject: requiredString(),
    text: z.string().optional(),
    html: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateLiquidTemplate(value.from, ctx, ['from'], 'deliveries.*.email.message.from')
    validateLiquidTemplate(value.subject, ctx, ['subject'], 'deliveries.*.email.message.subject')
    if (value.text !== undefined) {
      validateLiquidTemplate(value.text, ctx, ['text'], 'deliveries.*.email.message.text')
    }
    if (value.html !== undefined) {
      validateLiquidTemplate(value.html, ctx, ['html'], 'deliveries.*.email.message.html')
    }
    if (value.headers) {
      for (const [key, headerValue] of Object.entries(value.headers)) {
        validateLiquidTemplate(
          headerValue,
          ctx,
          ['headers', key],
          'deliveries.*.email.message.headers.*',
        )
      }
    }
    if (value.text === undefined && value.html === undefined) {
      ctx.addIssue({
        path: [],
        code: 'custom',
        message: ISSUE_EMAIL_MESSAGE_CONTENT_REQUIRED,
      })
    }
  })

export const emailSchema = z
  .object({
    smtp: emailSmtpSchema,
    message: emailMessageSchema,
  })
  .strict()

const retryStatusCodeSchema = z
  .number({ error: ISSUE_INTEGER })
  .int({ message: ISSUE_INTEGER })
  .superRefine((value, ctx) => {
    if (value < 100 || value > 599) {
      ctx.addIssue({
        code: 'custom',
        message: createInvalidIssueMessage(String(value)),
      })
    }
  })

export const transportRetrySchema = z
  .object({
    limit: z
      .number({ error: ISSUE_INTEGER })
      .int({ message: ISSUE_INTEGER })
      .superRefine((value, ctx) => {
        if (value < 1) {
          ctx.addIssue({
            code: 'custom',
            message: createInvalidIssueMessage(String(value)),
          })
        }
      })
      .default(2),
    statusCodes: z.array(retryStatusCodeSchema).default([408, 429, 500, 502, 503, 504]),
    retryOnTimeout: z.boolean({ error: ISSUE_BOOLEAN }).default(true),
    backoffLimit: createDurationSchema('transport.retry.backoffLimit').default('3s'),
  })
  .strict()

export const transportSchema = z
  .object({
    timeout: createDurationSchema('transport.timeout').optional(),
    headers: z.record(z.string(), z.string()).optional(),
    proxy: createProxySchema().optional(),
    retry: transportRetrySchema.optional(),
  })
  .strict()

export const pushHttpSchema = transportSchema
  .extend({
    method: createEnumSchema(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
      .optional()
      .default('POST'),
    url: requiredString(),
  })
  .superRefine((value, ctx) => {
    validateLiquidTemplate(value.url, ctx, ['url'], 'deliveries.*.push.http.url')
    if (value.headers) {
      for (const [key, headerValue] of Object.entries(value.headers)) {
        validateLiquidTemplate(
          headerValue,
          ctx,
          ['headers', key],
          'deliveries.*.push.http.headers.*',
        )
      }
    }
  })

export const sourceHttpSchema = transportSchema
  .extend({
    url: requiredString(),
  })
  .superRefine((value, ctx) => {
    validateLiquidTemplate(value.url, ctx, ['url'], 'sources.*.http.url')
    if (value.headers) {
      for (const [key, headerValue] of Object.entries(value.headers)) {
        validateLiquidTemplate(headerValue, ctx, ['headers', key], 'sources.*.http.headers.*')
      }
    }
  })

export const byparrSchema = z
  .object({
    endpoint: requiredString().default('http://byparr:8191/v1'),
    cmd: createLiteralSchema('request.get').default('request.get'),
    url: requiredString(),
    maxTimeout: createDurationSchema('source.byparr.maxTimeout').default('60s'),
    proxy: createProxySchema().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateLiquidTemplate(value.url, ctx, ['url'], 'sources.*.byparr.url')
  })

export const pushRequestSchema = z
  .object({
    type: createEnumSchema(['query', 'form', 'body']).optional().default('body'),
    payload: httpPayloadSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateLiquidPayload(value.payload, ctx, ['payload'], 'deliveries.*.push.request.payload.**')
  })

export const pushResponseSchema = z
  .object({
    predicate: z.string().optional(),
    message: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.predicate !== undefined) {
      validateLiquidTemplate(
        value.predicate,
        ctx,
        ['predicate'],
        'deliveries.*.push.response.predicate',
      )
    }
    if (value.message !== undefined) {
      validateLiquidTemplate(value.message, ctx, ['message'], 'deliveries.*.push.response.message')
    }
  })

export const pushSchema = z
  .object({
    http: pushHttpSchema,
    request: pushRequestSchema.optional().default({ type: 'body' }),
    response: pushResponseSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.http.method === 'GET' || value.http.method === 'HEAD') &&
      value.request.type === 'body' &&
      value.request.payload !== undefined
    ) {
      ctx.addIssue({
        path: ['request', 'payload'],
        code: 'custom',
        message: ISSUE_BODY_PAYLOAD_FORBIDDEN,
      })
    }
  })

export const syndicationSchema = z
  .object({
    feed: createMappingSchema(undefined, {
      validateLiquid: true,
      capabilityPath: 'sources.*.syndication.feed.*',
    }).optional(),
    entry: createMappingSchema(undefined, {
      validateLiquid: true,
      capabilityPath: 'sources.*.syndication.entry.*',
    }).optional(),
  })
  .strict()

export const xquerySchema = z
  .object({
    locate: requiredString().optional(),
    feed: z.union([createMappingSchema(FEED_FIELD_KEYS), requiredString()]).optional(),
    entry: z.union([createMappingSchema(ENTRY_FIELD_KEYS), requiredString()]).optional(),
    namespaces: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.entry) {
      ctx.addIssue({
        path: ['entry', 'id'],
        code: 'custom',
        message: ISSUE_REQUIRED,
      })
      return
    }

    if (typeof value.entry === 'string') {
      return
    }

    if (!value.entry.id || value.entry.id.trim() === '') {
      ctx.addIssue({
        path: ['entry', 'id'],
        code: 'custom',
        message: ISSUE_REQUIRED,
      })
    }
  })

export const deliverySchema = z
  .object({
    file: fileSchema.optional(),
    http: z.unknown().optional(),
    push: pushSchema.optional(),
    email: emailSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const targetCount = [value.file, value.push, value.email].filter(Boolean).length

    if (targetCount > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'delivery 不能同时配置 file、push 与 email',
      })
      return
    }

    if (!value.file && !value.push && !value.email) {
      ctx.addIssue({
        code: 'custom',
        message: 'delivery 未配置投递目标',
      })
      return
    }

    if (value.http !== undefined) {
      ctx.addIssue({
        path: ['http'],
        code: 'custom',
        message: ISSUE_DEPRECATED_DELIVERY_HTTP,
      })
    }
  })

export const sourceSchema = z
  .object({
    name: z.string().optional(),
    enabled: optionalBoolean(),
    schedule: z.string().optional(),
    deliveries: stringArraySchema().optional(),
    filter: z.string().optional(),
    http: sourceHttpSchema.optional(),
    byparr: byparrSchema.optional(),
    syndication: syndicationSchema.optional(),
    xquery: xquerySchema.optional(),
    push: z.unknown().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.push !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: ISSUE_SOURCE_PUSH_FORBIDDEN,
      })
      return
    }

    if (value.schedule !== undefined) {
      if (value.schedule.trim() === '') {
        ctx.addIssue({
          path: ['schedule'],
          code: 'custom',
          message: ISSUE_REQUIRED,
        })
        return
      }

      try {
        new CronPattern(value.schedule)
      } catch {
        ctx.addIssue({
          path: ['schedule'],
          code: 'custom',
          message: `source.schedule 配置非法: ${value.schedule}`,
        })
        return
      }
    }

    if (value.filter !== undefined && value.filter.trim() !== '') {
      validateLiquidTemplate(value.filter, ctx, ['filter'], 'sources.*.filter')
    }

    if (value.syndication && value.xquery) {
      ctx.addIssue({
        code: 'custom',
        message: ISSUE_SOURCE_PARSER_CONFLICT,
      })
    }

    if (value.http && value.byparr) {
      ctx.addIssue({
        code: 'custom',
        message: ISSUE_SOURCE_TRANSPORT_CONFLICT,
      })
      return
    }

    if (!value.http && !value.byparr) {
      ctx.addIssue({
        code: 'custom',
        message: ISSUE_SOURCE_TRANSPORT_REQUIRED,
      })
    }
  })

export const deliveriesSchema = z.record(z.string(), deliverySchema)
export const sourcesSchema = z.record(z.string(), sourceSchema)

function validateAppConfigReferences(
  value: {
    deliveries?: Record<string, DeliveryConfigInput>
    sources?: Record<string, SourceConfigInput>
  },
  ctx: z.core.$RefinementCtx,
) {
  const deliveryIds = new Set(Object.keys(value.deliveries ?? {}))

  for (const [sourceId, source] of Object.entries(value.sources ?? {})) {
    for (const deliveryId of source.deliveries ?? []) {
      if (!deliveryIds.has(deliveryId)) {
        ctx.addIssue({
          code: 'custom',
          message: `source.${sourceId}.deliveries 引用了未定义 delivery: ${deliveryId}`,
        })
      }
    }
  }
}

const userAppConfigShape = {
  timezone: timezoneSchema.optional(),
  timestampFormat: requiredString().default('yyyy-MM-dd HH:mm:ss'),
  sqlite: sqliteSchema,
  deliveries: deliveriesSchema.optional(),
  sources: sourcesSchema.optional(),
  logging: loggingSchema,
} satisfies z.ZodRawShape

export const userAppConfigContractSchema = z.object(userAppConfigShape).strict()

export const userAppConfigSchema = userAppConfigContractSchema.superRefine(
  validateAppConfigReferences,
)

export const appConfigSchema = z
  .object({
    runtimeDir: z.string(),
    ...userAppConfigShape,
  })
  .strict()
  .superRefine(validateAppConfigReferences)

export const appConfigValidatedSchema = appConfigSchema.transform((input) => ({
  __validated: true as const,
  runtimeDir: input.runtimeDir,
  timezone: input.timezone,
  timestampFormat: input.timestampFormat,
  sqlite: input.sqlite,
  deliveries: input.deliveries ?? {},
  sources: input.sources ?? {},
  logging: input.logging,
}))

export const rawConfigSyntaxSchema = z.string().superRefine((raw, ctx) => {
  const lines = raw.split('\n')
  const blockPaths = [
    { path: 'deliveries', indent: 0 },
    { path: 'sources', indent: 0 },
  ]

  for (const block of blockPaths) {
    const blockKey = block.path.split('.').at(-1)
    if (!blockKey) continue

    let startIndex = -1
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const indent = line.match(/^\s*/)?.[0].length ?? 0
      if (indent !== block.indent) continue
      if (line.trim() === `${blockKey}:`) {
        startIndex = i
        break
      }
    }
    if (startIndex === -1) continue

    let hasArrayStyle = false
    let hasObjectStyle = false
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim() === '') continue
      const indent = line.match(/^\s*/)?.[0].length ?? 0
      if (indent <= block.indent) break

      const relative = line.slice(block.indent + 2)
      if (/^-\s+/.test(relative)) hasArrayStyle = true
      if (/^[A-Za-z0-9_-]+:\s*/.test(relative)) hasObjectStyle = true
      if (hasArrayStyle && hasObjectStyle) {
        ctx.addIssue({
          code: 'custom',
          message: '不允许混用对象写法和数组写法',
        })
        return
      }
    }
  }
})

export const phase1ConfigSchema = z.record(z.string(), z.unknown()).superRefine((parsed, ctx) => {
  if (parsed.templates !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'templates 已迁移到 deliveries.*.(file|push).content',
    })
    return
  }
  if (parsed.destinations !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'destinations 已迁移到 deliveries',
    })
    return
  }

  const sources = parsed.sources
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    return
  }

  for (const [sourceId, value] of Object.entries(sources)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const deliveries = (value as Record<string, unknown>).deliveries
    if (!Array.isArray(deliveries)) continue
    for (const delivery of deliveries) {
      if (typeof delivery !== 'string') {
        ctx.addIssue({
          code: 'custom',
          message: `source.${sourceId}.deliveries 已迁移为字符串数组`,
        })
        return
      }
    }
  }
})

export type LogLevel = NonNullable<z.output<typeof loggingSchema>['level']>
export type LogFormat = NonNullable<z.output<typeof loggingSchema>['format']>
export type LogSinkType = z.output<typeof loggingConsoleSchema>['type']
export type LogConsoleSinkConfig = z.output<typeof loggingConsoleSchema>
export type LoggingConfigInput = z.output<typeof loggingSchema>

export type SqliteJournalMode = NonNullable<z.output<typeof sqliteSchema>['journalMode']>
export type SqliteRetentionVacuumMode = NonNullable<
  z.output<typeof sqliteRetentionSchema>['vacuum']
>
export type SqliteConfigInput = z.output<typeof sqliteSchema>

export type FileRotationConfig = z.output<typeof rotationSchema>
export type FileDeliveryConfig = z.output<typeof fileSchema>
export type EmailSmtpAuthConfig = z.output<typeof emailSmtpAuthSchema>
export type EmailSmtpSecurity = z.output<typeof emailSmtpSchema>['security']
export type EmailSmtpConfig = z.output<typeof emailSmtpSchema>
export type EmailMessageConfig = z.output<typeof emailMessageSchema>
export type EmailConfig = z.output<typeof emailSchema>

export type HttpMethod = z.output<typeof pushHttpSchema>['method']
export type HttpRequestType = z.output<typeof pushRequestSchema>['type']
export type HttpPayload = z.output<typeof httpPayloadSchema>
export type HttpRetryConfig = z.output<typeof transportRetrySchema>
export type HttpTransportConfig = z.output<typeof transportSchema>
export type SourceHttpConfig = z.output<typeof sourceHttpSchema>
export type SourceByparrConfig = z.output<typeof byparrSchema>
export type PushHttpConfig = z.output<typeof pushHttpSchema>
export type PushRequestConfig = z.output<typeof pushRequestSchema>

/**
 * @deprecated 仅供 runtime helper 使用；配置契约统一使用 HttpTransportConfig。
 */
export type HttpConfig = HttpTransportConfig

export type PushResponseConfig = z.output<typeof pushResponseSchema>
export type PushConfig = z.output<typeof pushSchema>
export type DeliveryConfigInput = z.output<typeof deliverySchema>
export type SyndicationSourceConfig = z.output<typeof syndicationSchema>
export type XqueryMappingConfig = z.output<typeof xquerySchema>
export type SourceConfigInput = z.output<typeof sourceSchema>
export type AppConfigInput = z.input<typeof appConfigSchema>
export type AppConfigValidated = z.output<typeof appConfigValidatedSchema>
