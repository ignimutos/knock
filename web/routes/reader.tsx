import { AppShell } from '../components/layout/app_shell.tsx'
import type {
  ReaderEntrySnapshot,
  ReaderOverview,
  ReaderSourceOverview,
} from '../../src/web/reader_overview.ts'

function toBootstrapJson(overview: ReaderOverview): string {
  return JSON.stringify(overview).replace(/</g, '<')
}

function formatStatus(status: string | undefined): string {
  switch (status) {
    case 'success':
      return '成功'
    case 'partial':
      return '部分成功'
    case 'failed':
      return '失败'
    case 'skipped':
      return '跳过'
    case 'interrupted':
      return '中断'
    case 'running':
      return '运行中'
    case 'planned':
      return '已计划'
    default:
      return '暂无'
  }
}

function formatParser(parser: ReaderSourceOverview['parser']): string {
  switch (parser) {
    case 'summary':
      return 'summary'
    case 'xquery':
      return 'xquery'
    default:
      return 'syndication'
  }
}

function formatTransport(transport: ReaderSourceOverview['transport']): string {
  switch (transport) {
    case 'summary':
      return 'summary'
    case 'byparr':
      return 'byparr'
    default:
      return 'http'
  }
}

function formatDeliveryKinds(kinds: ReaderSourceOverview['deliveryKinds']): string {
  return kinds.length === 0 ? '无投递' : kinds.join(' · ')
}

function stripMarkup(value: string | undefined): string {
  if (!value) return ''

  return value
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\t ]+/g, ' ')
    .trim()
}

function getInitialSource(overview: ReaderOverview): ReaderSourceOverview | undefined {
  return overview.sources[0]
}

function getAllDeliveryIds(overview: ReaderOverview): string[] {
  return Array.from(new Set(overview.sources.flatMap((source) => source.deliveryIds))).sort(
    (left, right) => left.localeCompare(right, 'en'),
  )
}

function isSummarySource(source: ReaderSourceOverview | undefined): boolean {
  return source?.transport === 'summary' || source?.parser === 'summary'
}

