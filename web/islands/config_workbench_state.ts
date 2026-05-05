import type {
  EmailConfig,
  FileDeliveryConfig,
  HttpMethod,
  HttpPayload,
  HttpRequestType,
  PushConfig,
} from '../../src/config/schema.ts'
import type { SourceDeliveryOverride } from '../../src/config/types.ts'
import type {
  ConfigWorkbenchDeliveryConfig,
  ConfigWorkbenchOverview,
} from '../../src/web/config_workbench_overview.ts'
import type {
  ReaderDeliveryCatalogItem,
  ReaderOverview,
  ReaderSourceOverview,
} from '../../src/web/reader_overview.ts'

export type DeliveryKind = ConfigWorkbenchOverview['deliveries'][number]['kind']

export type DeliveryDraft = {
  id: string
  enabled: boolean
  kind: DeliveryKind
  config: ConfigWorkbenchDeliveryConfig
  configJson: string
  isDraft?: boolean
}

type GlobalMode = 'structured' | 'json'
type DeliveryMode = 'structured' | 'json'

export interface SourceFormState {
  id: string
  name: string
  enabled: boolean
  schedule: string
  filter: string
  transport: ReaderSourceOverview['transport']
  parser: ReaderSourceOverview['parser']
  targetUrl: string
  xqueryLocate: string
  xqueryEntryId: string
  deliveryIds: string[]
  deliveryOverrides: Record<string, string>
}

export interface GlobalFormState {
  language: string
  timezone: string
  timestampFormat: string
  sqliteMode: GlobalMode
  sqlitePath: string
  sqliteBusyTimeout: string
  sqliteJournalMode: 'WAL' | 'DELETE'
  sqliteRetentionMaxAge: string
  sqliteRetentionMaxEntriesPerSource: string
  sqliteRetentionVacuum: 'off' | 'afterPrune'
  sqliteJson: string
  loggingMode: GlobalMode
  loggingLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  loggingConsoleEnabled: boolean
  loggingConsoleFormat: 'pretty' | 'jsonl'
  loggingFileEnabled: boolean
  loggingFilePath: string
  loggingFileRotationType: '' | 'size' | 'time'
  loggingFileRotationMaxSize: string
  loggingFileRotationMaxFiles: string
  loggingFileRotationInterval: '' | 'hourly' | 'daily' | 'weekly'
  loggingFileRotationMaxAge: string
  loggingJson: string
  aiMode: GlobalMode
  aiDefaultModel: string
  aiProvidersJson: string
  aiJson: string
}

export interface DeliveryFormState {
  id: string
  enabled: boolean
  kind: DeliveryKind
  mode: DeliveryMode
  configJson: string
  filePath: string
  fileContent: string
  fileRotationEnabled: boolean
  fileRotationSize: string
  fileRotationAge: string
  fileRotationBackups: string
  pushUrl: string
  pushMethod: HttpMethod
  pushHeadersJson: string
  pushTimeout: string
  pushProxy: string
  pushRetryLimit: string
  pushRetryStatusCodes: string
  pushRetryOnTimeout: boolean
  pushRetryBackoffLimit: string
  pushRequestType: HttpRequestType
  pushRequestPayloadJson: string
  pushResponsePredicate: string
  pushResponseMessage: string
  emailSmtpHost: string
  emailSmtpPort: string
  emailSmtpSecurity: EmailConfig['smtp']['security']
  emailSmtpAuthUsername: string
  emailSmtpAuthPassword: string
  emailMessageFrom: string
  emailMessageTo: string
  emailMessageCc: string
  emailMessageBcc: string
  emailMessageReplyTo: string
  emailMessageSubject: string
  emailMessageText: string
  emailMessageHtml: string
  emailMessageHeadersJson: string
}

function getOverrideTextareaValue(
  kind: ReaderDeliveryCatalogItem['kind'],
  override: SourceDeliveryOverride | undefined,
): string {
  if (!override) return ''

  if (kind === 'file') {
    return 'content' in override && typeof override.content === 'string' ? override.content : ''
  }

  if (kind === 'push') {
    return 'payload' in override && override.payload !== undefined
      ? JSON.stringify(override.payload, null, 2)
      : ''
  }

  return 'message' in override && override.message !== undefined
    ? JSON.stringify(override.message, null, 2)
    : ''
}

