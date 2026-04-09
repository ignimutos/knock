import {
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

export interface ResolvedSourceConfig extends Omit<SourceConfigInput, 'enabled' | 'deliveries'> {
  id: string
  enabled: boolean
  deliveries: ResolvedDeliveryConfig[]
}

export interface AppConfigResolved {
  runtimeDir: string
  timezone: string
  timestampFormat: string
  sqlite: SqliteConfigResolved
  deliveries: Array<{
    id: string
    file?: FileDeliveryConfig
    push?: PushConfig
    email?: EmailConfig
  }>
  sources: ResolvedSourceConfig[]
  logging: LoggingConfigResolved
}