function SourceList(props: { sources: ReaderOverview['sources'] }) {
  return (
    <div
      id="reader-source-list"
      class="reader-source-list"
      role="listbox"
      aria-label="Source 列表"
    >
      {props.sources.map((source, index) => (
        <button
          type="button"
          class={`reader-source-button${index === 0 ? ' is-active' : ''}`}
          data-reader-source={source.id}
          data-source-index={String(index)}
          aria-selected={index === 0 ? 'true' : 'false'}
        >
          <span class="reader-source-headline">
            <span class="reader-source-name">{source.name}</span>
            <span class={`reader-state-badge is-${source.enabled ? 'enabled' : 'disabled'}`}>
              {source.enabled ? '启用' : '停用'}
            </span>
          </span>
          <span class="reader-source-meta">
            <span>{formatParser(source.parser)}</span>
            <span>{formatTransport(source.transport)}</span>
            <span>{formatDeliveryKinds(source.deliveryKinds)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function SourceCard(props: { source?: ReaderSourceOverview }) {
  if (!props.source) {
    return (
      <section
        id="reader-source-card"
        class="reader-source-card"
      >
        <p class="reader-empty">还没有可浏览的 source。</p>
      </section>
    )
  }

  const source = props.source

  return (
    <section
      id="reader-source-card"
      class="reader-source-card"
    >
      <div class="reader-card-head">
        <div>
          <p class="reader-kicker">当前 source</p>
          <h2 class="reader-card-title">{source.name}</h2>
        </div>
        <span class={`reader-run-badge is-${source.lastRun?.status ?? 'idle'}`}>
          {formatStatus(source.lastRun?.status)}
        </span>
      </div>
      <dl class="reader-meta-grid">
        <div>
          <dt>parser</dt>
          <dd>{formatParser(source.parser)}</dd>
        </div>
        <div>
          <dt>transport</dt>
          <dd>{formatTransport(source.transport)}</dd>
        </div>
        <div>
          <dt>deliveries</dt>
          <dd>{source.deliveryCount}</dd>
        </div>
        <div>
          <dt>entries</dt>
          <dd>{source.entries.length}</dd>
        </div>
      </dl>
      {source.sourceUrl ? (
        <a
          href={source.sourceUrl}
          class="reader-link"
          target="_blank"
          rel="noreferrer"
        >
          打开源地址
        </a>
      ) : null}
      {source.feed ? (
        <div class="reader-feed-note">
          <p class="reader-feed-title">{source.feed.title || '未命名 feed'}</p>
          <p class="reader-feed-description">
            {stripMarkup(source.feed.description) || '暂无 feed 描述。'}
          </p>
        </div>
      ) : (
        <p class="reader-empty">最近快照里还没有 feed 内容。</p>
      )}
    </section>
  )
}

function FeedBanner(props: { source?: ReaderSourceOverview }) {
  if (!props.source) {
    return (
      <section
        id="reader-feed-banner"
        class="reader-feed-banner"
      >
        <p class="reader-empty">选择 source 后，这里会显示 feed 快照。</p>
      </section>
    )
  }

  const feed = props.source.feed

  return (
    <section
      id="reader-feed-banner"
      class="reader-feed-banner"
    >
      <div class="reader-banner-head">
        <div>
          <p class="reader-kicker">feed 快照</p>
          <h2 class="reader-banner-title">{feed?.title || props.source.name}</h2>
        </div>
        <p class="reader-banner-meta">最近快照 · {formatStatus(props.source.lastRun?.status)}</p>
      </div>
      <p class="reader-banner-copy">
        {stripMarkup(feed?.description) || '这个 source 暂时没有可展示的 feed 描述。'}
      </p>
      <dl class="reader-feed-grid">
        <div>
          <dt>published</dt>
          <dd>{feed?.published || '—'}</dd>
        </div>
        <div>
          <dt>language</dt>
          <dd>{feed?.language || '—'}</dd>
        </div>
        <div>
          <dt>generator</dt>
          <dd>{feed?.generator || '—'}</dd>
        </div>
        <div>
          <dt>counts</dt>
          <dd>{props.source.lastRun ? props.source.lastRun.counts.parsedCount : 0} parsed</dd>
        </div>
      </dl>
    </section>
  )
}

function SourceManager(props: { source?: ReaderSourceOverview; allDeliveryIds: string[] }) {
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

      <label class="reader-manager-checkbox">
        <input
          id="reader-manager-enabled"
          type="checkbox"
          checked={source.enabled}
        />
        <span>启用该 source</span>
      </label>

      <div class="reader-manager-deliveries">
        <p class="reader-kicker">deliveries</p>
        <div
          id="reader-manager-delivery-list"
          class="reader-manager-delivery-list"
        >
          {props.allDeliveryIds.length === 0 ? (
            <p class="reader-empty">当前没有可绑定 delivery。</p>
          ) : (
            props.allDeliveryIds.map((deliveryId) => (
              <label class="reader-manager-delivery-item">
                <input
                  type="checkbox"
                  data-delivery-id={deliveryId}
                  checked={source.deliveryIds.includes(deliveryId)}
                />
                <span>{deliveryId}</span>
              </label>
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
    </section>
  )
}

function EntryExpandedPanel(props: { entry: ReaderEntrySnapshot; expanded: boolean }) {
  const entry = props.entry

  return (
    <div
      class={`reader-entry-expand-shell${props.expanded ? ' is-expanded' : ''}`}
      aria-hidden={props.expanded ? 'false' : 'true'}
    >
      <article class="reader-entry-expanded">
        <header class="reader-article-head">
          <div>
            <p class="reader-kicker">entry 阅读面</p>
            <h3 class="reader-article-title">{entry.title || entry.id}</h3>
          </div>
          <span class={`reader-run-badge is-${entry.status}`}>{formatStatus(entry.status)}</span>
        </header>
        <dl class="reader-meta-grid reader-entry-meta-grid">
          <div>
            <dt>published</dt>
            <dd>{entry.published || '—'}</dd>
          </div>
          <div>
            <dt>updated</dt>
            <dd>{entry.updated || '—'}</dd>
          </div>
          <div>
            <dt>entry id</dt>
            <dd>{entry.id}</dd>
          </div>
          <div>
            <dt>status</dt>
            <dd>{formatStatus(entry.status)}</dd>
          </div>
        </dl>
        {entry.link ? (
          <a
            href={entry.link}
            class="reader-link"
            target="_blank"
            rel="noreferrer"
          >
            打开原文
          </a>
        ) : null}
        <section class="reader-article-section">
          <h4>摘要</h4>
          <p class="reader-article-copy">{stripMarkup(entry.description) || '暂无摘要。'}</p>
        </section>
        <section class="reader-article-section">
          <h4>内容</h4>
          <pre class="reader-article-content">{stripMarkup(entry.content) || '暂无正文。'}</pre>
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
          entries.map((entry, index) => (
            <section
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
                  <span class="reader-entry-name">{entry.title || entry.id}</span>
                  <span class={`reader-run-badge is-${entry.status}`}>
                    {formatStatus(entry.status)}
                  </span>
                </span>
                <span class="reader-entry-excerpt">
                  {stripMarkup(entry.description || entry.content) || '暂无摘要。'}
                </span>
              </button>
              <EntryExpandedPanel
                entry={entry}
                expanded={index === 0}
              />
            </section>
          ))
        )}
      </div>
    </section>
  )
}

const readerPageScript = `(() => {
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
  const managerDeliveryList = document.getElementById('reader-manager-delivery-list')
  const managerSave = document.getElementById('reader-manager-save')
  const managerRun = document.getElementById('reader-manager-run')
  const managerClear = document.getElementById('reader-manager-clear')
  const managerMessage = document.getElementById('reader-manager-message')
  const managerError = document.getElementById('reader-manager-error')

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
    !(managerDeliveryList instanceof HTMLElement) ||
    !(managerSave instanceof HTMLButtonElement) ||
    !(managerRun instanceof HTMLButtonElement) ||
    !(managerClear instanceof HTMLButtonElement) ||
    !(managerMessage instanceof HTMLElement) ||
    !(managerError instanceof HTMLElement)
  ) return

  let overview
  try {
    overview = JSON.parse(bootstrap.textContent || '{"sources": []}')
  } catch {
    return
  }

  const storageKey = 'knock.reader.sourceId'
  const sources = Array.isArray(overview?.sources) ? overview.sources : []
  let sourceIndex = 0
  let entryIndex = 0

  const stripMarkup = (value) => {
    if (typeof value !== 'string' || value.trim() === '') return ''
    return value
      .replace(/<(br|\\/p|\\/div|\\/li|\\/h[1-6])[^>]*>/gi, '\\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\\r/g, '')
      .replace(/\\n{3,}/g, '\\n\\n')
      .replace(/[\\t ]+/g, ' ')
      .trim()
  }

  const formatStatus = (status) => {
    switch (status) {
      case 'success': return '成功'
      case 'partial': return '部分成功'
      case 'failed': return '失败'
      case 'skipped': return '跳过'
      case 'interrupted': return '中断'
      case 'running': return '运行中'
      case 'planned': return '已计划'
      default: return '暂无'
    }
  }

  const formatParser = (parser) => parser === 'summary' ? 'summary' : parser === 'xquery' ? 'xquery' : 'syndication'
  const formatTransport = (transport) => transport === 'summary' ? 'summary' : transport === 'byparr' ? 'byparr' : 'http'
  const formatDeliveryKinds = (kinds) => Array.isArray(kinds) && kinds.length > 0 ? kinds.join(' · ') : '无投递'
  const make = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
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
    return Array.from(managerDeliveryList.querySelectorAll('[data-delivery-id]')).filter((node) => node instanceof HTMLInputElement)
  }
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
      const button = make('button', 'reader-source-button' + (index === sourceIndex ? ' is-active' : ''))
      button.type = 'button'
      button.dataset.sourceIndex = String(index)
      button.setAttribute('aria-selected', index === sourceIndex ? 'true' : 'false')
      button.setAttribute('tabindex', index === sourceIndex ? '0' : '-1')

      const headline = make('span', 'reader-source-headline')
      headline.appendChild(make('span', 'reader-source-name', source.name || source.id))
      headline.appendChild(make('span', 'reader-state-badge is-' + (source.enabled ? 'enabled' : 'disabled'), source.enabled ? '启用' : '停用'))

      const meta = make('span', 'reader-source-meta')
      meta.appendChild(make('span', '', formatParser(source.parser)))
      meta.appendChild(make('span', '', formatTransport(source.transport)))
      meta.appendChild(make('span', '', formatDeliveryKinds(source.deliveryKinds)))

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
    const source = getSource()
    sourceCard.replaceChildren()

    if (!source) {
      sourceCard.appendChild(make('p', 'reader-empty', '还没有可浏览的 source。'))
      return
    }

    const head = make('div', 'reader-card-head')
    const titleWrap = make('div')
    titleWrap.appendChild(make('p', 'reader-kicker', '当前 source'))
    titleWrap.appendChild(make('h2', 'reader-card-title', source.name || source.id))
    head.appendChild(titleWrap)
    head.appendChild(createRunBadge(source.lastRun?.status))

    const meta = make('dl', 'reader-meta-grid')
    meta.appendChild(createMetaPair('parser', formatParser(source.parser)))
    meta.appendChild(createMetaPair('transport', formatTransport(source.transport)))
    meta.appendChild(createMetaPair('deliveries', String(source.deliveryCount || 0)))
    meta.appendChild(createMetaPair('entries', String(getEntries().length)))

    sourceCard.appendChild(head)
    sourceCard.appendChild(meta)

    if (typeof source.sourceUrl === 'string' && source.sourceUrl !== '') {
      const link = make('a', 'reader-link', '打开源地址')
      link.href = source.sourceUrl
      link.target = '_blank'
      link.rel = 'noreferrer'
      sourceCard.appendChild(link)
    }

    if (source.feed) {
      const note = make('div', 'reader-feed-note')
      note.appendChild(make('p', 'reader-feed-title', source.feed.title || '未命名 feed'))
      note.appendChild(make('p', 'reader-feed-description', stripMarkup(source.feed.description) || '暂无 feed 描述。'))
      sourceCard.appendChild(note)
    } else {
      sourceCard.appendChild(make('p', 'reader-empty', '最近快照里还没有 feed 内容。'))
    }
  }

  const renderFeedBanner = () => {
    const source = getSource()
    feedBanner.replaceChildren()

    if (!source) {
      feedBanner.appendChild(make('p', 'reader-empty', '选择 source 后，这里会显示 feed 快照。'))
      return
    }

    const head = make('div', 'reader-banner-head')
    const titleWrap = make('div')
    titleWrap.appendChild(make('p', 'reader-kicker', 'feed 快照'))
    titleWrap.appendChild(make('h2', 'reader-banner-title', source.feed?.title || source.name || source.id))
    head.appendChild(titleWrap)
    head.appendChild(make('p', 'reader-banner-meta', '最近快照 · ' + formatStatus(source.lastRun?.status)))

    const copy = make('p', 'reader-banner-copy', stripMarkup(source.feed?.description) || '这个 source 暂时没有可展示的 feed 描述。')
    const meta = make('dl', 'reader-feed-grid')
    meta.appendChild(createMetaPair('published', source.feed?.published || '—'))
    meta.appendChild(createMetaPair('language', source.feed?.language || '—'))
    meta.appendChild(createMetaPair('generator', source.feed?.generator || '—'))
    meta.appendChild(createMetaPair('counts', String(source.lastRun?.counts?.parsedCount || 0) + ' parsed'))

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
    const selectedDeliveryIds = Array.isArray(source.deliveryIds) ? source.deliveryIds : []
    getDeliveryCheckboxes().forEach((input) => {
      const deliveryId = input.dataset.deliveryId || ''
      input.checked = selectedDeliveryIds.includes(deliveryId)
    })
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
      row.appendChild(make('span', 'reader-entry-name', entry.title || entry.id))
      row.appendChild(createRunBadge(entry.status))
      button.appendChild(row)
      button.appendChild(make('span', 'reader-entry-excerpt', stripMarkup(entry.description || entry.content) || '暂无摘要。'))
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
      titleWrap.appendChild(make('h3', 'reader-article-title', entry.title || entry.id))
      head.appendChild(titleWrap)
      head.appendChild(createRunBadge(entry.status))
      article.appendChild(head)

      const meta = make('dl', 'reader-meta-grid reader-entry-meta-grid')
      meta.appendChild(createMetaPair('published', entry.published || '—'))
      meta.appendChild(createMetaPair('updated', entry.updated || '—'))
      meta.appendChild(createMetaPair('entry id', entry.id || '—'))
      meta.appendChild(createMetaPair('status', formatStatus(entry.status)))
      article.appendChild(meta)

      if (typeof entry.link === 'string' && entry.link !== '') {
        const link = make('a', 'reader-link', '打开原文')
        link.href = entry.link
        link.target = '_blank'
        link.rel = 'noreferrer'
        article.appendChild(link)
      }

      const summarySection = make('section', 'reader-article-section')
      summarySection.appendChild(make('h4', '', '摘要'))
      summarySection.appendChild(make('p', 'reader-article-copy', stripMarkup(entry.description) || '暂无摘要。'))
      article.appendChild(summarySection)

      const contentSection = make('section', 'reader-article-section')
      contentSection.appendChild(make('h4', '', '内容'))
      contentSection.appendChild(make('pre', 'reader-article-content', stripMarkup(entry.content) || '暂无正文。'))
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
      transport: managerTransport.value === 'byparr' ? 'byparr' : managerTransport.value === 'summary' ? 'summary' : 'http',
      parser: managerParser.value === 'xquery' ? 'xquery' : managerParser.value === 'summary' ? 'summary' : 'syndication',
      targetUrl: managerTargetUrl.value,
      xqueryLocate: managerXqueryLocate.value,
      xqueryEntryId: managerXqueryEntryId.value,
    }
  }

  managerParser.addEventListener('change', () => {
    syncManagerXqueryFields(getSource())
  })

  managerSave.addEventListener('click', async () => {
    const source = getSource()
    const payload = buildManagerPayload()
    if (!source || !payload) return
    clearManagerStatus()
    setButtonState(managerSave, true, '保存配置', '保存中…')
    try {
      const result = await requestAction('/api/sources/update', payload)
      showManagerMessage(typeof result?.message === 'string' ? result.message : 'source 配置已保存')
      storeSourceId(source.id)
      window.location.reload()
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
      showManagerMessage(typeof result?.message === 'string' ? result.message : 'source 强制获取完成')
      storeSourceId(source.id)
      window.location.reload()
    } catch (error) {
      showManagerError(error instanceof Error ? error.message : '强制获取失败')
    } finally {
      setButtonState(managerRun, false, '强制获取', '抓取中…')
    }
  })

  managerClear.addEventListener('click', async () => {
    const source = getSource()
    if (!source) return
    if (!window.confirm('确认清空 source ' + source.id + ' 的历史吗？这不会删除 dedupe 记录。')) {
      return
    }
    clearManagerStatus()
    setButtonState(managerClear, true, '清空历史', '清理中…')
    try {
      const result = await requestAction('/api/sources/clear', { sourceId: source.id })
      showManagerMessage(typeof result?.message === 'string' ? result.message : 'source 历史已清空')
      storeSourceId(source.id)
      window.location.reload()
    } catch (error) {
      showManagerError(error instanceof Error ? error.message : '清空历史失败')
    } finally {
      setButtonState(managerClear, false, '清空历史', '清理中…')
    }
  })

  document.addEventListener('keydown', (event) => {
    if (sources.length === 0) return
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) {
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
  const allDeliveryIds = getAllDeliveryIds(props.overview)

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
            allDeliveryIds={allDeliveryIds}
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