function parseJsonObject<T>(value: string, fieldName: string): T {
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(
      `${fieldName} 必须是合法 JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是对象`)
  }

  return parsed as T
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function parseIntOrUndefined(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return Number.parseInt(trimmed, 10)
}

function parseNumberArray(value: string): number[] | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined

  return trimmed
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => !Number.isNaN(item))
}

function linesToArray(value: string): string[] | undefined {
  const next = value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item !== '')

  return next.length > 0 ? next : undefined
}

export function createGlobalFormState(global: ConfigWorkbenchOverview['global']): GlobalFormState {
  const sqlite = global.sqlite
  const logging = global.logging
  const ai = global.ai
  const fileSink = logging?.sinks?.file
  const fileRotation = fileSink?.rotation
  const fileRotationType = fileRotation?.type ?? ''
  const fileRotationMaxSize = fileRotation?.type === 'size' ? fileRotation.maxSize : ''
  const fileRotationMaxFiles = fileRotation?.type === 'size' ? String(fileRotation.maxFiles) : ''
  const fileRotationInterval = fileRotation?.type === 'time' ? fileRotation.interval : ''
  const fileRotationMaxAge = fileRotation?.type === 'time' ? fileRotation.maxAge : ''

  return {
    language: global.language,
    timezone: global.timezone,
    timestampFormat: global.timestampFormat,
    sqliteMode: 'structured',
    sqlitePath: sqlite?.path ?? '',
    sqliteBusyTimeout: sqlite?.busyTimeout ?? '',
    sqliteJournalMode: sqlite?.journalMode ?? 'WAL',
    sqliteRetentionMaxAge: sqlite?.retention?.maxAge ?? '',
    sqliteRetentionMaxEntriesPerSource:
      sqlite?.retention?.maxEntriesPerSource !== undefined
        ? String(sqlite.retention.maxEntriesPerSource)
        : '',
    sqliteRetentionVacuum: sqlite?.retention?.vacuum ?? 'off',
    sqliteJson: global.sqliteJson,
    loggingMode: 'structured',
    loggingLevel: logging?.level ?? 'info',
    loggingConsoleEnabled: Boolean(logging?.sinks?.console),
    loggingConsoleFormat: logging?.sinks?.console?.format ?? 'pretty',
    loggingFileEnabled: Boolean(fileSink),
    loggingFilePath: fileSink?.path ?? '',
    loggingFileRotationType: fileRotationType,
    loggingFileRotationMaxSize: fileRotationMaxSize,
    loggingFileRotationMaxFiles: fileRotationMaxFiles,
    loggingFileRotationInterval: fileRotationInterval,
    loggingFileRotationMaxAge: fileRotationMaxAge,
    loggingJson: global.loggingJson,
    aiMode: 'structured',
    aiDefaultModel: ai?.defaultModel ?? '',
    aiProvidersJson: stringifyJson(ai?.providers ?? {}),
    aiJson: global.aiJson,
  }
}

export function createDefaultDeliveryConfig(kind: DeliveryKind): ConfigWorkbenchDeliveryConfig {
  if (kind === 'push') {
    return {
      http: {
        url: 'https://example.com',
        method: 'POST',
      },
      request: {
        type: 'body',
      },
    } as PushConfig
  }

  if (kind === 'email') {
    return {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
      },
      message: {
        from: 'noreply@example.com',
        to: ['ops@example.com'],
        subject: '{{ entry.title }}',
        text: '{{ entry.link }}',
      },
    } as EmailConfig
  }

  return {
    path: 'outputs/example.txt',
    content: '{{ entry.title }}',
  } as FileDeliveryConfig
}

export function createDraftDelivery(kind: DeliveryKind = 'file'): DeliveryDraft {
  const config = createDefaultDeliveryConfig(kind)

  return {
    id: '',
    enabled: true,
    kind,
    config,
    configJson: stringifyJson(config),
    isDraft: true,
  }
}

