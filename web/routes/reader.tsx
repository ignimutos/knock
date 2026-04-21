import { AppShell } from '../components/layout/app_shell.tsx'
import type {
  ReaderDeliveryCatalogItem,
  ReaderEntrySnapshot,
  ReaderOverview,
  ReaderSourceOverview,
} from '../../src/web/reader_overview.ts'
import type { SourceDeliveryOverride } from '../../src/config/types.ts'

function toBootstrapJson(overview: ReaderOverview): string {
  return JSON.stringify(overview).replace(/</g, '\\u003c')
}

const STATUS_LABELS = {
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  skipped: '跳过',
  interrupted: '中断',
  running: '运行中',
  planned: '已计划',
} as const

const PARSER_LABELS: Record<ReaderSourceOverview['parser'], string> = {
  syndication: 'syndication',
  xquery: 'xquery',
  summary: 'summary',
}

const TRANSPORT_LABELS: Record<ReaderSourceOverview['transport'], string> = {
  http: 'http',
  byparr: 'byparr',
  summary: 'summary',
}

const STRIP_MARKUP_PATTERNS = [
  ['<(br|/p|/div|/li|/h[1-6])[^>]*>', '\n'],
  ['<[^>]+>', ' '],
  ['&nbsp;', ' '],
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['\r', ''],
  ['\n{3,}', '\n\n'],
  ['[\t ]+', ' '],
] as const

const STRIP_MARKUP_REPLACERS = STRIP_MARKUP_PATTERNS.map(
  ([pattern, replacement]) => [new RegExp(pattern, 'g'), replacement] as const,
)

function formatStatus(status: string | undefined): string {
  return status && status in STATUS_LABELS
    ? STATUS_LABELS[status as keyof typeof STATUS_LABELS]
    : '暂无'
}

function formatParser(parser: ReaderSourceOverview['parser'] | string | undefined): string {
  return parser && parser in PARSER_LABELS
    ? PARSER_LABELS[parser as keyof typeof PARSER_LABELS]
    : 'syndication'
}

function formatTransport(
  transport: ReaderSourceOverview['transport'] | string | undefined,
): string {
  return transport && transport in TRANSPORT_LABELS
    ? TRANSPORT_LABELS[transport as keyof typeof TRANSPORT_LABELS]
    : 'http'
}

function formatDeliveryKinds(kinds: readonly string[] | undefined): string {
  return Array.isArray(kinds) && kinds.length > 0 ? kinds.join(' · ') : '无投递'
}

function stripMarkup(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') return ''

  let next = value
  for (const [pattern, replacement] of STRIP_MARKUP_REPLACERS) {
    next = next.replace(pattern, replacement)
  }
  return next.trim()
}

function getInitialSource(overview: ReaderOverview): ReaderSourceOverview | undefined {
  return overview.sources[0]
}

