import { useMemo, useState } from 'preact/hooks'
import type {
  ConfigWorkbenchDeliveryConfig,
  ConfigWorkbenchOverview,
} from '../../src/web/config_workbench_overview.ts'
import type {
  HttpMethod,
  HttpPayload,
  HttpRequestType,
  EmailConfig,
  FileDeliveryConfig,
  PushConfig,
} from '../../src/config/schema.ts'
import type {
  ReaderDeliveryCatalogItem,
  ReaderOverview,
  ReaderSourceOverview,
} from '../../src/web/reader_overview.ts'
import type { SourceDeliveryOverride } from '../../src/config/types.ts'

interface ActionError {
  message: string
}

interface ActionResult<T> {
  data?: T
  error?: ActionError
}

interface ConfigActionSuccessResult {
  message: string
  workbench: ConfigWorkbenchOverview
}

interface SourceActionSuccessResult {
  message: string
  overview: ReaderOverview
}

type DeliveryKind = ConfigWorkbenchOverview['deliveries'][number]['kind']
type WorkbenchDelivery = ConfigWorkbenchOverview['deliveries'][number]

type DeliveryDraft = {
  id: string
  enabled: boolean
  kind: DeliveryKind
  config: ConfigWorkbenchDeliveryConfig
  configJson: string
  isDraft?: boolean
}

type GlobalMode = 'structured' | 'json'
type DeliveryMode = 'structured' | 'json'

