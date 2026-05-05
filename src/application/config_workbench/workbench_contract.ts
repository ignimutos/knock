import { z } from 'zod'

import type {
  AiConfigInput,
  EmailConfig,
  FileDeliveryConfig,
  LoggingConfigInput,
  PushConfig,
  SqliteConfigInput,
} from '../../config/schema.ts'
import type { SourceDeliveryOverride } from '../../config/types.ts'

const requiredStringSchema = z.string().trim().min(1)
const optionalStringSchema = z.string().default('')
const optionalBooleanSchema = z.boolean().optional()
const optionalNumberSchema = z.number().optional()
const recordSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown())

export interface ConfigWorkbenchReaderRunSummary {
  runId: string
  status: string
  startedAt: string
  finishedAt?: string
  counts: {
    fetchedCount: number
    parsedCount: number
    filteredCount: number
    duplicateItemCount: number
    deliveredCount: number
    failedAttemptCount: number
    skippedCount: number
  }
}

export interface ConfigWorkbenchReaderFeedSnapshot {
  title: string
  link: string
  description: string
  generator: string
  language: string
  published: string
}

export interface ConfigWorkbenchReaderEntrySnapshot {
  itemId: string
  status: string
  id: string
  title: string
  link: string
  description: string
  content: string
  published: string
  updated: string
}

export interface ConfigWorkbenchReaderSourceOverview {
  id: string
  name: string
  enabled: boolean
  schedule?: string
  filter?: string
  parser: 'syndication' | 'xquery' | 'summary'
  transport: 'http' | 'byparr' | 'summary'
  sourceUrl?: string
  xqueryLocate?: string
  xqueryEntryId?: string
  deliveryCount: number
  deliveryIds: string[]
  deliveryKinds: Array<'file' | 'push' | 'email'>
  deliveryOverrides: Record<string, SourceDeliveryOverride>
  lastRun?: ConfigWorkbenchReaderRunSummary
  feed?: ConfigWorkbenchReaderFeedSnapshot
  entries: ConfigWorkbenchReaderEntrySnapshot[]
}

export interface ConfigWorkbenchReaderDeliveryCatalogItem {
  id: string
  kind: 'file' | 'push' | 'email'
}

export interface ConfigWorkbenchReaderOverview {
  sources: ConfigWorkbenchReaderSourceOverview[]
  deliveries: ConfigWorkbenchReaderDeliveryCatalogItem[]
  issue?: string
}

export type ConfigWorkbenchDeliveryKind = 'file' | 'push' | 'email'
export type ConfigWorkbenchDeliveryConfig = FileDeliveryConfig | PushConfig | EmailConfig

export interface ConfigWorkbenchOverview {
  reader: ConfigWorkbenchReaderOverview
  global: {
    language: string
    timezone: string
    timestampFormat: string
    sqlite?: SqliteConfigInput
    sqliteJson: string
    logging?: LoggingConfigInput
    loggingJson: string
    ai?: AiConfigInput
    aiJson: string
  }
  deliveries: Array<{
    id: string
    enabled: boolean
    kind: ConfigWorkbenchDeliveryKind
    config: ConfigWorkbenchDeliveryConfig
    configJson: string
  }>
  issue?: string
}

export const globalConfigUpdateSchema = z
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

export type GlobalConfigUpdateInput = z.infer<typeof globalConfigUpdateSchema>

export const deliveryConfigUpdateSchema = z
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

export type DeliveryConfigUpdateInput = z.infer<typeof deliveryConfigUpdateSchema>

export const deliveryConfigDeleteSchema = z
  .object({
    deliveryId: requiredStringSchema,
  })
  .strict()

export type DeliveryConfigDeleteInput = z.infer<typeof deliveryConfigDeleteSchema>