function isSummarySource(source: ReaderSourceOverview | undefined): boolean {
  return source?.transport === 'summary' || source?.parser === 'summary'
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

function inlineBrowserFunction(name: string, fn: { toString(): string }): string {
  return `const ${name} = ${fn.toString()}`
}

type ReaderMetaItem = {
  label: string
  value: string
}

function MetaGrid(props: { className: string; items: readonly ReaderMetaItem[] }) {
  return (
    <dl class={props.className}>
      {props.items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function buildSourceListItemView(source: ReaderSourceOverview) {
  return {
    name: source.name || source.id,
    enabled: source.enabled,
    parserLabel: formatParser(source.parser),
    transportLabel: formatTransport(source.transport),
    deliveryKindsLabel: formatDeliveryKinds(source.deliveryKinds),
  }
}

function buildSourceCardView(source?: ReaderSourceOverview) {
  if (!source) {
    return {
      emptyMessage: '还没有可浏览的 source。',
      meta: [] as ReaderMetaItem[],
    }
  }

  return {
    title: source.name || source.id,
    status: source.lastRun?.status,
    statusLabel: formatStatus(source.lastRun?.status),
    meta: [
      { label: 'parser', value: formatParser(source.parser) },
      { label: 'transport', value: formatTransport(source.transport) },
      { label: 'deliveries', value: String(source.deliveryCount) },
      { label: 'entries', value: String(source.entries.length) },
    ],
    sourceUrl:
      typeof source.sourceUrl === 'string' && source.sourceUrl !== ''
        ? source.sourceUrl
        : undefined,
    feedTitle: source.feed?.title || '未命名 feed',
    feedDescription: source.feed
      ? stripMarkup(source.feed.description) || '暂无 feed 描述。'
      : undefined,
    feedEmptyMessage: source.feed ? undefined : '最近快照里还没有 feed 内容。',
  }
}

function buildFeedBannerView(source?: ReaderSourceOverview) {
  if (!source) {
    return {
      emptyMessage: '选择 source 后，这里会显示 feed 快照。',
      meta: [] as ReaderMetaItem[],
    }
  }

  return {
    title: source.feed?.title || source.name || source.id,
    statusLabel: formatStatus(source.lastRun?.status),
    copy: stripMarkup(source.feed?.description) || '这个 source 暂时没有可展示的 feed 描述。',
    meta: [
      { label: 'published', value: source.feed?.published || '—' },
      { label: 'language', value: source.feed?.language || '—' },
      { label: 'generator', value: source.feed?.generator || '—' },
      { label: 'counts', value: String(source.lastRun?.counts.parsedCount || 0) + ' parsed' },
    ],
  }
}

function buildEntryView(entry: ReaderEntrySnapshot) {
  return {
    title: entry.title || entry.id,
    status: entry.status,
    statusLabel: formatStatus(entry.status),
    excerpt: stripMarkup(entry.description || entry.content) || '暂无摘要。',
    meta: [
      { label: 'published', value: entry.published || '—' },
      { label: 'updated', value: entry.updated || '—' },
      { label: 'entry id', value: entry.id },
      { label: 'status', value: formatStatus(entry.status) },
    ],
    link: typeof entry.link === 'string' && entry.link !== '' ? entry.link : undefined,
    summary: stripMarkup(entry.description) || '暂无摘要。',
    content: stripMarkup(entry.content) || '暂无正文。',
  }
}

function SourceList(props: { sources: ReaderOverview['sources'] }) {
  return (
    <div
      id="reader-source-list"
      class="reader-source-list"
      role="listbox"
      aria-label="Source 列表"
    >
      {props.sources.map((source, index) => {
        const view = buildSourceListItemView(source)
        return (
          <button
            key={source.id}
            type="button"
            class={`reader-source-button${index === 0 ? ' is-active' : ''}`}
            data-reader-source={source.id}
            data-source-index={String(index)}
            aria-selected={index === 0 ? 'true' : 'false'}
          >
            <span class="reader-source-headline">
              <span class="reader-source-name">{view.name}</span>
              <span class={`reader-state-badge is-${view.enabled ? 'enabled' : 'disabled'}`}>
                {view.enabled ? '启用' : '停用'}
              </span>
            </span>
            <span class="reader-source-meta">
              <span>{view.parserLabel}</span>
              <span>{view.transportLabel}</span>
              <span>{view.deliveryKindsLabel}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function SourceCard(props: { source?: ReaderSourceOverview }) {
  const view = buildSourceCardView(props.source)

  return (
    <section
      id="reader-source-card"
      class="reader-source-card"
    >
      {view.emptyMessage ? (
        <p class="reader-empty">{view.emptyMessage}</p>
      ) : (
        <>
          <div class="reader-card-head">
            <div>
              <p class="reader-kicker">当前 source</p>
              <h2 class="reader-card-title">{view.title}</h2>
            </div>
            <span class={`reader-run-badge is-${view.status ?? 'idle'}`}>{view.statusLabel}</span>
          </div>
          <MetaGrid
            className="reader-meta-grid"
            items={view.meta}
          />
          {view.sourceUrl ? (
            <a
              href={view.sourceUrl}
              class="reader-link"
              target="_blank"
              rel="noreferrer"
            >
              打开源地址
            </a>
          ) : null}
          {view.feedDescription ? (
            <div class="reader-feed-note">
              <p class="reader-feed-title">{view.feedTitle}</p>
              <p class="reader-feed-description">{view.feedDescription}</p>
            </div>
          ) : (
            <p class="reader-empty">{view.feedEmptyMessage}</p>
          )}
        </>
      )}
    </section>
  )
}

function FeedBanner(props: { source?: ReaderSourceOverview }) {
  const view = buildFeedBannerView(props.source)

  return (
    <section
      id="reader-feed-banner"
      class="reader-feed-banner"
    >
      {view.emptyMessage ? (
        <p class="reader-empty">{view.emptyMessage}</p>
      ) : (
        <>
          <div class="reader-banner-head">
            <div>
              <p class="reader-kicker">feed 快照</p>
              <h2 class="reader-banner-title">{view.title}</h2>
            </div>
            <p class="reader-banner-meta">最近快照 · {view.statusLabel}</p>
          </div>
          <p class="reader-banner-copy">{view.copy}</p>
          <MetaGrid
            className="reader-feed-grid"
            items={view.meta}
          />
        </>
      )}
    </section>
  )
}

function DeliveryOverrideEditor(props: {
  delivery: ReaderDeliveryCatalogItem
  source: ReaderSourceOverview
}) {
  const checked = props.source.deliveryIds.includes(props.delivery.id)
  const override = props.source.deliveryOverrides[props.delivery.id]

  return (
    <div class="reader-delivery-block">
      <label class={`reader-check reader-delivery-toggle${checked ? ' is-checked' : ''}`}>
        <input
          type="checkbox"
          class="reader-check-input"
          data-delivery-id={props.delivery.id}
          checked={checked}
        />
        <span class="reader-check-ui" />
        <span class="reader-check-copy">
          <span class="reader-check-label">{props.delivery.id}</span>
          <span class="reader-check-meta">{props.delivery.kind}</span>
        </span>
      </label>
      <div
        class="reader-delivery-editor"
        data-delivery-editor={props.delivery.id}
        data-delivery-kind={props.delivery.kind}
        hidden={!checked}
      >
        <label class="field reader-manager-wide">
          <span>{deliveryOverrideLabel(props.delivery.kind)}</span>
          <textarea
            class="textarea reader-delivery-textarea"
            data-delivery-field={props.delivery.id}
          >
            {getOverrideTextareaValue(props.delivery.kind, override)}
          </textarea>
        </label>
      </div>
    </div>
  )
}

function SourceManager(props: {
  source?: ReaderSourceOverview
  allDeliveries: ReaderOverview['deliveries']
}) {
  if (!props.source) {
    return (
      <section
        id="reader-manager"
        class="panel reader-manager-panel"
      >
        <p class="reader-empty">还没有可管理的 source。</p>
      </section>
    )
  }

  const source = props.source
  const summary = isSummarySource(source)
  const showXqueryFields = !summary && source.parser === 'xquery'

  return (
    <section
      id="reader-manager"
      class="panel reader-manager-panel"
    >
      <div class="reader-manager-head">
        <div>
          <p class="reader-kicker">source 管理</p>
          <h2
            id="reader-manager-title"
            class="reader-manager-title"
          >
            {source.id}
          </h2>
        </div>
        <span class={`reader-state-badge is-${source.enabled ? 'enabled' : 'disabled'}`}>
          {source.enabled ? '启用' : '停用'}
        </span>
      </div>

      <div class="reader-manager-grid">
        <div class="field">
          <label htmlFor="reader-manager-name">显示名称</label>
          <input
            id="reader-manager-name"
            class="input"
            value={source.name}
          />
        </div>
        <div class="field">
          <label htmlFor="reader-manager-schedule">schedule</label>
          <input
            id="reader-manager-schedule"
            class="input"
            value={source.schedule ?? ''}
          />
        </div>
        <div class="field">
          <label htmlFor="reader-manager-transport">transport</label>
          <select
            id="reader-manager-transport"
            class="input"
            disabled={summary}
            value={source.transport}
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
          <label htmlFor="reader-manager-parser">parser</label>
          <select
            id="reader-manager-parser"
            class="input"
            disabled={summary}
            value={source.parser}
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
          <label htmlFor="reader-manager-target-url">目标 URL</label>
          <input
            id="reader-manager-target-url"
            class="input"
            value={source.sourceUrl ?? ''}
            disabled={summary}
          />
        </div>
        <div class="field reader-manager-wide">
          <label htmlFor="reader-manager-filter">filter</label>
          <textarea
            id="reader-manager-filter"
            class="textarea"
          >
            {source.filter ?? ''}
          </textarea>
        </div>
        <div
          id="reader-manager-xquery-fields"
          class="reader-manager-xquery-fields reader-manager-wide"
          hidden={!showXqueryFields}
        >
          <div class="reader-manager-grid">
            <div class="field reader-manager-wide">
              <label htmlFor="reader-manager-xquery-locate">xquery.locate</label>
              <input
                id="reader-manager-xquery-locate"
                class="input"
                value={source.xqueryLocate ?? ''}
                disabled={!showXqueryFields}
              />
            </div>
            <div class="field reader-manager-wide">
              <label htmlFor="reader-manager-xquery-entry-id">xquery.entry.id</label>
              <input
                id="reader-manager-xquery-entry-id"
                class="input"
                value={source.xqueryEntryId ?? ''}
                disabled={!showXqueryFields}
              />
            </div>
          </div>
        </div>
      </div>

      <label class={`reader-check reader-manager-enabled${source.enabled ? ' is-checked' : ''}`}>
        <input
          id="reader-manager-enabled"
          type="checkbox"
          class="reader-check-input"
          checked={source.enabled}
        />
        <span class="reader-check-ui" />
        <span class="reader-check-copy">
          <span class="reader-check-label">启用该 source</span>
        </span>
      </label>

      <div class="reader-manager-deliveries">
        <p class="reader-kicker">deliveries</p>
        <div
          id="reader-manager-delivery-list"
          class="reader-manager-delivery-list"
        >
          {props.allDeliveries.length === 0 ? (
            <p class="reader-empty">当前没有可绑定 delivery。</p>
          ) : (
            props.allDeliveries.map((delivery) => (
              <DeliveryOverrideEditor
                key={delivery.id}
                delivery={delivery}
                source={source}
              />
            ))
          )}
        </div>
      </div>

      <div class="toolbar reader-manager-actions">
        <button
          type="button"
          class="btn btn-primary"
          id="reader-manager-save"
        >
          保存配置
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          id="reader-manager-run"
        >
          强制获取
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          id="reader-manager-clear"
        >
          清空历史
        </button>
      </div>

      <p
        id="reader-manager-message"
        class="reader-manager-message is-success"
        hidden
      />
      <p
        id="reader-manager-error"
        class="reader-manager-message is-error"
        hidden
      />

      <div
        id="reader-confirm-modal"
        class="reader-modal-shell"
        hidden
      >
        <div
          class="reader-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reader-confirm-title"
        >
          <p class="reader-kicker">确认操作</p>
          <h3
            id="reader-confirm-title"
            class="reader-modal-title"
          >
            确认清空历史
          </h3>
          <p
            id="reader-confirm-body"
            class="reader-modal-copy"
          />
          <div class="toolbar reader-modal-actions">
            <button
              type="button"
              class="btn btn-secondary"
              id="reader-confirm-cancel"
            >
              取消
            </button>
            <button
              type="button"
              class="btn btn-primary"
              id="reader-confirm-confirm"
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function EntryExpandedPanel(props: { entry: ReaderEntrySnapshot; expanded: boolean }) {
  const view = buildEntryView(props.entry)

  return (
    <div
      class={`reader-entry-expand-shell${props.expanded ? ' is-expanded' : ''}`}
      aria-hidden={props.expanded ? 'false' : 'true'}
    >
      <article class="reader-entry-expanded">
        <header class="reader-article-head">
          <div>
            <p class="reader-kicker">entry 阅读面</p>
            <h3 class="reader-article-title">{view.title}</h3>
          </div>
          <span class={`reader-run-badge is-${view.status}`}>{view.statusLabel}</span>
        </header>
        <MetaGrid
          className="reader-meta-grid reader-entry-meta-grid"
          items={view.meta}
        />
        {view.link ? (
          <a
            href={view.link}
            class="reader-link"
            target="_blank"
            rel="noreferrer"
          >
            打开原文
          </a>
        ) : null}
        <section class="reader-article-section">
          <h4>摘要</h4>
          <p class="reader-article-copy">{view.summary}</p>
        </section>
        <section class="reader-article-section">
          <h4>内容</h4>
          <pre class="reader-article-content">{view.content}</pre>
        </section>
      </article>
    </div>
  )
}

function EntryList(props: { source?: ReaderSourceOverview }) {
  const entries = props.source?.entries ?? []

  return (
    <section class="reader-entry-stack">
      <div class="reader-entry-stack-head">
        <div>
          <p class="reader-kicker">entries</p>
          <p class="reader-stack-copy">↑↓ 在当前列表内漫游，回车或点击后直接在当前条目下展开。</p>
        </div>
        <p
          id="reader-summary"
          class="reader-summary-text"
        >
          {props.source ? `${props.source.entries.length} 篇` : '0 篇'}
        </p>
      </div>
      <div
        id="reader-entry-list"
        class="reader-entry-list"
        role="listbox"
        aria-label="Entry 列表"
      >
        {entries.length === 0 ? (
          <p class="reader-empty">最近快照里还没有 entry。</p>
        ) : (
          entries.map((entry, index) => {
            const view = buildEntryView(entry)
            return (
              <section
                key={entry.itemId}
                class={`reader-entry-item${index === 0 ? ' is-expanded' : ''}`}
                data-entry-item={String(index)}
              >
                <button
                  type="button"
                  class={`reader-entry-button${index === 0 ? ' is-active' : ''}`}
                  data-entry-index={String(index)}
                  aria-selected={index === 0 ? 'true' : 'false'}
                  aria-expanded={index === 0 ? 'true' : 'false'}
                >
                  <span class="reader-entry-row">
                    <span class="reader-entry-name">{view.title}</span>
                    <span class={`reader-run-badge is-${view.status}`}>{view.statusLabel}</span>
                  </span>
                  <span class="reader-entry-excerpt">{view.excerpt}</span>
                </button>
                <EntryExpandedPanel
                  entry={entry}
                  expanded={index === 0}
                />
              </section>
            )
          })
        )}
      </div>
    </section>
  )
}

const readerPageScript = `(() => {
  const STATUS_LABELS = ${JSON.stringify({ success: '成功', partial: '部分成功', failed: '失败', skipped: '跳过', interrupted: '中断', running: '运行中', planned: '已计划' })}
  const PARSER_LABELS = ${JSON.stringify({ syndication: 'syndication', xquery: 'xquery', summary: 'summary' })}
  const TRANSPORT_LABELS = ${JSON.stringify({ http: 'http', byparr: 'byparr', summary: 'summary' })}
  const STRIP_MARKUP_PATTERNS = ${JSON.stringify([
    ['<(br|/p|/div|/li|/h[1-6])[^>]*>', '\\n'],
    ['<[^>]+>', ' '],
    ['&nbsp;', ' '],
    ['&amp;', '&'],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['\\r', ''],
    ['\\n{3,}', '\\n\\n'],
    ['[\\t ]+', ' '],
  ])}
  const STRIP_MARKUP_REPLACERS = STRIP_MARKUP_PATTERNS.map(
    ([pattern, replacement]) => [new RegExp(pattern, 'g'), replacement],
  )
  ${inlineBrowserFunction('formatStatus', formatStatus)}
  ${inlineBrowserFunction('formatParser', formatParser)}
  ${inlineBrowserFunction('formatTransport', formatTransport)}
  ${inlineBrowserFunction('formatDeliveryKinds', formatDeliveryKinds)}
  ${inlineBrowserFunction('stripMarkup', stripMarkup)}
  ${inlineBrowserFunction('getOverrideTextareaValue', getOverrideTextareaValue)}
  ${inlineBrowserFunction('buildSourceListItemView', buildSourceListItemView)}
  ${inlineBrowserFunction('buildSourceCardView', buildSourceCardView)}
  ${inlineBrowserFunction('buildFeedBannerView', buildFeedBannerView)}
  ${inlineBrowserFunction('buildEntryView', buildEntryView)}
  const bootstrap = document.getElementById('reader-bootstrap')
  const sourceList = document.getElementById('reader-source-list')
  const sourceCard = document.getElementById('reader-source-card')
  const feedBanner = document.getElementById('reader-feed-banner')
  const entryList = document.getElementById('reader-entry-list')
  const summary = document.getElementById('reader-summary')
  const managerPanel = document.getElementById('reader-manager')
  const managerTitle = document.getElementById('reader-manager-title')
  const managerName = document.getElementById('reader-manager-name')
  const managerSchedule = document.getElementById('reader-manager-schedule')
  const managerTransport = document.getElementById('reader-manager-transport')
  const managerParser = document.getElementById('reader-manager-parser')
  const managerTargetUrl = document.getElementById('reader-manager-target-url')
  const managerFilter = document.getElementById('reader-manager-filter')
  const managerXqueryFields = document.getElementById('reader-manager-xquery-fields')
  const managerXqueryLocate = document.getElementById('reader-manager-xquery-locate')
  const managerXqueryEntryId = document.getElementById('reader-manager-xquery-entry-id')
  const managerEnabled = document.getElementById('reader-manager-enabled')
  const managerSave = document.getElementById('reader-manager-save')
  const managerRun = document.getElementById('reader-manager-run')
  const managerClear = document.getElementById('reader-manager-clear')
  const managerMessage = document.getElementById('reader-manager-message')
  const managerError = document.getElementById('reader-manager-error')
  const confirmModal = document.getElementById('reader-confirm-modal')
  const confirmTitle = document.getElementById('reader-confirm-title')
  const confirmBody = document.getElementById('reader-confirm-body')
  const confirmCancel = document.getElementById('reader-confirm-cancel')
  const confirmConfirm = document.getElementById('reader-confirm-confirm')

  if (!(bootstrap instanceof HTMLScriptElement) ||
    !(sourceList instanceof HTMLElement) ||
    !(sourceCard instanceof HTMLElement) ||
    !(feedBanner instanceof HTMLElement) ||
    !(entryList instanceof HTMLElement) ||
    !(summary instanceof HTMLElement) ||
    !(managerPanel instanceof HTMLElement) ||
    !(managerTitle instanceof HTMLElement) ||
    !(managerName instanceof HTMLInputElement) ||
    !(managerSchedule instanceof HTMLInputElement) ||
    !(managerTransport instanceof HTMLSelectElement) ||
    !(managerParser instanceof HTMLSelectElement) ||
    !(managerTargetUrl instanceof HTMLInputElement) ||
    !(managerFilter instanceof HTMLTextAreaElement) ||
    !(managerXqueryFields instanceof HTMLElement) ||
    !(managerXqueryLocate instanceof HTMLInputElement) ||
    !(managerXqueryEntryId instanceof HTMLInputElement) ||
    !(managerEnabled instanceof HTMLInputElement) ||
    !(managerSave instanceof HTMLButtonElement) ||
    !(managerRun instanceof HTMLButtonElement) ||
    !(managerClear instanceof HTMLButtonElement) ||
    !(managerMessage instanceof HTMLElement) ||
    !(managerError instanceof HTMLElement) ||
    !(confirmModal instanceof HTMLElement) ||
    !(confirmTitle instanceof HTMLElement) ||
    !(confirmBody instanceof HTMLElement) ||
    !(confirmCancel instanceof HTMLButtonElement) ||
    !(confirmConfirm instanceof HTMLButtonElement)
  ) return

  let overview
  try {
    overview = JSON.parse(bootstrap.textContent || '{"sources": [], "deliveries": []}')
  } catch {
    return
  }

  const storageKey = 'knock.reader.sourceId'
  let sources = Array.isArray(overview?.sources) ? overview.sources : []
  const deliveries = Array.isArray(overview?.deliveries) ? overview.deliveries : []
  let sourceIndex = 0
  let entryIndex = 0
  let confirmResolver = undefined

  const make = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const escapeAttr = (value) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value)
    }
    return value.replace(/"/g, '\\"')
  }

  const getSource = () => sources[sourceIndex]
  const getEntries = () => Array.isArray(getSource()?.entries) ? getSource().entries : []
  const isEntryExpanded = (index) => entryIndex === index
  const isSummarySource = (source) => source?.transport === 'summary' || source?.parser === 'summary'
  const readStoredSourceId = () => {
    try {
      return sessionStorage.getItem(storageKey) || ''
    } catch {
      return ''
    }
  }
  const storeSourceId = (sourceId) => {
    try {
      if (typeof sourceId === 'string' && sourceId !== '') {
        sessionStorage.setItem(storageKey, sourceId)
      } else {
        sessionStorage.removeItem(storageKey)
      }
    } catch {
      // ignore
    }
  }
  const getDeliveryCheckboxes = () => {
    return Array.from(managerPanel.querySelectorAll('[data-delivery-id]')).filter((node) => node instanceof HTMLInputElement)
  }
  const getDeliveryEditor = (deliveryId) => managerPanel.querySelector('[data-delivery-editor="' + escapeAttr(deliveryId) + '"]')
  const getDeliveryField = (deliveryId) => managerPanel.querySelector('[data-delivery-field="' + escapeAttr(deliveryId) + '"]')
  const getDeliveryToggle = (deliveryId) => managerPanel.querySelector('[data-delivery-toggle="' + escapeAttr(deliveryId) + '"]')
  const clearManagerStatus = () => {
    managerMessage.hidden = true
    managerMessage.textContent = ''
    managerError.hidden = true
    managerError.textContent = ''
  }
  const showManagerMessage = (text) => {
    managerMessage.hidden = false
    managerMessage.textContent = text
    managerError.hidden = true
    managerError.textContent = ''
  }
  const showManagerError = (text) => {
    managerError.hidden = false
    managerError.textContent = text
    managerMessage.hidden = true
    managerMessage.textContent = ''
  }
  const setButtonState = (button, running, idleText, runningText) => {
    button.disabled = running
    button.textContent = running ? runningText : idleText
  }
  const closeConfirm = (accepted) => {
    confirmModal.hidden = true
    if (confirmResolver) {
      const resolve = confirmResolver
      confirmResolver = undefined
      resolve(accepted)
    }
  }
  const askConfirm = (title, body, confirmText) => {
    if (confirmResolver) {
      closeConfirm(false)
    }
    confirmTitle.textContent = title
    confirmBody.textContent = body
    confirmConfirm.textContent = confirmText
    confirmModal.hidden = false
    confirmCancel.focus()
    return new Promise((resolve) => {
      confirmResolver = resolve
    })
  }

  confirmCancel.addEventListener('click', () => closeConfirm(false))
  confirmConfirm.addEventListener('click', () => closeConfirm(true))
  confirmModal.addEventListener('click', (event) => {
    if (event.target === confirmModal) {
      closeConfirm(false)
    }
  })

  const createRunBadge = (status) => {
    const badge = make('span', 'reader-run-badge is-' + (status || 'idle'), formatStatus(status))
    return badge
  }

  const createMetaPair = (label, value) => {
    const wrap = make('div')
    wrap.appendChild(make('dt', '', label))
    wrap.appendChild(make('dd', '', value))
    return wrap
  }

  const focusSelectedSource = () => {
    const active = sourceList.querySelector('[data-source-index="' + String(sourceIndex) + '"]')
    if (active instanceof HTMLButtonElement) active.focus()
  }

  const focusSelectedEntry = () => {
    const active = entryList.querySelector('[data-entry-index="' + String(entryIndex) + '"]')
    if (active instanceof HTMLButtonElement) active.focus()
  }

  const renderDeliveryOverrides = (source) => {
    const selectedDeliveryIds = Array.isArray(source?.deliveryIds) ? source.deliveryIds : []
    const overrides = isRecord(source?.deliveryOverrides) ? source.deliveryOverrides : {}

    getDeliveryCheckboxes().forEach((input) => {
      const deliveryId = input.dataset.deliveryId || ''
      const editor = getDeliveryEditor(deliveryId)
      const field = getDeliveryField(deliveryId)
      const checked = selectedDeliveryIds.includes(deliveryId)
      input.checked = checked
      if (editor instanceof HTMLElement) {
        editor.hidden = !checked
      }
      const toggle = getDeliveryToggle(deliveryId)
      if (toggle instanceof HTMLElement) {
        toggle.classList.toggle('is-checked', checked)
      }
      if (!(field instanceof HTMLTextAreaElement) || !(editor instanceof HTMLElement)) {
        return
      }
      field.value = getOverrideTextareaValue(editor.dataset.deliveryKind, overrides[deliveryId])
    })
  }

  const syncManagerXqueryFields = (source) => {
    const summarySource = isSummarySource(source)
    const showXquery = !summarySource && managerParser.value === 'xquery'
    managerXqueryFields.hidden = !showXquery
    managerXqueryLocate.disabled = !showXquery
    managerXqueryEntryId.disabled = !showXquery
    managerTransport.disabled = summarySource
    managerParser.disabled = summarySource
    managerTargetUrl.disabled = summarySource
    const summaryTransport = managerTransport.querySelector('option[value="summary"]')
    if (summaryTransport instanceof HTMLOptionElement) {
      summaryTransport.disabled = !summarySource
    }
    const summaryParser = managerParser.querySelector('option[value="summary"]')
    if (summaryParser instanceof HTMLOptionElement) {
      summaryParser.disabled = !summarySource
    }
  }

  const renderSourceList = () => {
    sourceList.replaceChildren()
    sources.forEach((source, index) => {
      const view = buildSourceListItemView(source)
      const button = make('button', 'reader-source-button' + (index === sourceIndex ? ' is-active' : ''))
      button.type = 'button'
      button.dataset.sourceIndex = String(index)
      button.setAttribute('aria-selected', index === sourceIndex ? 'true' : 'false')
      button.setAttribute('tabindex', index === sourceIndex ? '0' : '-1')

      const headline = make('span', 'reader-source-headline')
      headline.appendChild(make('span', 'reader-source-name', view.name))
      headline.appendChild(make('span', 'reader-state-badge is-' + (view.enabled ? 'enabled' : 'disabled'), view.enabled ? '启用' : '停用'))

      const meta = make('span', 'reader-source-meta')
      meta.appendChild(make('span', '', view.parserLabel))
      meta.appendChild(make('span', '', view.transportLabel))
      meta.appendChild(make('span', '', view.deliveryKindsLabel))

      button.appendChild(headline)
      button.appendChild(meta)
      button.addEventListener('click', () => {
        sourceIndex = index
        entryIndex = 0
        storeSourceId(source.id)
        render()
        focusSelectedSource()
      })
      sourceList.appendChild(button)
    })
  }

  const renderSourceCard = () => {
    const view = buildSourceCardView(getSource())
    sourceCard.replaceChildren()

    if (view.emptyMessage) {
      sourceCard.appendChild(make('p', 'reader-empty', view.emptyMessage))
      return
    }

    const head = make('div', 'reader-card-head')
    const titleWrap = make('div')
    titleWrap.appendChild(make('p', 'reader-kicker', '当前 source'))
    titleWrap.appendChild(make('h2', 'reader-card-title', view.title))
    head.appendChild(titleWrap)
    head.appendChild(createRunBadge(view.status))

    const meta = make('dl', 'reader-meta-grid')
    view.meta.forEach((item) => {
      meta.appendChild(createMetaPair(item.label, item.value))
    })

    sourceCard.appendChild(head)
    sourceCard.appendChild(meta)

    if (typeof view.sourceUrl === 'string' && view.sourceUrl !== '') {
      const link = make('a', 'reader-link', '打开源地址')
      link.href = view.sourceUrl
      link.target = '_blank'
      link.rel = 'noreferrer'
      sourceCard.appendChild(link)
    }

    if (view.feedDescription) {
      const note = make('div', 'reader-feed-note')
      note.appendChild(make('p', 'reader-feed-title', view.feedTitle || '未命名 feed'))
      note.appendChild(make('p', 'reader-feed-description', view.feedDescription))
      sourceCard.appendChild(note)
    } else {
      sourceCard.appendChild(make('p', 'reader-empty', view.feedEmptyMessage))
    }
  }

  const renderFeedBanner = () => {
    const view = buildFeedBannerView(getSource())
    feedBanner.replaceChildren()

    if (view.emptyMessage) {
      feedBanner.appendChild(make('p', 'reader-empty', view.emptyMessage))
      return
    }

    const head = make('div', 'reader-banner-head')
    const titleWrap = make('div')
    titleWrap.appendChild(make('p', 'reader-kicker', 'feed 快照'))
    titleWrap.appendChild(make('h2', 'reader-banner-title', view.title))
    head.appendChild(titleWrap)
    head.appendChild(make('p', 'reader-banner-meta', '最近快照 · ' + view.statusLabel))

    const copy = make('p', 'reader-banner-copy', view.copy)
    const meta = make('dl', 'reader-feed-grid')
    view.meta.forEach((item) => {
      meta.appendChild(createMetaPair(item.label, item.value))
    })

    feedBanner.appendChild(head)
    feedBanner.appendChild(copy)
    feedBanner.appendChild(meta)
  }

  const renderManager = () => {
    const source = getSource()
    if (!source) {
      managerPanel.hidden = true
      return
    }

    managerPanel.hidden = false
    managerTitle.textContent = source.id
    managerName.value = source.name || source.id
    managerSchedule.value = typeof source.schedule === 'string' ? source.schedule : ''
    managerTransport.value = source.transport === 'byparr' ? 'byparr' : source.transport === 'summary' ? 'summary' : 'http'
    managerParser.value = source.parser === 'xquery' ? 'xquery' : source.parser === 'summary' ? 'summary' : 'syndication'
    managerTargetUrl.value = typeof source.sourceUrl === 'string' ? source.sourceUrl : ''
    managerFilter.value = typeof source.filter === 'string' ? source.filter : ''
    managerXqueryLocate.value = typeof source.xqueryLocate === 'string' ? source.xqueryLocate : ''
    managerXqueryEntryId.value = typeof source.xqueryEntryId === 'string' ? source.xqueryEntryId : ''
    managerEnabled.checked = Boolean(source.enabled)
    const enabledToggle = managerEnabled.closest('.reader-check')
    if (enabledToggle instanceof HTMLElement) {
      enabledToggle.classList.toggle('is-checked', managerEnabled.checked)
    }
    renderDeliveryOverrides(source)
    syncManagerXqueryFields(source)
    clearManagerStatus()
  }

  const renderEntryList = () => {
    const source = getSource()
    const entries = getEntries()
    entryList.replaceChildren()
    summary.textContent = source ? String(entries.length) + ' 篇' : '0 篇'

    if (entries.length === 0) {
      entryList.appendChild(make('p', 'reader-empty', '最近快照里还没有 entry。'))
      return
    }

    entries.forEach((entry, index) => {
      const view = buildEntryView(entry)
      const expanded = isEntryExpanded(index)
      const item = make('section', 'reader-entry-item' + (expanded ? ' is-expanded' : ''))
      item.dataset.entryItem = String(index)

      const button = make('button', 'reader-entry-button' + (expanded ? ' is-active' : ''))
      button.type = 'button'
      button.dataset.entryIndex = String(index)
      button.setAttribute('aria-selected', expanded ? 'true' : 'false')
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false')
      button.setAttribute('tabindex', expanded ? '0' : '-1')

      const row = make('span', 'reader-entry-row')
      row.appendChild(make('span', 'reader-entry-name', view.title))
      row.appendChild(createRunBadge(view.status))
      button.appendChild(row)
      button.appendChild(make('span', 'reader-entry-excerpt', view.excerpt))
      button.addEventListener('click', () => {
        entryIndex = expanded ? -1 : index
        renderEntryList()
        if (!expanded) {
          focusSelectedEntry()
        }
      })
      item.appendChild(button)

      const shell = make('div', 'reader-entry-expand-shell' + (expanded ? ' is-expanded' : ''))
      shell.setAttribute('aria-hidden', expanded ? 'false' : 'true')

      const article = make('article', 'reader-entry-expanded')

      const head = make('header', 'reader-article-head')
      const titleWrap = make('div')
      titleWrap.appendChild(make('p', 'reader-kicker', 'entry 阅读面'))
      titleWrap.appendChild(make('h3', 'reader-article-title', view.title))
      head.appendChild(titleWrap)
      head.appendChild(createRunBadge(view.status))
      article.appendChild(head)

      const meta = make('dl', 'reader-meta-grid reader-entry-meta-grid')
      view.meta.forEach((itemView) => {
        meta.appendChild(createMetaPair(itemView.label, itemView.value))
      })
      article.appendChild(meta)

      if (typeof view.link === 'string' && view.link !== '') {
        const link = make('a', 'reader-link', '打开原文')
        link.href = view.link
        link.target = '_blank'
        link.rel = 'noreferrer'
        article.appendChild(link)
      }

      const summarySection = make('section', 'reader-article-section')
      summarySection.appendChild(make('h4', '', '摘要'))
      summarySection.appendChild(make('p', 'reader-article-copy', view.summary))
      article.appendChild(summarySection)

      const contentSection = make('section', 'reader-article-section')
      contentSection.appendChild(make('h4', '', '内容'))
      contentSection.appendChild(make('pre', 'reader-article-content', view.content))
      article.appendChild(contentSection)

      shell.appendChild(article)
      item.appendChild(shell)
      entryList.appendChild(item)
    })
  }

  const render = () => {
    if (sourceIndex >= sources.length) sourceIndex = 0
    const entries = getEntries()
    if (entryIndex >= entries.length) entryIndex = entries.length === 0 ? -1 : 0
    renderSourceList()
    renderSourceCard()
    renderFeedBanner()
    renderManager()
    renderEntryList()
  }

  const applyOverview = (nextOverview, preferredSourceId) => {
    if (!isRecord(nextOverview)) return
    sources = Array.isArray(nextOverview.sources) ? nextOverview.sources : []
    const nextIndex = typeof preferredSourceId === 'string' && preferredSourceId !== ''
      ? sources.findIndex((source) => source?.id === preferredSourceId)
      : 0
    sourceIndex = nextIndex >= 0 ? nextIndex : 0
    render()
  }

  const requestAction = async (path, payload) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(typeof body?.message === 'string' ? body.message : '请求失败')
    }
    return body
  }

  const buildDeliveryOverrides = () => {
    const overrides = {}
    getDeliveryCheckboxes()
      .filter((input) => input.checked)
      .forEach((input) => {
        const deliveryId = input.dataset.deliveryId || ''
        const editor = getDeliveryEditor(deliveryId)
        const field = getDeliveryField(deliveryId)
        if (!(editor instanceof HTMLElement) || !(field instanceof HTMLTextAreaElement)) {
          overrides[deliveryId] = {}
          return
        }
        const raw = field.value.trim()
        const kind = editor.dataset.deliveryKind
        if (kind === 'file') {
          overrides[deliveryId] = raw === '' ? {} : { content: field.value }
          return
        }
        if (raw === '') {
          overrides[deliveryId] = {}
          return
        }
        try {
          const parsed = JSON.parse(raw)
          overrides[deliveryId] = kind === 'push' ? { payload: parsed } : { message: parsed }
        } catch {
          throw new Error(deliveryId + ' override 必须是合法 JSON')
        }
      })
    return overrides
  }

  const buildManagerPayload = () => {
    const source = getSource()
    if (!source) return undefined
    return {
      sourceId: source.id,
      name: managerName.value,
      enabled: managerEnabled.checked,
      schedule: managerSchedule.value,
      filter: managerFilter.value,
      deliveryIds: getDeliveryCheckboxes()
        .filter((input) => input.checked)
        .map((input) => input.dataset.deliveryId)
        .filter((value) => typeof value === 'string' && value !== ''),
      deliveryOverrides: buildDeliveryOverrides(),
      transport: managerTransport.value === 'byparr'
        ? 'byparr'
        : managerTransport.value === 'summary'
          ? 'summary'
          : 'http',
      parser: managerParser.value === 'xquery'
        ? 'xquery'
        : managerParser.value === 'summary'
          ? 'summary'
          : 'syndication',
      targetUrl: managerTargetUrl.value,
      xqueryLocate: managerXqueryLocate.value,
      xqueryEntryId: managerXqueryEntryId.value,
    }
  }

  managerEnabled.addEventListener('change', () => {
    const toggle = managerEnabled.closest('.reader-check')
    if (toggle instanceof HTMLElement) {
      toggle.classList.toggle('is-checked', managerEnabled.checked)
    }
  })

  managerParser.addEventListener('change', () => {
    syncManagerXqueryFields(getSource())
  })

  managerPanel.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.dataset.deliveryId === undefined) {
      return
    }
    const deliveryId = target.dataset.deliveryId
    const editor = getDeliveryEditor(deliveryId)
    if (editor instanceof HTMLElement) {
      editor.hidden = !target.checked
    }
    const toggle = getDeliveryToggle(deliveryId)
    if (toggle instanceof HTMLElement) {
      toggle.classList.toggle('is-checked', target.checked)
    }
  })

  managerSave.addEventListener('click', async () => {
    const source = getSource()
    const payload = buildManagerPayload()
    if (!source || !payload) return
    clearManagerStatus()
    setButtonState(managerSave, true, '保存配置', '保存中…')
    try {
      const result = await requestAction('/api/sources/update', payload)
      storeSourceId(source.id)
      applyOverview(result?.overview, source.id)
      showManagerMessage(typeof result?.message === 'string' ? result.message : 'source 配置已保存')
    } catch (error) {
      showManagerError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setButtonState(managerSave, false, '保存配置', '保存中…')
    }
  })

  managerRun.addEventListener('click', async () => {
    const source = getSource()
    if (!source) return
    clearManagerStatus()
    setButtonState(managerRun, true, '强制获取', '抓取中…')
    try {
      const result = await requestAction('/api/sources/run', { sourceId: source.id })
      storeSourceId(source.id)
      applyOverview(result?.overview, source.id)
      showManagerMessage(typeof result?.message === 'string' ? result.message : 'source 强制获取完成')
    } catch (error) {
      showManagerError(error instanceof Error ? error.message : '强制获取失败')
    } finally {
      setButtonState(managerRun, false, '强制获取', '抓取中…')
    }
  })

  managerClear.addEventListener('click', async () => {
    const source = getSource()
    if (!source) return
    const confirmed = await askConfirm(
      '确认清空历史',
      '确认清空 source ' + source.id + ' 的历史吗？这不会删除 dedupe 记录。',
      '确认清空',
    )
    if (!confirmed) {
      return
    }
    clearManagerStatus()
    setButtonState(managerClear, true, '清空历史', '清理中…')
    try {
      const result = await requestAction('/api/sources/clear', { sourceId: source.id })
      storeSourceId(source.id)
      applyOverview(result?.overview, source.id)
      showManagerMessage(typeof result?.message === 'string' ? result.message : 'source 历史已清空')
    } catch (error) {
      showManagerError(error instanceof Error ? error.message : '清空历史失败')
    } finally {
      setButtonState(managerClear, false, '清空历史', '清理中…')
    }
  })

  document.addEventListener('keydown', (event) => {
    if (!confirmModal.hidden && event.key === 'Escape') {
      event.preventDefault()
      closeConfirm(false)
      return
    }

    if (sources.length === 0) return
    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusSelectedSource()
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusSelectedEntry()
      return
    }

    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }

    const active = document.activeElement
    const inEntryList = active instanceof Node && entryList.contains(active)
    const delta = event.key === 'ArrowDown' ? 1 : -1

    if (inEntryList) {
      const entries = getEntries()
      if (entries.length === 0) return
      event.preventDefault()
      const activeIndex = entryIndex < 0 ? 0 : entryIndex
      entryIndex = Math.min(entries.length - 1, Math.max(0, activeIndex + delta))
      renderEntryList()
      focusSelectedEntry()
      return
    }

    event.preventDefault()
    sourceIndex = Math.min(sources.length - 1, Math.max(0, sourceIndex + delta))
    entryIndex = -1
    storeSourceId(getSource()?.id || '')
    render()
    focusSelectedSource()
  })

  const preferredSourceId = readStoredSourceId()
  if (preferredSourceId) {
    const nextIndex = sources.findIndex((source) => source?.id === preferredSourceId)
    if (nextIndex >= 0) {
      sourceIndex = nextIndex
    }
  }

  render()
})()`

export default function ReaderPage(props: { overview: ReaderOverview }) {
  const source = getInitialSource(props.overview)

  return (
    <AppShell
      title="RSS Reader"
      subtitle="按 source 浏览最近一次可读快照；Web 端负责阅读，推送仍保留为 delivery 特色能力。"
    >
      <section class="reader-layout">
        <aside class="panel reader-sidebar">
          <div class="reader-sidebar-head">
            <div>
              <p class="reader-kicker">source archive</p>
              <p class="reader-sidebar-copy">左栏先定 source，再看 feed 与 entry。</p>
            </div>
            <p class="reader-summary-text">{props.overview.sources.length} 个 source</p>
          </div>
          {props.overview.issue ? (
            <p
              id="reader-issue"
              class="reader-issue"
            >
              {props.overview.issue}
            </p>
          ) : null}
          <SourceList sources={props.overview.sources} />
          <SourceCard source={source} />
        </aside>

        <section class="reader-main-column">
          <FeedBanner source={source} />
          <SourceManager
            source={source}
            allDeliveries={props.overview.deliveries}
          />
          <EntryList source={source} />
        </section>
      </section>
      <script
        id="reader-bootstrap"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: toBootstrapJson(props.overview) }}
      />
      <script dangerouslySetInnerHTML={{ __html: readerPageScript }} />
    </AppShell>
  )
}