export function createDeliveryFormState(delivery: DeliveryDraft): DeliveryFormState {
  const config = delivery.config
  const fileConfig = delivery.kind === 'file' ? (config as FileDeliveryConfig) : undefined
  const pushConfig = delivery.kind === 'push' ? (config as PushConfig) : undefined
  const emailConfig = delivery.kind === 'email' ? (config as EmailConfig) : undefined

  return {
    id: delivery.id,
    enabled: delivery.enabled,
    kind: delivery.kind,
    mode: 'structured',
    configJson: delivery.configJson,
    filePath: fileConfig?.path ?? '',
    fileContent: fileConfig?.content ?? '',
    fileRotationEnabled: Boolean(fileConfig?.rotation?.enabled),
    fileRotationSize: fileConfig?.rotation?.size ?? '',
    fileRotationAge: fileConfig?.rotation?.age ?? '',
    fileRotationBackups:
      fileConfig?.rotation?.backups !== undefined ? String(fileConfig.rotation.backups) : '',
    pushUrl: pushConfig?.http.url ?? '',
    pushMethod: pushConfig?.http.method ?? 'POST',
    pushHeadersJson: stringifyJson(pushConfig?.http.headers ?? {}),
    pushTimeout: pushConfig?.http.timeout ?? '',
    pushProxy: pushConfig?.http.proxy ?? '',
    pushRetryLimit:
      pushConfig?.http.retry?.limit !== undefined ? String(pushConfig.http.retry.limit) : '',
    pushRetryStatusCodes: Array.isArray(pushConfig?.http.retry?.statusCodes)
      ? pushConfig.http.retry.statusCodes.join(', ')
      : '',
    pushRetryOnTimeout: pushConfig?.http.retry?.retryOnTimeout ?? true,
    pushRetryBackoffLimit: pushConfig?.http.retry?.backoffLimit ?? '',
    pushRequestType: pushConfig?.request?.type ?? 'body',
    pushRequestPayloadJson: stringifyJson(pushConfig?.request?.payload ?? {}),
    pushResponsePredicate: pushConfig?.response?.predicate ?? '',
    pushResponseMessage: pushConfig?.response?.message ?? '',
    emailSmtpHost: emailConfig?.smtp.host ?? '',
    emailSmtpPort: emailConfig?.smtp.port !== undefined ? String(emailConfig.smtp.port) : '',
    emailSmtpSecurity: emailConfig?.smtp.security ?? 'starttls',
    emailSmtpAuthUsername: emailConfig?.smtp.auth?.username ?? '',
    emailSmtpAuthPassword: emailConfig?.smtp.auth?.password ?? '',
    emailMessageFrom: emailConfig?.message.from ?? '',
    emailMessageTo: emailConfig?.message.to?.join('\n') ?? '',
    emailMessageCc: emailConfig?.message.cc?.join('\n') ?? '',
    emailMessageBcc: emailConfig?.message.bcc?.join('\n') ?? '',
    emailMessageReplyTo: emailConfig?.message.replyTo?.join('\n') ?? '',
    emailMessageSubject: emailConfig?.message.subject ?? '',
    emailMessageText: emailConfig?.message.text ?? '',
    emailMessageHtml: emailConfig?.message.html ?? '',
    emailMessageHeadersJson: stringifyJson(emailConfig?.message.headers ?? {}),
  }
}

export function createSourceFormState(source: ReaderSourceOverview): SourceFormState {
  const deliveryOverrides = Object.fromEntries(
    Object.entries(source.deliveryOverrides).map(([deliveryId, override]) => {
      const kind = source.deliveryKinds[source.deliveryIds.indexOf(deliveryId)]
      return [deliveryId, getOverrideTextareaValue(kind ?? 'file', override)]
    }),
  )

  return {
    id: source.id,
    name: source.name,
    enabled: source.enabled,
    schedule: source.schedule ?? '',
    filter: source.filter ?? '',
    transport: source.transport,
    parser: source.parser,
    targetUrl: source.sourceUrl ?? '',
    xqueryLocate: source.xqueryLocate ?? '',
    xqueryEntryId: source.xqueryEntryId ?? '',
    deliveryIds: [...source.deliveryIds],
    deliveryOverrides,
  }
}

