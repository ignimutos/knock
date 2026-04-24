import {
  getConfigDocumentLookupFromEnv,
  loadRawConfigDocument,
  type RawConfigDocumentLoadResult,
} from '../config/raw_config_document.ts'
import { redactConfigSecrets } from './config_secret_redaction.ts'
import type {
  AiConfigInput,
  EmailConfig,
  FileDeliveryConfig,
  LoggingConfigInput,
  PushConfig,
  SqliteConfigInput,
} from '../config/schema.ts'
import { buildCurrentReaderOverview, type ReaderOverview } from './reader_overview.ts'
import { loadCompiledConfig } from '../config/load_compiled_config.ts'

export type ConfigWorkbenchDeliveryKind = 'file' | 'push' | 'email'
export type ConfigWorkbenchDeliveryConfig = FileDeliveryConfig | PushConfig | EmailConfig

export interface ConfigWorkbenchOverview {
  reader: ReaderOverview
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toPrettyJson(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

function cloneRedacted<T>(value: T): T {
  return redactConfigSecrets(structuredClone(value))
}

function normalizeWorkbenchIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('配置文件不存在:')) {
    return '未找到 runtime 配置，Config Workbench 暂时无法加载。'
  }

  return '读取 Config Workbench 数据失败，请查看服务端日志。'
}

function getDeliveryKind(config: Record<string, unknown>): ConfigWorkbenchDeliveryKind {
  if (config.file) return 'file'
  if (config.push) return 'push'
  if (config.email) return 'email'
  throw new Error('delivery 未配置投递目标')
}

function buildDeliveries(
  rawDocument: Record<string, unknown>,
): ConfigWorkbenchOverview['deliveries'] {
  const deliveries = rawDocument.deliveries
  if (!isPlainObject(deliveries)) return []

  return Object.entries(deliveries).map(([id, value]) => {
    if (!isPlainObject(value)) {
      throw new Error(`delivery.${id} 配置非法`)
    }

    const kind = getDeliveryKind(value)
    const config = value[kind]
    if (!isPlainObject(config)) {
      throw new Error(`delivery.${id}.${kind} 配置非法`)
    }

    const redactedConfig = cloneRedacted(config)

    return {
      id,
      enabled: value.enabled !== false,
      kind,
      config: redactedConfig as ConfigWorkbenchDeliveryConfig,
      configJson: toPrettyJson(redactedConfig),
    }
  })
}

function buildGlobal(rawDocument: Record<string, unknown>): ConfigWorkbenchOverview['global'] {
  const redactedSqlite = isPlainObject(rawDocument.sqlite)
    ? cloneRedacted(rawDocument.sqlite)
    : undefined
  const redactedLogging = isPlainObject(rawDocument.logging)
    ? cloneRedacted(rawDocument.logging)
    : undefined
  const redactedAi = isPlainObject(rawDocument.ai) ? cloneRedacted(rawDocument.ai) : undefined

  return {
    language: typeof rawDocument.language === 'string' ? rawDocument.language : '',
    timezone: typeof rawDocument.timezone === 'string' ? rawDocument.timezone : '',
    timestampFormat:
      typeof rawDocument.timestampFormat === 'string' ? rawDocument.timestampFormat : '',
    sqlite: redactedSqlite ? (redactedSqlite as SqliteConfigInput) : undefined,
    sqliteJson: toPrettyJson(redactedSqlite),
    logging: redactedLogging ? (redactedLogging as LoggingConfigInput) : undefined,
    loggingJson: toPrettyJson(redactedLogging),
    ai: redactedAi ? (redactedAi as AiConfigInput) : undefined,
    aiJson: toPrettyJson(redactedAi),
  }
}

export async function loadConfigWorkbenchContext(): Promise<{
  rawDocument: RawConfigDocumentLoadResult
  workbench: ConfigWorkbenchOverview
}> {
  const rawDocument = await loadRawConfigDocument(getConfigDocumentLookupFromEnv())
  const loaded = await loadCompiledConfig({
    runtimeDir: rawDocument.runtimeDir,
    configPath: rawDocument.configPath,
    envMode: 'preserve_unknown',
  })
  const reader = await buildCurrentReaderOverview({
    loaded,
    rawDocument: rawDocument.document,
  })

  return {
    rawDocument,
    workbench: {
      reader,
      global: buildGlobal(rawDocument.document),
      deliveries: buildDeliveries(rawDocument.document),
    },
  }
}

export async function loadConfigWorkbenchOverview(): Promise<ConfigWorkbenchOverview> {
  try {
    return (await loadConfigWorkbenchContext()).workbench
  } catch (error) {
    return {
      reader: { sources: [], deliveries: [] },
      global: {
        language: '',
        timezone: '',
        timestampFormat: '',
        sqlite: undefined,
        sqliteJson: '',
        logging: undefined,
        loggingJson: '',
        ai: undefined,
        aiJson: '',
      },
      deliveries: [],
      issue: normalizeWorkbenchIssue(error),
    }
  }
}