interface SourceFormState {
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

interface GlobalFormState {
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

interface DeliveryFormState {
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

function formatDeliveryKinds(kinds: readonly string[] | undefined): string {
  return Array.isArray(kinds) && kinds.length > 0 ? kinds.join(' · ') : '无投递'
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

function deliveryOverrideLabel(kind: ReaderDeliveryCatalogItem['kind']): string {
  switch (kind) {
    case 'file':
      return 'content override'
    case 'push':
      return 'payload override (JSON)'
    default:
      return 'message override (JSON)'
  }
}

function createDefaultDeliveryConfig(kind: DeliveryKind): ConfigWorkbenchDeliveryConfig {
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

function defaultSourceFileOverride(): string {
  return '{{ entry.title }}'
}

function placeholder(value: string, fallback: string): string {
  return value.trim() === '' ? fallback : ''
}

function createDraftDelivery(kind: DeliveryKind = 'file'): DeliveryDraft {
  const config = createDefaultDeliveryConfig(kind)
  return {
    id: '',
    enabled: true,
    kind,
    config,
    configJson: JSON.stringify(config, null, 2),
    isDraft: true,
  }
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

function createGlobalFormState(global: ConfigWorkbenchOverview['global']): GlobalFormState {
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

function createDeliveryFormState(delivery: DeliveryDraft): DeliveryFormState {
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

function createSourceFormState(source: ReaderSourceOverview): SourceFormState {
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

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof body.message === 'string' ? body.message : '请求失败')
  }
  return body as T
}

function buildGlobalPayload(state: GlobalFormState) {
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

function buildDeliveryPayload(state: DeliveryFormState) {
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

function buildSourcePayload(state: SourceFormState, allDeliveries: ReaderOverview['deliveries']) {
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

function GlobalPanel(props: {
  state: GlobalFormState
  saving: boolean
  message: string
  error: string
  onChange: (patch: Partial<GlobalFormState>) => void
  onSave: () => void
}) {
  const state = props.state

  return (
    <section
      id="config-global-panel"
      class="panel reader-manager-panel"
    >
      <div class="reader-manager-head">
        <div>
          <p class="reader-kicker">global</p>
          <h2 class="reader-manager-title">全局配置</h2>
        </div>
      </div>

      <p class="reader-empty">
        结构化字段优先；Advanced JSON 仅用于保留低频键。保存会重写 YAML 文本布局与注释。
      </p>

      <div class="reader-manager-grid">
        <div class="field">
          <label htmlFor="config-global-language">language</label>
          <input
            id="config-global-language"
            class="input"
            value={state.language}
            onInput={(event) => props.onChange({ language: event.currentTarget.value })}
          />
        </div>
        <div class="field">
          <label htmlFor="config-global-timezone">timezone</label>
          <input
            id="config-global-timezone"
            class="input"
            value={state.timezone}
            onInput={(event) => props.onChange({ timezone: event.currentTarget.value })}
          />
        </div>
        <div class="field reader-manager-wide">
          <label htmlFor="config-global-timestamp-format">timestampFormat</label>
          <input
            id="config-global-timestamp-format"
            class="input"
            value={state.timestampFormat}
            onInput={(event) => props.onChange({ timestampFormat: event.currentTarget.value })}
          />
        </div>
      </div>

      <details
        class="xq-section"
        open
      >
        <summary>
          <h2>sqlite</h2>
          <div class="segment-control">
            <label>
              <input
                type="radio"
                name="config-global-sqlite-mode"
                checked={state.sqliteMode === 'structured'}
                onChange={() => props.onChange({ sqliteMode: 'structured' })}
              />
              <span>结构化</span>
            </label>
            <label>
              <input
                type="radio"
                name="config-global-sqlite-mode"
                checked={state.sqliteMode === 'json'}
                onChange={() => props.onChange({ sqliteMode: 'json' })}
              />
              <span>JSON</span>
            </label>
          </div>
        </summary>
        <div
          class="panel"
          style={{ border: '0', borderTop: '1px solid var(--line)', borderRadius: '0 0 16px 16px' }}
        >
          {state.sqliteMode === 'structured' ? (
            <div class="reader-manager-grid">
              <div class="field">
                <label htmlFor="config-global-sqlite-path">sqlite.path</label>
                <input
                  id="config-global-sqlite-path"
                  class="input"
                  value={state.sqlitePath}
                  placeholder={placeholder(state.sqlitePath, 'db/knock.db')}
                  onInput={(event) => props.onChange({ sqlitePath: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-busy-timeout">sqlite.busyTimeout</label>
                <input
                  id="config-global-sqlite-busy-timeout"
                  class="input"
                  value={state.sqliteBusyTimeout}
                  placeholder={placeholder(state.sqliteBusyTimeout, '5s')}
                  onInput={(event) =>
                    props.onChange({ sqliteBusyTimeout: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-journal-mode">sqlite.journalMode</label>
                <select
                  id="config-global-sqlite-journal-mode"
                  class="input"
                  value={state.sqliteJournalMode}
                  onChange={(event) =>
                    props.onChange({
                      sqliteJournalMode: event.currentTarget
                        .value as GlobalFormState['sqliteJournalMode'],
                    })
                  }
                >
                  <option value="WAL">WAL</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-retention-max-age">
                  sqlite.retention.maxAge
                </label>
                <input
                  id="config-global-sqlite-retention-max-age"
                  class="input"
                  value={state.sqliteRetentionMaxAge}
                  placeholder={placeholder(state.sqliteRetentionMaxAge, '180d')}
                  onInput={(event) =>
                    props.onChange({ sqliteRetentionMaxAge: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-retention-max-entries">
                  sqlite.retention.maxEntriesPerSource
                </label>
                <input
                  id="config-global-sqlite-retention-max-entries"
                  class="input"
                  value={state.sqliteRetentionMaxEntriesPerSource}
                  placeholder={placeholder(state.sqliteRetentionMaxEntriesPerSource, '1000')}
                  onInput={(event) =>
                    props.onChange({
                      sqliteRetentionMaxEntriesPerSource: event.currentTarget.value,
                    })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-retention-vacuum">
                  sqlite.retention.vacuum
                </label>
                <select
                  id="config-global-sqlite-retention-vacuum"
                  class="input"
                  value={state.sqliteRetentionVacuum}
                  onChange={(event) =>
                    props.onChange({
                      sqliteRetentionVacuum: event.currentTarget
                        .value as GlobalFormState['sqliteRetentionVacuum'],
                    })
                  }
                >
                  <option value="off">off</option>
                  <option value="afterPrune">afterPrune</option>
                </select>
              </div>
            </div>
          ) : (
            <div class="field reader-manager-wide">
              <label htmlFor="config-global-sqlite-json">sqlite (JSON)</label>
              <textarea
                id="config-global-sqlite-json"
                class="textarea"
                value={state.sqliteJson}
                onInput={(event) => props.onChange({ sqliteJson: event.currentTarget.value })}
              />
            </div>
          )}
        </div>
      </details>

      <details
        class="xq-section"
        open
      >
        <summary>
          <h2>logging</h2>
          <div class="segment-control">
            <label>
              <input
                type="radio"
                name="config-global-logging-mode"
                checked={state.loggingMode === 'structured'}
                onChange={() => props.onChange({ loggingMode: 'structured' })}
              />
              <span>结构化</span>
            </label>
            <label>
              <input
                type="radio"
                name="config-global-logging-mode"
                checked={state.loggingMode === 'json'}
                onChange={() => props.onChange({ loggingMode: 'json' })}
              />
              <span>JSON</span>
            </label>
          </div>
        </summary>
        <div
          class="panel"
          style={{ border: '0', borderTop: '1px solid var(--line)', borderRadius: '0 0 16px 16px' }}
        >
          {state.loggingMode === 'structured' ? (
            <div class="reader-manager-grid">
              <div class="field">
                <label htmlFor="config-global-logging-level">logging.level</label>
                <select
                  id="config-global-logging-level"
                  class="input"
                  value={state.loggingLevel}
                  onChange={(event) =>
                    props.onChange({
                      loggingLevel: event.currentTarget.value as GlobalFormState['loggingLevel'],
                    })
                  }
                >
                  <option value="trace">trace</option>
                  <option value="debug">debug</option>
                  <option value="info">info</option>
                  <option value="warn">warn</option>
                  <option value="error">error</option>
                  <option value="fatal">fatal</option>
                </select>
              </div>
              <label
                class={`reader-check reader-manager-enabled${state.loggingConsoleEnabled ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  class="reader-check-input"
                  checked={state.loggingConsoleEnabled}
                  onChange={(event) =>
                    props.onChange({ loggingConsoleEnabled: event.currentTarget.checked })
                  }
                />
                <span class="reader-check-ui" />
                <span class="reader-check-copy">
                  <span class="reader-check-label">启用 console sink</span>
                </span>
              </label>
              <div class="field">
                <label htmlFor="config-global-logging-console-format">console.format</label>
                <select
                  id="config-global-logging-console-format"
                  class="input"
                  value={state.loggingConsoleFormat}
                  onChange={(event) =>
                    props.onChange({
                      loggingConsoleFormat: event.currentTarget
                        .value as GlobalFormState['loggingConsoleFormat'],
                    })
                  }
                >
                  <option value="pretty">pretty</option>
                  <option value="jsonl">jsonl</option>
                </select>
              </div>
              <label
                class={`reader-check reader-manager-enabled${state.loggingFileEnabled ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  class="reader-check-input"
                  checked={state.loggingFileEnabled}
                  onChange={(event) =>
                    props.onChange({ loggingFileEnabled: event.currentTarget.checked })
                  }
                />
                <span class="reader-check-ui" />
                <span class="reader-check-copy">
                  <span class="reader-check-label">启用 file sink</span>
                </span>
              </label>
              {state.loggingFileEnabled ? (
                <>
                  <div class="field">
                    <label htmlFor="config-global-logging-file-path">file.path</label>
                    <input
                      id="config-global-logging-file-path"
                      class="input"
                      value={state.loggingFilePath}
                      placeholder={placeholder(state.loggingFilePath, 'logs/app.jsonl')}
                      onInput={(event) =>
                        props.onChange({ loggingFilePath: event.currentTarget.value })
                      }
                    />
                  </div>
                  <div class="field">
                    <label htmlFor="config-global-logging-file-rotation-type">
                      file.rotation.type
                    </label>
                    <select
                      id="config-global-logging-file-rotation-type"
                      class="input"
                      value={state.loggingFileRotationType}
                      onChange={(event) =>
                        props.onChange({
                          loggingFileRotationType: event.currentTarget
                            .value as GlobalFormState['loggingFileRotationType'],
                        })
                      }
                    >
                      <option value="">none</option>
                      <option value="size">size</option>
                      <option value="time">time</option>
                    </select>
                  </div>
                  {state.loggingFileRotationType === 'size' ? (
                    <>
                      <div class="field">
                        <label htmlFor="config-global-logging-file-rotation-max-size">
                          file.rotation.maxSize
                        </label>
                        <input
                          id="config-global-logging-file-rotation-max-size"
                          class="input"
                          value={state.loggingFileRotationMaxSize}
                          onInput={(event) =>
                            props.onChange({
                              loggingFileRotationMaxSize: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <div class="field">
                        <label htmlFor="config-global-logging-file-rotation-max-files">
                          file.rotation.maxFiles
                        </label>
                        <input
                          id="config-global-logging-file-rotation-max-files"
                          class="input"
                          value={state.loggingFileRotationMaxFiles}
                          onInput={(event) =>
                            props.onChange({
                              loggingFileRotationMaxFiles: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                    </>
                  ) : null}
                  {state.loggingFileRotationType === 'time' ? (
                    <>
                      <div class="field">
                        <label htmlFor="config-global-logging-file-rotation-interval">
                          file.rotation.interval
                        </label>
                        <select
                          id="config-global-logging-file-rotation-interval"
                          class="input"
                          value={state.loggingFileRotationInterval}
                          onChange={(event) =>
                            props.onChange({
                              loggingFileRotationInterval: event.currentTarget
                                .value as GlobalFormState['loggingFileRotationInterval'],
                            })
                          }
                        >
                          <option value="">select</option>
                          <option value="hourly">hourly</option>
                          <option value="daily">daily</option>
                          <option value="weekly">weekly</option>
                        </select>
                      </div>
                      <div class="field">
                        <label htmlFor="config-global-logging-file-rotation-max-age">
                          file.rotation.maxAge
                        </label>
                        <input
                          id="config-global-logging-file-rotation-max-age"
                          class="input"
                          value={state.loggingFileRotationMaxAge}
                          onInput={(event) =>
                            props.onChange({ loggingFileRotationMaxAge: event.currentTarget.value })
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <div class="field reader-manager-wide">
              <label htmlFor="config-global-logging-json">logging (JSON)</label>
              <textarea
                id="config-global-logging-json"
                class="textarea"
                value={state.loggingJson}
                onInput={(event) => props.onChange({ loggingJson: event.currentTarget.value })}
              />
            </div>
          )}
        </div>
      </details>

      <details class="xq-section">
        <summary>
          <h2>ai</h2>
          <div class="segment-control">
            <label>
              <input
                type="radio"
                name="config-global-ai-mode"
                checked={state.aiMode === 'structured'}
                onChange={() => props.onChange({ aiMode: 'structured' })}
              />
              <span>结构化</span>
            </label>
            <label>
              <input
                type="radio"
                name="config-global-ai-mode"
                checked={state.aiMode === 'json'}
                onChange={() => props.onChange({ aiMode: 'json' })}
              />
              <span>JSON</span>
            </label>
          </div>
        </summary>
        <div
          class="panel"
          style={{ border: '0', borderTop: '1px solid var(--line)', borderRadius: '0 0 16px 16px' }}
        >
          {state.aiMode === 'structured' ? (
            <div class="reader-manager-grid">
              <div class="field reader-manager-wide">
                <label htmlFor="config-global-ai-default-model">ai.defaultModel</label>
                <input
                  id="config-global-ai-default-model"
                  class="input"
                  value={state.aiDefaultModel}
                  onInput={(event) => props.onChange({ aiDefaultModel: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-global-ai-providers-json">ai.providers (JSON)</label>
                <textarea
                  id="config-global-ai-providers-json"
                  class="textarea"
                  value={state.aiProvidersJson}
                  onInput={(event) =>
                    props.onChange({ aiProvidersJson: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          ) : (
            <div class="field reader-manager-wide">
              <label htmlFor="config-global-ai-json">ai (JSON)</label>
              <textarea
                id="config-global-ai-json"
                class="textarea"
                value={state.aiJson}
                onInput={(event) => props.onChange({ aiJson: event.currentTarget.value })}
              />
            </div>
          )}
        </div>
      </details>

      <div class="toolbar reader-manager-actions">
        <button
          type="button"
          class="btn btn-primary"
          id="config-global-save"
          disabled={props.saving}
          onClick={props.onSave}
        >
          {props.saving ? '保存中…' : '保存 Global'}
        </button>
      </div>

      {props.message ? (
        <p
          id="config-global-message"
          class="reader-manager-message is-success"
        >
          {props.message}
        </p>
      ) : null}
      {props.error ? (
        <p
          id="config-global-error"
          class="reader-manager-message is-error"
        >
          {props.error}
        </p>
      ) : null}
    </section>
  )
}

function DeliveryForm(props: {
  state: DeliveryFormState
  saving: boolean
  deleting: boolean
  message: string
  error: string
  canDelete: boolean
  onChange: (patch: Partial<DeliveryFormState>) => void
  onSave: () => void
  onDelete: () => void
}) {
  const state = props.state

  return (
    <section
      id="config-delivery-manager"
      class="panel reader-manager-panel"
    >
      <div class="reader-manager-head">
        <div>
          <p class="reader-kicker">deliveries</p>
          <h2
            id="config-delivery-title"
            class="reader-manager-title"
          >
            {state.id || '新建 delivery'}
          </h2>
        </div>
        <span
          id="config-delivery-enabled-badge"
          class={`reader-state-badge is-${state.enabled ? 'enabled' : 'disabled'}`}
        >
          {state.enabled ? '启用' : '停用'}
        </span>
      </div>

      <p class="reader-empty">结构化字段优先；Advanced JSON 仅用于保留低频键。</p>

      <div class="reader-manager-grid">
        <div class="field">
          <label htmlFor="config-delivery-id">delivery id</label>
          <input
            id="config-delivery-id"
            class="input"
            value={state.id}
            readOnly={props.canDelete}
            onInput={(event) => props.onChange({ id: event.currentTarget.value })}
          />
        </div>
        <div class="field">
          <label htmlFor="config-delivery-kind">kind</label>
          <select
            id="config-delivery-kind"
            class="input"
            value={state.kind}
            onChange={(event) =>
              props.onChange({ kind: event.currentTarget.value as DeliveryKind })
            }
          >
            <option value="file">file</option>
            <option value="push">push</option>
            <option value="email">email</option>
          </select>
        </div>
        <label class={`reader-check reader-manager-enabled${state.enabled ? ' is-checked' : ''}`}>
          <input
            id="config-delivery-enabled"
            type="checkbox"
            class="reader-check-input"
            checked={state.enabled}
            onChange={(event) => props.onChange({ enabled: event.currentTarget.checked })}
          />
          <span class="reader-check-ui" />
          <span class="reader-check-copy">
            <span class="reader-check-label">启用该 delivery</span>
          </span>
        </label>
      </div>

      <details
        class="xq-section"
        open
      >
        <summary>
          <h2>{state.kind}</h2>
          <div class="segment-control">
            <label>
              <input
                type="radio"
                name="config-delivery-mode"
                checked={state.mode === 'structured'}
                onChange={() => props.onChange({ mode: 'structured' })}
              />
              <span>结构化</span>
            </label>
            <label>
              <input
                type="radio"
                name="config-delivery-mode"
                checked={state.mode === 'json'}
                onChange={() => props.onChange({ mode: 'json' })}
              />
              <span>JSON</span>
            </label>
          </div>
        </summary>
        <div
          class="panel"
          style={{ border: '0', borderTop: '1px solid var(--line)', borderRadius: '0 0 16px 16px' }}
        >
          {state.mode === 'json' ? (
            <div class="field reader-manager-wide">
              <label htmlFor="config-delivery-config-json">delivery config (JSON)</label>
              <textarea
                id="config-delivery-config-json"
                class="textarea"
                value={state.configJson}
                onInput={(event) => props.onChange({ configJson: event.currentTarget.value })}
              />
            </div>
          ) : null}

          {state.mode === 'structured' && state.kind === 'file' ? (
            <div class="reader-manager-grid">
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-file-path">file.path</label>
                <input
                  id="config-delivery-file-path"
                  class="input"
                  value={state.filePath}
                  placeholder={placeholder(state.filePath, 'outputs/example.txt')}
                  onInput={(event) => props.onChange({ filePath: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-file-content">file.content</label>
                <textarea
                  id="config-delivery-file-content"
                  class="textarea"
                  value={state.fileContent}
                  placeholder={placeholder(state.fileContent, '{{ entry.title }}')}
                  onInput={(event) => props.onChange({ fileContent: event.currentTarget.value })}
                />
              </div>
              <label
                class={`reader-check reader-manager-enabled${state.fileRotationEnabled ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  class="reader-check-input"
                  checked={state.fileRotationEnabled}
                  onChange={(event) =>
                    props.onChange({ fileRotationEnabled: event.currentTarget.checked })
                  }
                />
                <span class="reader-check-ui" />
                <span class="reader-check-copy">
                  <span class="reader-check-label">启用 file.rotation</span>
                </span>
              </label>
              <div class="field">
                <label htmlFor="config-delivery-file-rotation-size">file.rotation.size</label>
                <input
                  id="config-delivery-file-rotation-size"
                  class="input"
                  value={state.fileRotationSize}
                  onInput={(event) =>
                    props.onChange({ fileRotationSize: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-file-rotation-age">file.rotation.age</label>
                <input
                  id="config-delivery-file-rotation-age"
                  class="input"
                  value={state.fileRotationAge}
                  onInput={(event) =>
                    props.onChange({ fileRotationAge: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-file-rotation-backups">file.rotation.backups</label>
                <input
                  id="config-delivery-file-rotation-backups"
                  class="input"
                  value={state.fileRotationBackups}
                  onInput={(event) =>
                    props.onChange({ fileRotationBackups: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          ) : null}

          {state.mode === 'structured' && state.kind === 'push' ? (
            <div class="reader-manager-grid">
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-url">push.http.url</label>
                <input
                  id="config-delivery-push-url"
                  class="input"
                  value={state.pushUrl}
                  placeholder={placeholder(state.pushUrl, 'https://example.com')}
                  onInput={(event) => props.onChange({ pushUrl: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-method">push.http.method</label>
                <select
                  id="config-delivery-push-method"
                  class="input"
                  value={state.pushMethod}
                  onChange={(event) =>
                    props.onChange({ pushMethod: event.currentTarget.value as HttpMethod })
                  }
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                  <option value="HEAD">HEAD</option>
                </select>
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-timeout">push.http.timeout</label>
                <input
                  id="config-delivery-push-timeout"
                  class="input"
                  value={state.pushTimeout}
                  onInput={(event) => props.onChange({ pushTimeout: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-proxy">push.http.proxy</label>
                <input
                  id="config-delivery-push-proxy"
                  class="input"
                  value={state.pushProxy}
                  onInput={(event) => props.onChange({ pushProxy: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-headers-json">push.http.headers (JSON)</label>
                <textarea
                  id="config-delivery-push-headers-json"
                  class="textarea"
                  value={state.pushHeadersJson}
                  onInput={(event) =>
                    props.onChange({ pushHeadersJson: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-retry-limit">push.http.retry.limit</label>
                <input
                  id="config-delivery-push-retry-limit"
                  class="input"
                  value={state.pushRetryLimit}
                  onInput={(event) => props.onChange({ pushRetryLimit: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-retry-status-codes">
                  push.http.retry.statusCodes
                </label>
                <input
                  id="config-delivery-push-retry-status-codes"
                  class="input"
                  value={state.pushRetryStatusCodes}
                  onInput={(event) =>
                    props.onChange({ pushRetryStatusCodes: event.currentTarget.value })
                  }
                />
              </div>
              <label
                class={`reader-check reader-manager-enabled${state.pushRetryOnTimeout ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  class="reader-check-input"
                  checked={state.pushRetryOnTimeout}
                  onChange={(event) =>
                    props.onChange({ pushRetryOnTimeout: event.currentTarget.checked })
                  }
                />
                <span class="reader-check-ui" />
                <span class="reader-check-copy">
                  <span class="reader-check-label">push.http.retry.retryOnTimeout</span>
                </span>
              </label>
              <div class="field">
                <label htmlFor="config-delivery-push-retry-backoff-limit">
                  push.http.retry.backoffLimit
                </label>
                <input
                  id="config-delivery-push-retry-backoff-limit"
                  class="input"
                  value={state.pushRetryBackoffLimit}
                  onInput={(event) =>
                    props.onChange({ pushRetryBackoffLimit: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-request-type">push.request.type</label>
                <select
                  id="config-delivery-push-request-type"
                  class="input"
                  value={state.pushRequestType}
                  onChange={(event) =>
                    props.onChange({
                      pushRequestType: event.currentTarget.value as HttpRequestType,
                    })
                  }
                >
                  <option value="query">query</option>
                  <option value="form">form</option>
                  <option value="body">body</option>
                </select>
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-request-payload-json">
                  push.request.payload (JSON)
                </label>
                <textarea
                  id="config-delivery-push-request-payload-json"
                  class="textarea"
                  value={state.pushRequestPayloadJson}
                  onInput={(event) =>
                    props.onChange({ pushRequestPayloadJson: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-response-predicate">
                  push.response.predicate
                </label>
                <input
                  id="config-delivery-push-response-predicate"
                  class="input"
                  value={state.pushResponsePredicate}
                  onInput={(event) =>
                    props.onChange({ pushResponsePredicate: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-response-message">push.response.message</label>
                <input
                  id="config-delivery-push-response-message"
                  class="input"
                  value={state.pushResponseMessage}
                  onInput={(event) =>
                    props.onChange({ pushResponseMessage: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          ) : null}

          {state.mode === 'structured' && state.kind === 'email' ? (
            <div class="reader-manager-grid">
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-host">email.smtp.host</label>
                <input
                  id="config-delivery-email-smtp-host"
                  class="input"
                  value={state.emailSmtpHost}
                  placeholder={placeholder(state.emailSmtpHost, 'smtp.example.com')}
                  onInput={(event) => props.onChange({ emailSmtpHost: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-port">email.smtp.port</label>
                <input
                  id="config-delivery-email-smtp-port"
                  class="input"
                  value={state.emailSmtpPort}
                  onInput={(event) => props.onChange({ emailSmtpPort: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-security">email.smtp.security</label>
                <select
                  id="config-delivery-email-smtp-security"
                  class="input"
                  value={state.emailSmtpSecurity}
                  onChange={(event) =>
                    props.onChange({
                      emailSmtpSecurity: event.currentTarget
                        .value as DeliveryFormState['emailSmtpSecurity'],
                    })
                  }
                >
                  <option value="implicit">implicit</option>
                  <option value="starttls">starttls</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-auth-username">
                  email.smtp.auth.username
                </label>
                <input
                  id="config-delivery-email-smtp-auth-username"
                  class="input"
                  value={state.emailSmtpAuthUsername}
                  onInput={(event) =>
                    props.onChange({ emailSmtpAuthUsername: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-auth-password">
                  email.smtp.auth.password
                </label>
                <input
                  id="config-delivery-email-smtp-auth-password"
                  class="input"
                  value={state.emailSmtpAuthPassword}
                  onInput={(event) =>
                    props.onChange({ emailSmtpAuthPassword: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-from">email.message.from</label>
                <input
                  id="config-delivery-email-message-from"
                  class="input"
                  value={state.emailMessageFrom}
                  placeholder={placeholder(state.emailMessageFrom, 'noreply@example.com')}
                  onInput={(event) =>
                    props.onChange({ emailMessageFrom: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-to">email.message.to</label>
                <textarea
                  id="config-delivery-email-message-to"
                  class="textarea"
                  value={state.emailMessageTo}
                  onInput={(event) => props.onChange({ emailMessageTo: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-cc">email.message.cc</label>
                <textarea
                  id="config-delivery-email-message-cc"
                  class="textarea"
                  value={state.emailMessageCc}
                  onInput={(event) => props.onChange({ emailMessageCc: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-bcc">email.message.bcc</label>
                <textarea
                  id="config-delivery-email-message-bcc"
                  class="textarea"
                  value={state.emailMessageBcc}
                  onInput={(event) =>
                    props.onChange({ emailMessageBcc: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-reply-to">
                  email.message.replyTo
                </label>
                <textarea
                  id="config-delivery-email-message-reply-to"
                  class="textarea"
                  value={state.emailMessageReplyTo}
                  onInput={(event) =>
                    props.onChange({ emailMessageReplyTo: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-subject">email.message.subject</label>
                <input
                  id="config-delivery-email-message-subject"
                  class="input"
                  value={state.emailMessageSubject}
                  onInput={(event) =>
                    props.onChange({ emailMessageSubject: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-text">email.message.text</label>
                <textarea
                  id="config-delivery-email-message-text"
                  class="textarea"
                  value={state.emailMessageText}
                  onInput={(event) =>
                    props.onChange({ emailMessageText: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-html">email.message.html</label>
                <textarea
                  id="config-delivery-email-message-html"
                  class="textarea"
                  value={state.emailMessageHtml}
                  onInput={(event) =>
                    props.onChange({ emailMessageHtml: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-headers-json">
                  email.message.headers (JSON)
                </label>
                <textarea
                  id="config-delivery-email-message-headers-json"
                  class="textarea"
                  value={state.emailMessageHeadersJson}
                  onInput={(event) =>
                    props.onChange({ emailMessageHeadersJson: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          ) : null}
        </div>
      </details>

      <div class="toolbar reader-manager-actions">
        <button
          type="button"
          class="btn btn-primary"
          id="config-delivery-save"
          disabled={props.saving}
          onClick={props.onSave}
        >
          {props.saving ? '保存中…' : '保存 Delivery'}
        </button>
        {props.canDelete ? (
          <button
            type="button"
            class="btn btn-secondary"
            id="config-delivery-delete"
            disabled={props.deleting}
            onClick={props.onDelete}
          >
            {props.deleting ? '删除中…' : '删除 Delivery'}
          </button>
        ) : null}
      </div>

      {props.message ? (
        <p
          id="config-delivery-message"
          class="reader-manager-message is-success"
        >
          {props.message}
        </p>
      ) : null}
      {props.error ? (
        <p
          id="config-delivery-error"
          class="reader-manager-message is-error"
        >
          {props.error}
        </p>
      ) : null}
    </section>
  )
}

function SourceManager(props: {
  source: SourceFormState | undefined
  allDeliveries: ReaderOverview['deliveries']
  saving: boolean
  message: string
  error: string
  onChange: (patch: Partial<SourceFormState>) => void
  onToggleDelivery: (deliveryId: string, checked: boolean) => void
  onOverrideChange: (deliveryId: string, value: string) => void
  onSave: () => void
}) {
  if (!props.source) {
    return (
      <section
        id="config-manager"
        class="panel reader-manager-panel"
      >
        <p class="reader-empty">还没有可管理的 source。</p>
      </section>
    )
  }

  const source = props.source
  const summary = source.transport === 'summary' || source.parser === 'summary'
  const showXqueryFields = !summary && source.parser === 'xquery'

  return (
    <section
      id="config-manager"
      class="panel reader-manager-panel"
    >
      <div class="reader-manager-head">
        <div>
          <p class="reader-kicker">sources</p>
          <h2
            id="config-manager-title"
            class="reader-manager-title"
          >
            {source.id}
          </h2>
        </div>
        <span
          id="config-manager-enabled-badge"
          class={`reader-state-badge is-${source.enabled ? 'enabled' : 'disabled'}`}
        >
          {source.enabled ? '启用' : '停用'}
        </span>
      </div>

      <p class="reader-empty">
        保存会直接重写 runtime/config.yml 的 YAML 文本布局与注释，请确认这符合当前工作方式。
      </p>

      <div class="reader-manager-grid">
        <div class="field">
          <label htmlFor="config-manager-name">显示名称</label>
          <input
            id="config-manager-name"
            class="input"
            value={source.name}
            onInput={(event) => props.onChange({ name: event.currentTarget.value })}
          />
        </div>
        <div class="field">
          <label htmlFor="config-manager-schedule">schedule</label>
          <input
            id="config-manager-schedule"
            class="input"
            value={source.schedule}
            onInput={(event) => props.onChange({ schedule: event.currentTarget.value })}
          />
        </div>
        <div class="field">
          <label htmlFor="config-manager-transport">transport</label>
          <select
            id="config-manager-transport"
            class="input"
            disabled={summary}
            value={source.transport}
            onChange={(event) =>
              props.onChange({
                transport: event.currentTarget.value as SourceFormState['transport'],
              })
            }
          >
            <option value="http">http</option>
            <option value="byparr">byparr</option>
            <option
              value="summary"
              disabled={!summary}
            >
              summary
            </option>
          </select>
        </div>
        <div class="field">
          <label htmlFor="config-manager-parser">parser</label>
          <select
            id="config-manager-parser"
            class="input"
            disabled={summary}
            value={source.parser}
            onChange={(event) =>
              props.onChange({ parser: event.currentTarget.value as SourceFormState['parser'] })
            }
          >
            <option value="syndication">syndication</option>
            <option value="xquery">xquery</option>
            <option
              value="summary"
              disabled={!summary}
            >
              summary
            </option>
          </select>
        </div>
        <div class="field reader-manager-wide">
          <label htmlFor="config-manager-target-url">目标 URL</label>
          <input
            id="config-manager-target-url"
            class="input"
            value={source.targetUrl}
            placeholder={placeholder(source.targetUrl, 'https://example.com/feed.xml')}
            disabled={summary}
            onInput={(event) => props.onChange({ targetUrl: event.currentTarget.value })}
          />
        </div>
        <div class="field reader-manager-wide">
          <label htmlFor="config-manager-filter">filter</label>
          <textarea
            id="config-manager-filter"
            class="textarea"
            value={source.filter}
            onInput={(event) => props.onChange({ filter: event.currentTarget.value })}
          />
        </div>
        {showXqueryFields ? (
          <div
            id="config-manager-xquery-fields"
            class="reader-manager-xquery-fields reader-manager-wide"
          >
            <div class="reader-manager-grid">
              <div class="field reader-manager-wide">
                <label htmlFor="config-manager-xquery-locate">xquery.locate</label>
                <input
                  id="config-manager-xquery-locate"
                  class="input"
                  value={source.xqueryLocate}
                  onInput={(event) => props.onChange({ xqueryLocate: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-manager-xquery-entry-id">xquery.entry.id</label>
                <input
                  id="config-manager-xquery-entry-id"
                  class="input"
                  value={source.xqueryEntryId}
                  onInput={(event) => props.onChange({ xqueryEntryId: event.currentTarget.value })}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <label class={`reader-check reader-manager-enabled${source.enabled ? ' is-checked' : ''}`}>
        <input
          id="config-manager-enabled"
          type="checkbox"
          class="reader-check-input"
          checked={source.enabled}
          onChange={(event) => props.onChange({ enabled: event.currentTarget.checked })}
        />
        <span class="reader-check-ui" />
        <span class="reader-check-copy">
          <span class="reader-check-label">启用该 source</span>
        </span>
      </label>

      <div class="reader-manager-deliveries">
        <p class="reader-kicker">source delivery overrides</p>
        <div class="reader-manager-delivery-list">
          {props.allDeliveries.length === 0 ? (
            <p class="reader-empty">当前没有可绑定 delivery。</p>
          ) : (
            props.allDeliveries.map((delivery) => {
              const checked = source.deliveryIds.includes(delivery.id)
              return (
                <div
                  class="reader-delivery-block"
                  key={delivery.id}
                >
                  <label
                    class={`reader-check reader-delivery-toggle${checked ? ' is-checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      class="reader-check-input"
                      checked={checked}
                      onChange={(event) =>
                        props.onToggleDelivery(delivery.id, event.currentTarget.checked)
                      }
                    />
                    <span class="reader-check-ui" />
                    <span class="reader-check-copy">
                      <span class="reader-check-label">{delivery.id}</span>
                      <span class="reader-check-meta">{delivery.kind}</span>
                    </span>
                  </label>
                  {checked ? (
                    <div class="reader-delivery-editor">
                      <label class="field reader-manager-wide">
                        <span>{deliveryOverrideLabel(delivery.kind)}</span>
                        <textarea
                          class="textarea reader-delivery-textarea"
                          value={source.deliveryOverrides[delivery.id] ?? ''}
                          placeholder={
                            delivery.kind === 'file'
                              ? defaultSourceFileOverride()
                              : delivery.kind === 'push'
                                ? '{\n  "text": "{{ entry.title }}"\n}'
                                : '{\n  "subject": "{{ entry.title }}"\n}'
                          }
                          onInput={(event) =>
                            props.onOverrideChange(delivery.id, event.currentTarget.value)
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div class="toolbar reader-manager-actions">
        <button
          type="button"
          class="btn btn-primary"
          id="config-manager-save"
          disabled={props.saving}
          onClick={props.onSave}
        >
          {props.saving ? '保存中…' : '保存 Source'}
        </button>
      </div>

      {props.message ? (
        <p
          id="config-manager-message"
          class="reader-manager-message is-success"
        >
          {props.message}
        </p>
      ) : null}
      {props.error ? (
        <p
          id="config-manager-error"
          class="reader-manager-message is-error"
        >
          {props.error}
        </p>
      ) : null}
    </section>
  )
}

export default function ConfigWorkbench(props: { workbench: ConfigWorkbenchOverview }) {
  const [workbench, setWorkbench] = useState(props.workbench)
  const [selectedSourceId, setSelectedSourceId] = useState(
    props.workbench.reader.sources[0]?.id ?? '',
  )
  const [selectedDeliveryId, setSelectedDeliveryId] = useState(
    props.workbench.deliveries[0]?.id ?? '',
  )
  const [draftDelivery, setDraftDelivery] = useState<DeliveryDraft | null>(
    props.workbench.deliveries.length === 0 ? createDraftDelivery() : null,
  )
  const [globalState, setGlobalState] = useState(() =>
    createGlobalFormState(props.workbench.global),
  )
  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalMessage, setGlobalMessage] = useState('')
  const [globalError, setGlobalError] = useState('')
  const [deliveryState, setDeliveryState] = useState(() =>
    createDeliveryFormState(
      draftDelivery ?? props.workbench.deliveries[0] ?? createDraftDelivery(),
    ),
  )
  const [deliverySaving, setDeliverySaving] = useState(false)
  const [deliveryDeleting, setDeliveryDeleting] = useState(false)
  const [deliveryMessage, setDeliveryMessage] = useState('')
  const [deliveryError, setDeliveryError] = useState('')
  const [sourceStates, setSourceStates] = useState<Record<string, SourceFormState>>(() =>
    Object.fromEntries(
      props.workbench.reader.sources.map((source) => [source.id, createSourceFormState(source)]),
    ),
  )
  const [sourceSaving, setSourceSaving] = useState(false)
  const [sourceMessage, setSourceMessage] = useState('')
  const [sourceError, setSourceError] = useState('')

  const selectedSource = useMemo(
    () =>
      workbench.reader.sources.find((source) => source.id === selectedSourceId) ??
      workbench.reader.sources[0],
    [selectedSourceId, workbench.reader.sources],
  )
  const selectedDelivery = useMemo(
    () =>
      draftDelivery ??
      workbench.deliveries.find((delivery) => delivery.id === selectedDeliveryId) ??
      workbench.deliveries[0],
    [draftDelivery, selectedDeliveryId, workbench.deliveries],
  )
  const selectedSourceState = selectedSource
    ? (sourceStates[selectedSource.id] ?? createSourceFormState(selectedSource))
    : undefined

  function applyWorkbench(
    next: ConfigWorkbenchOverview,
    preferredSourceId?: string,
    preferredDeliveryId?: string,
  ) {
    setWorkbench(next)
    setDraftDelivery(null)
    setGlobalState(createGlobalFormState(next.global))
    setSourceStates(
      Object.fromEntries(
        next.reader.sources.map((source) => [source.id, createSourceFormState(source)]),
      ),
    )
    const nextSource =
      next.reader.sources.find((source) => source.id === preferredSourceId) ??
      next.reader.sources[0]
    const nextDelivery =
      next.deliveries.find((delivery) => delivery.id === preferredDeliveryId) ?? next.deliveries[0]
    setSelectedSourceId(nextSource?.id ?? '')
    setSelectedDeliveryId(nextDelivery?.id ?? '')
    setDeliveryState(createDeliveryFormState(nextDelivery ?? createDraftDelivery()))
  }

  function applyOverview(nextOverview: ReaderOverview, preferredSourceId?: string) {
    const next = { ...workbench, reader: nextOverview }
    setWorkbench(next)
    setSourceStates(
      Object.fromEntries(
        nextOverview.sources.map((source) => [source.id, createSourceFormState(source)]),
      ),
    )
    const nextSource =
      nextOverview.sources.find((source) => source.id === preferredSourceId) ??
      nextOverview.sources[0]
    setSelectedSourceId(nextSource?.id ?? '')
  }

  async function saveGlobal() {
    setGlobalSaving(true)
    setGlobalMessage('')
    setGlobalError('')
    try {
      const result = await postJson<ConfigActionSuccessResult>(
        '/api/config/global',
        buildGlobalPayload(globalState),
      )
      applyWorkbench(
        result.workbench,
        selectedSource?.id,
        draftDelivery ? undefined : selectedDelivery?.id,
      )
      setGlobalMessage(result.message)
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setGlobalSaving(false)
    }
  }

  async function saveDelivery() {
    setDeliverySaving(true)
    setDeliveryMessage('')
    setDeliveryError('')
    try {
      if (deliveryState.id.trim() === '') throw new Error('deliveryId 不能为空')
      const result = await postJson<ConfigActionSuccessResult>(
        '/api/config/deliveries',
        buildDeliveryPayload(deliveryState),
      )
      applyWorkbench(result.workbench, selectedSource?.id, deliveryState.id)
      setDeliveryMessage(result.message)
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setDeliverySaving(false)
    }
  }

  async function deleteDelivery() {
    if (!selectedDelivery || draftDelivery) return
    setDeliveryDeleting(true)
    setDeliveryMessage('')
    setDeliveryError('')
    try {
      const result = await postJson<ConfigActionSuccessResult>('/api/config/deliveries/delete', {
        deliveryId: selectedDelivery.id,
      })
      applyWorkbench(result.workbench, selectedSource?.id)
      setDeliveryMessage(result.message)
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeliveryDeleting(false)
    }
  }

  async function saveSource() {
    if (!selectedSourceState) return
    setSourceSaving(true)
    setSourceMessage('')
    setSourceError('')
    try {
      const result = await postJson<SourceActionSuccessResult>(
        '/api/sources/update',
        buildSourcePayload(selectedSourceState, workbench.reader.deliveries),
      )
      applyOverview(result.overview, selectedSourceState.id)
      setSourceMessage(result.message)
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSourceSaving(false)
    }
  }

  return (
    <>
      <GlobalPanel
        state={globalState}
        saving={globalSaving}
        message={globalMessage}
        error={globalError}
        onChange={(patch) => setGlobalState((current) => ({ ...current, ...patch }))}
        onSave={saveGlobal}
      />

      <section class="reader-layout">
        <aside class="panel reader-sidebar config-sidebar-panel">
          <div class="reader-sidebar-head">
            <div>
              <p class="reader-kicker">canonical deliveries</p>
              <p class="reader-sidebar-copy">左栏切换 delivery，右侧编辑 canonical config。</p>
            </div>
            <p class="reader-summary-text">{workbench.deliveries.length} 个 delivery</p>
          </div>
          <div
            id="config-delivery-list"
            class="reader-source-list"
            role="listbox"
            aria-label="Delivery 列表"
          >
            {workbench.deliveries.map((delivery) => (
              <button
                key={delivery.id}
                type="button"
                class={`reader-source-button${!draftDelivery && selectedDelivery?.id === delivery.id ? ' is-active' : ''}`}
                aria-selected={
                  !draftDelivery && selectedDelivery?.id === delivery.id ? 'true' : 'false'
                }
                onClick={() => {
                  setDraftDelivery(null)
                  setSelectedDeliveryId(delivery.id)
                  setDeliveryState(createDeliveryFormState(delivery))
                  setDeliveryMessage('')
                  setDeliveryError('')
                }}
              >
                <span class="reader-source-headline">
                  <span class="reader-source-name">{delivery.id}</span>
                  <span
                    class={`reader-state-badge is-${delivery.enabled ? 'enabled' : 'disabled'}`}
                  >
                    {delivery.enabled ? '启用' : '停用'}
                  </span>
                </span>
                <span class="reader-source-meta">
                  <span>{delivery.kind}</span>
                  <span>canonical</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              class={`reader-source-button${draftDelivery ? ' is-active' : ''}`}
              id="config-delivery-create"
              onClick={() => {
                const draft = createDraftDelivery()
                setDraftDelivery(draft)
                setDeliveryState(createDeliveryFormState(draft))
                setDeliveryMessage('')
                setDeliveryError('')
              }}
            >
              <span class="reader-source-headline">
                <span class="reader-source-name">新增 delivery</span>
              </span>
              <span class="reader-source-meta">
                <span>create</span>
                <span>canonical</span>
              </span>
            </button>
          </div>
        </aside>

        <section class="reader-main-column">
          <DeliveryForm
            state={deliveryState}
            saving={deliverySaving}
            deleting={deliveryDeleting}
            message={deliveryMessage}
            error={deliveryError}
            canDelete={!draftDelivery}
            onChange={(patch) => setDeliveryState((current) => ({ ...current, ...patch }))}
            onSave={saveDelivery}
            onDelete={deleteDelivery}
          />
        </section>
      </section>

      <section class="reader-layout">
        <aside class="panel reader-sidebar config-sidebar-panel">
          <div class="reader-sidebar-head">
            <div>
              <p class="reader-kicker">sources</p>
              <p class="reader-sidebar-copy">
                左栏切换 source，右侧集中编辑 source 子树与 override。
              </p>
            </div>
            <p class="reader-summary-text">{workbench.reader.sources.length} 个 source</p>
          </div>
          <div
            id="config-source-list"
            class="reader-source-list"
            role="listbox"
            aria-label="Source 列表"
          >
            {workbench.reader.sources.map((source) => (
              <button
                key={source.id}
                type="button"
                class={`reader-source-button${selectedSource?.id === source.id ? ' is-active' : ''}`}
                aria-selected={selectedSource?.id === source.id ? 'true' : 'false'}
                onClick={() => {
                  setSelectedSourceId(source.id)
                  setSourceMessage('')
                  setSourceError('')
                }}
              >
                <span class="reader-source-headline">
                  <span class="reader-source-name">{source.name || source.id}</span>
                  <span class={`reader-state-badge is-${source.enabled ? 'enabled' : 'disabled'}`}>
                    {source.enabled ? '启用' : '停用'}
                  </span>
                </span>
                <span class="reader-source-meta">
                  <span>{source.parser}</span>
                  <span>{source.transport}</span>
                  <span>{formatDeliveryKinds(source.deliveryKinds)}</span>
                </span>
              </button>
            ))}
          </div>
          <a
            href="/reader"
            class="reader-link"
          >
            返回 Reader
          </a>
        </aside>

        <section class="reader-main-column">
          <SourceManager
            source={selectedSourceState}
            allDeliveries={workbench.reader.deliveries}
            saving={sourceSaving}
            message={sourceMessage}
            error={sourceError}
            onChange={(patch) => {
              if (!selectedSourceState) return
              setSourceStates((current) => ({
                ...current,
                [selectedSourceState.id]: { ...selectedSourceState, ...patch },
              }))
            }}
            onToggleDelivery={(deliveryId, checked) => {
              if (!selectedSourceState) return
              const nextDeliveryIds = checked
                ? [...selectedSourceState.deliveryIds, deliveryId]
                : selectedSourceState.deliveryIds.filter((id) => id !== deliveryId)
              const deliveryKind = workbench.reader.deliveries.find(
                (delivery) => delivery.id === deliveryId,
              )?.kind
              const nextOverride =
                checked &&
                deliveryKind === 'file' &&
                (selectedSourceState.deliveryOverrides[deliveryId] ?? '').trim() === ''
                  ? defaultSourceFileOverride()
                  : selectedSourceState.deliveryOverrides[deliveryId]
              setSourceStates((current) => ({
                ...current,
                [selectedSourceState.id]: {
                  ...selectedSourceState,
                  deliveryIds: nextDeliveryIds,
                  deliveryOverrides: {
                    ...selectedSourceState.deliveryOverrides,
                    ...(checked ? { [deliveryId]: nextOverride ?? '' } : {}),
                  },
                },
              }))
            }}
            onOverrideChange={(deliveryId, value) => {
              if (!selectedSourceState) return
              setSourceStates((current) => ({
                ...current,
                [selectedSourceState.id]: {
                  ...selectedSourceState,
                  deliveryOverrides: {
                    ...selectedSourceState.deliveryOverrides,
                    [deliveryId]: value,
                  },
                },
              }))
            }}
            onSave={saveSource}
          />
        </section>
      </section>
    </>
  )
}