export function buildGlobalPayload(state: GlobalFormState): {
  language: string
  timezone: string
  timestampFormat: string
  sqliteMode: GlobalMode
  sqliteJson: string
  sqlitePath: string
  sqliteBusyTimeout: string
  sqliteJournalMode: 'WAL' | 'DELETE'
  sqliteRetentionMaxAge: string
  sqliteRetentionMaxEntriesPerSource: number | undefined
  sqliteRetentionVacuum: 'off' | 'afterPrune'
  loggingMode: GlobalMode
  loggingJson: string
  loggingLevel: GlobalFormState['loggingLevel']
  loggingConsoleEnabled: boolean
  loggingConsoleFormat: GlobalFormState['loggingConsoleFormat']
  loggingFileEnabled: boolean
  loggingFilePath: string
  loggingFileRotationType: GlobalFormState['loggingFileRotationType'] | undefined
  loggingFileRotationMaxSize: string
  loggingFileRotationMaxFiles: number | undefined
  loggingFileRotationInterval: GlobalFormState['loggingFileRotationInterval'] | undefined
  loggingFileRotationMaxAge: string
  aiMode: GlobalMode
  aiJson: string
  aiDefaultModel: string
  aiProviders: Record<string, unknown> | undefined
} {
  return {
    language: state.language,
    timezone: state.timezone,
    timestampFormat: state.timestampFormat,
    sqliteMode: state.sqliteMode,
    sqliteJson: state.sqliteJson,
    sqlitePath: state.sqlitePath,
    sqliteBusyTimeout: state.sqliteBusyTimeout,
    sqliteJournalMode: state.sqliteJournalMode,
    sqliteRetentionMaxAge: state.sqliteRetentionMaxAge,
    sqliteRetentionMaxEntriesPerSource: parseIntOrUndefined(
      state.sqliteRetentionMaxEntriesPerSource,
    ),
    sqliteRetentionVacuum: state.sqliteRetentionVacuum,
    loggingMode: state.loggingMode,
    loggingJson: state.loggingJson,
    loggingLevel: state.loggingLevel,
    loggingConsoleEnabled: state.loggingConsoleEnabled,
    loggingConsoleFormat: state.loggingConsoleFormat,
    loggingFileEnabled: state.loggingFileEnabled,
    loggingFilePath: state.loggingFilePath,
    loggingFileRotationType: state.loggingFileRotationType || undefined,
    loggingFileRotationMaxSize: state.loggingFileRotationMaxSize,
    loggingFileRotationMaxFiles: parseIntOrUndefined(state.loggingFileRotationMaxFiles),
    loggingFileRotationInterval: state.loggingFileRotationInterval || undefined,
    loggingFileRotationMaxAge: state.loggingFileRotationMaxAge,
    aiMode: state.aiMode,
    aiJson: state.aiJson,
    aiDefaultModel: state.aiDefaultModel,
    aiProviders:
      state.aiMode === 'structured'
        ? parseJsonObject<Record<string, unknown>>(state.aiProvidersJson, 'ai.providers')
        : undefined,
  }
}

