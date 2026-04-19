import {
  type AiConfigInput,
  type AiModelConfigInput,
  type AiModelVariantConfig,
  type AiProviderType,
  type DeliveryConfigInput,
  type EmailMessageConfig as SchemaEmailMessageConfig,
  ENTRY_FIELD_KEYS,
  FEED_FIELD_KEYS,
  type FileDeliveryConfig,
  type HttpPayload as SchemaHttpPayload,
  type LogConsoleFormat as SchemaLogConsoleFormat,
  type LogConsoleSinkConfig as SchemaLogConsoleSinkConfig,
  type LogFileFormat as SchemaLogFileFormat,
  type LogFileRotationConfig as SchemaLogFileRotationConfig,
  type LogFileSinkConfig as SchemaLogFileSinkConfig,
  type LogLevel as SchemaLogLevel,
  type LoggingConfigInput,
  type PushConfig,
  type SourceConfigInput,
  type SummarySourceConfig,
  type SqliteConfigInput,
  type SqliteJournalMode as SchemaSqliteJournalMode,
  type SqliteRetentionVacuumMode as SchemaSqliteRetentionVacuumMode,
} from './schema.ts'

export type LogLevel = SchemaLogLevel
export type LogConsoleFormat = SchemaLogConsoleFormat
export type LogFileFormat = SchemaLogFileFormat
export type LogConsoleSinkConfig = SchemaLogConsoleSinkConfig
export type LogFileSinkConfig = SchemaLogFileSinkConfig
export type LogFileRotationConfig = SchemaLogFileRotationConfig
export type SqliteJournalMode = SchemaSqliteJournalMode
export type SqliteRetentionVacuumMode = SchemaSqliteRetentionVacuumMode
export type EmailMessageConfig = SchemaEmailMessageConfig
export type HttpPayload = SchemaHttpPayload

export interface ConfigDocument {
  language?: string
  timezone?: string
  timestampFormat?: string
  sqlite?: SqliteConfigInput
  ai?: AiConfigInput
  deliveries?: Record<string, DeliveryConfigInput>
  sources?: Record<string, SourceConfigInput>
  logging?: LoggingConfigInput
}

export interface LoggingConfigResolved {
  level: LogLevel
  sinks: {
    console?: LogConsoleSinkConfig
    file?: LogFileSinkConfig
  }
}

export interface SqliteRetentionConfigResolved {
  maxAge: string
  maxEntriesPerSource: number
  vacuum: SqliteRetentionVacuumMode
}

export interface SqliteConfigResolved {
  path: string
  busyTimeout: string
  journalMode: SqliteJournalMode
  retention: SqliteRetentionConfigResolved
}

export interface HttpDeliveryConfig {
  push: PushConfig
}

export type DeliveryConfig = DeliveryConfigInput & { id: string }

export interface ResolvedDeliveryConfig extends Omit<DeliveryConfig, 'id'> {
  id: string
  sourceId: string
  deliveryId: DeliveryConfig['id']
}

export type UnifiedFeedField = (typeof FEED_FIELD_KEYS)[number]
export type UnifiedEntryField = (typeof ENTRY_FIELD_KEYS)[number]

export interface UnifiedFeedFields {
  title: string
  link: string
  description: string
  generator: string
  language: string
  published: string
}

export interface UnifiedEntryFields {
  id: string
  title: string
  link: string
  description: string
  content: string
  published: string
  updated: string
}

export type AiModelVariantResolved = AiModelVariantConfig

export interface AiModelResolved extends Omit<AiModelConfigInput, 'variants'> {
  id: string
  providerId: string
  providerType: AiProviderType
  ref: string
  variants: Record<string, AiModelVariantResolved>
}

export interface AiProviderResolved extends Omit<
  NonNullable<AiConfigInput['providers'][string]>,
  'models'
> {
  id: string
  models: AiModelResolved[]
}

export interface AiModelRefResolved {
  ref: string
  providerId: string
  modelId: string
}

export interface AiConfigResolved {
  providers: AiProviderResolved[]
  defaultModel?: AiModelRefResolved
  modelRefs: Record<string, AiModelRefResolved>
}

export interface SourceFileDeliveryOverride {
  content?: FileDeliveryConfig['content']
}

export interface SourcePushDeliveryOverride {
  payload?: HttpPayload
}

export interface SourceEmailDeliveryOverride {
  message?: Partial<EmailMessageConfig>
}

export type SourceDeliveryOverride =
  | SourceFileDeliveryOverride
  | SourcePushDeliveryOverride
  | SourceEmailDeliveryOverride

export type SourceDeliveriesConfig = Record<string, SourceDeliveryOverride>

export interface ResolvedSummarySourceConfig extends SummarySourceConfig {}

export interface ResolvedSourceConfig extends Omit<
  SourceConfigInput,
  'enabled' | 'deliveries' | 'summary'
> {
  id: string
  enabled: boolean
  deliveries: ResolvedDeliveryConfig[]
  summary?: ResolvedSummarySourceConfig
}

export interface AppConfigResolved {
  runtimeDir: string
  language: string
  timezone: string
  timestampFormat: string
  sqlite: SqliteConfigResolved
  ai?: AiConfigResolved
  deliveries: DeliveryConfig[]
  sources: ResolvedSourceConfig[]
  logging: LoggingConfigResolved
}
