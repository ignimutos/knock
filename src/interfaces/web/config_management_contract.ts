import { z } from 'zod'

const requiredStringSchema = z.string().trim().min(1)
const optionalStringSchema = z.string().default('')
const optionalBooleanSchema = z.boolean().optional()
const optionalNumberSchema = z.number().optional()
const recordSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown())

const globalConfigUpdateSchema = z
  .object({
    language: optionalStringSchema,
    timezone: optionalStringSchema,
    timestampFormat: optionalStringSchema,
    sqliteMode: z.enum(['structured', 'json']).optional(),
    sqliteJson: optionalStringSchema,
    loggingMode: z.enum(['structured', 'json']).optional(),
    loggingJson: optionalStringSchema,
    aiMode: z.enum(['structured', 'json']).optional(),
    aiJson: optionalStringSchema,
    sqlitePath: z.string().optional(),
    sqliteBusyTimeout: z.string().optional(),
    sqliteJournalMode: z.enum(['WAL', 'DELETE']).optional(),
    sqliteRetentionMaxAge: z.string().optional(),
    sqliteRetentionMaxEntriesPerSource: optionalNumberSchema,
    sqliteRetentionVacuum: z.enum(['off', 'afterPrune']).optional(),
    loggingLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
    loggingConsoleEnabled: optionalBooleanSchema,
    loggingConsoleFormat: z.enum(['pretty', 'jsonl']).optional(),
    loggingFileEnabled: optionalBooleanSchema,
    loggingFilePath: z.string().optional(),
    loggingFileRotationType: z.enum(['size', 'time']).optional(),
    loggingFileRotationMaxSize: z.string().optional(),
    loggingFileRotationMaxFiles: optionalNumberSchema,
    loggingFileRotationInterval: z.enum(['hourly', 'daily', 'weekly']).optional(),
    loggingFileRotationMaxAge: z.string().optional(),
    aiDefaultModel: z.string().optional(),
    aiProviders: recordSchema.optional(),
  })
  .strict()

const deliveryConfigUpdateSchema = z
  .object({
    deliveryId: requiredStringSchema,
    enabled: z.boolean(),
    kind: z.enum(['file', 'push', 'email']),
    configMode: z.enum(['structured', 'json']).optional(),
    configJson: optionalStringSchema,
    filePath: z.string().optional(),
    fileContent: z.string().optional(),
    fileRotationEnabled: optionalBooleanSchema,
    fileRotationSize: z.string().optional(),
    fileRotationAge: z.string().optional(),
    fileRotationBackups: optionalNumberSchema,
    pushUrl: z.string().optional(),
    pushMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(),
    pushHeaders: recordSchema.optional(),
    pushTimeout: z.string().optional(),
    pushProxy: z.string().optional(),
    pushRetryLimit: optionalNumberSchema,
    pushRetryStatusCodes: z.array(z.number()).optional(),
    pushRetryOnTimeout: optionalBooleanSchema,
    pushRetryBackoffLimit: z.string().optional(),
    pushRequestType: z.enum(['query', 'form', 'body']).optional(),
    pushRequestPayload: z.unknown().optional(),
    pushResponsePredicate: z.string().optional(),
    pushResponseMessage: z.string().optional(),
    emailSmtpHost: z.string().optional(),
    emailSmtpPort: optionalNumberSchema,
    emailSmtpSecurity: z.enum(['implicit', 'starttls', 'none']).optional(),
    emailSmtpAuthUsername: z.string().optional(),
    emailSmtpAuthPassword: z.string().optional(),
    emailMessageFrom: z.string().optional(),
    emailMessageTo: z.array(z.string()).optional(),
    emailMessageCc: z.array(z.string()).optional(),
    emailMessageBcc: z.array(z.string()).optional(),
    emailMessageReplyTo: z.array(z.string()).optional(),
    emailMessageSubject: z.string().optional(),
    emailMessageText: z.string().optional(),
    emailMessageHtml: z.string().optional(),
    emailMessageHeaders: recordSchema.optional(),
  })
  .strict()

const deliveryConfigDeleteSchema = z
  .object({
    deliveryId: requiredStringSchema,
  })
  .strict()

export class ConfigManagementContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigManagementContractError'
  }
}

function throwContractValidation(message: string): never {
  throw new ConfigManagementContractError(message)
}

function classifyValidationError(error: z.ZodError): never {
  const issue = error.issues[0]
  throwContractValidation(issue?.message || 'config 请求非法')
}

export function parseGlobalConfigUpdate(input: unknown) {
  const parsed = globalConfigUpdateSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}

export function parseDeliveryConfigUpdate(input: unknown) {
  const parsed = deliveryConfigUpdateSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}

export function parseDeliveryConfigDelete(input: unknown) {
  const parsed = deliveryConfigDeleteSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}