export function buildDeliveryPayload(state: DeliveryFormState): {
  deliveryId: string
  enabled: boolean
  kind: DeliveryKind
  configMode: DeliveryMode
  configJson: string
  filePath: string
  fileContent: string
  fileRotationEnabled: boolean
  fileRotationSize: string
  fileRotationAge: string
  fileRotationBackups: number | undefined
  pushUrl: string
  pushMethod: HttpMethod
  pushHeaders: Record<string, string> | undefined
  pushTimeout: string
  pushProxy: string
  pushRetryLimit: number | undefined
  pushRetryStatusCodes: number[] | undefined
  pushRetryOnTimeout: boolean
  pushRetryBackoffLimit: string
  pushRequestType: HttpRequestType
  pushRequestPayload: HttpPayload | undefined
  pushResponsePredicate: string
  pushResponseMessage: string
  emailSmtpHost: string
  emailSmtpPort: number | undefined
  emailSmtpSecurity: EmailConfig['smtp']['security']
  emailSmtpAuthUsername: string
  emailSmtpAuthPassword: string
  emailMessageFrom: string
  emailMessageTo: string[] | undefined
  emailMessageCc: string[] | undefined
  emailMessageBcc: string[] | undefined
  emailMessageReplyTo: string[] | undefined
  emailMessageSubject: string
  emailMessageText: string
  emailMessageHtml: string
  emailMessageHeaders: Record<string, string> | undefined
} {
  return {
    deliveryId: state.id,
    enabled: state.enabled,
    kind: state.kind,
    configMode: state.mode,
    configJson: state.configJson,
    filePath: state.filePath,
    fileContent: state.fileContent,
    fileRotationEnabled: state.fileRotationEnabled,
    fileRotationSize: state.fileRotationSize,
    fileRotationAge: state.fileRotationAge,
    fileRotationBackups: parseIntOrUndefined(state.fileRotationBackups),
    pushUrl: state.pushUrl,
    pushMethod: state.pushMethod,
    pushHeaders:
      state.mode === 'structured'
        ? parseJsonObject<Record<string, string>>(state.pushHeadersJson, 'push.headers')
        : undefined,
    pushTimeout: state.pushTimeout,
    pushProxy: state.pushProxy,
    pushRetryLimit: parseIntOrUndefined(state.pushRetryLimit),
    pushRetryStatusCodes: parseNumberArray(state.pushRetryStatusCodes),
    pushRetryOnTimeout: state.pushRetryOnTimeout,
    pushRetryBackoffLimit: state.pushRetryBackoffLimit,
    pushRequestType: state.pushRequestType,
    pushRequestPayload:
      state.mode === 'structured'
        ? parseJsonObject<HttpPayload>(state.pushRequestPayloadJson, 'push.request.payload')
        : undefined,
    pushResponsePredicate: state.pushResponsePredicate,
    pushResponseMessage: state.pushResponseMessage,
    emailSmtpHost: state.emailSmtpHost,
    emailSmtpPort: parseIntOrUndefined(state.emailSmtpPort),
    emailSmtpSecurity: state.emailSmtpSecurity,
    emailSmtpAuthUsername: state.emailSmtpAuthUsername,
    emailSmtpAuthPassword: state.emailSmtpAuthPassword,
    emailMessageFrom: state.emailMessageFrom,
    emailMessageTo: linesToArray(state.emailMessageTo),
    emailMessageCc: linesToArray(state.emailMessageCc),
    emailMessageBcc: linesToArray(state.emailMessageBcc),
    emailMessageReplyTo: linesToArray(state.emailMessageReplyTo),
    emailMessageSubject: state.emailMessageSubject,
    emailMessageText: state.emailMessageText,
    emailMessageHtml: state.emailMessageHtml,
    emailMessageHeaders:
      state.mode === 'structured'
        ? parseJsonObject<Record<string, string>>(
            state.emailMessageHeadersJson,
            'email.message.headers',
          )
        : undefined,
  }
}

export function buildSourcePayload(
  state: SourceFormState,
  allDeliveries: ReaderOverview['deliveries'],
): {
  sourceId: string
  name: string
  enabled: boolean
  schedule: string
  filter: string
  deliveryIds: string[]
  deliveryOverrides: Record<string, SourceDeliveryOverride>
  transport: ReaderSourceOverview['transport']
  parser: ReaderSourceOverview['parser']
  targetUrl: string
  xqueryLocate: string
  xqueryEntryId: string
} {
  const deliveryOverrides: Record<string, SourceDeliveryOverride> = {}

  for (const deliveryId of state.deliveryIds) {
    const kind = allDeliveries.find((delivery) => delivery.id === deliveryId)?.kind
    const raw = state.deliveryOverrides[deliveryId]?.trim() ?? ''

    if (kind === 'file') {
      deliveryOverrides[deliveryId] =
        raw === '' ? {} : { content: state.deliveryOverrides[deliveryId] }
      continue
    }

    if (raw === '') {
      deliveryOverrides[deliveryId] = {}
      continue
    }

    const parsed = parseJsonObject<Record<string, unknown>>(raw, `${deliveryId} override`)
    deliveryOverrides[deliveryId] = kind === 'push' ? { payload: parsed } : { message: parsed }
  }

  return {
    sourceId: state.id,
    name: state.name,
    enabled: state.enabled,
    schedule: state.schedule,
    filter: state.filter,
    deliveryIds: state.deliveryIds,
    deliveryOverrides,
    transport: state.transport,
    parser: state.parser,
    targetUrl: state.targetUrl,
    xqueryLocate: state.xqueryLocate,
    xqueryEntryId: state.xqueryEntryId,
  }
}
