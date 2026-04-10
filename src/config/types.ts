import {
  type AiConfigInput,
  type AiModelConfigInput,
  type AiModelVariantConfig,
  type AiProviderType,
  type DeliveryConfigInput,
  type EmailConfig,
  ENTRY_FIELD_KEYS,
  FEED_FIELD_KEYS,
  type FileDeliveryConfig,
  type LogConsoleSinkConfig as SchemaLogConsoleSinkConfig,
  type LogFormat as SchemaLogFormat,
  type LogLevel as SchemaLogLevel,
  type PushConfig,
  type SourceConfigInput,
  type SqliteJournalMode as SchemaSqliteJournalMode,
  type SqliteRetentionVacuumMode as SchemaSqliteRetentionVacuumMode,
} from './schema.ts'

export type LogLevel = SchemaLogLevel
export type LogFormat = SchemaLogFormat
export type LogConsoleSinkConfig = SchemaLogConsoleSinkConfig
export type SqliteJournalMode = SchemaSqliteJournalMode
export type SqliteRetentionVacuumMode = SchemaSqliteRetentionVacuumMode

export interface LoggingConfigResolved {
  level: LogLevel
  format: LogFormat
  sinks: {
    console?: LogConsoleSinkConfig
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
export type ResolvedDeliveryConfig = DeliveryConfig

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

export interface ResolvedSourceConfig extends Omit<SourceConfigInput, 'enabled' | 'deliveries'> {
  id: string
  enabled: boolean
  deliveries: ResolvedDeliveryConfig[]
}

export interface AppConfigResolved {
  runtimeDir: string
  language: string
  timezone: string
  timestampFormat: string
  sqlite: SqliteConfigResolved
  ai?: AiConfigResolved
  deliveries: Array<{
    id: string
    file?: FileDeliveryConfig
    push?: PushConfig
    email?: EmailConfig
  }>
  sources: ResolvedSourceConfig[]
  logging: LoggingConfigResolved
}
