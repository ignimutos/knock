import { AppShell } from '../components/layout/app_shell.tsx'
import type {
  ReaderEntrySnapshot,
  ReaderOverview,
  ReaderSourceOverview,
} from '../../src/web/reader_overview.ts'

function toBootstrapJson(overview: ReaderOverview): string {
  return JSON.stringify(overview).replace(/</g, '\\u003c')
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

function getInitialEntry(
  source: ReaderSourceOverview | undefined,
): ReaderEntrySnapshot | undefined {
  return source?.entries[0]
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

function EntryList(props: { source?: ReaderSourceOverview }) {
  const entries = props.source?.entries ?? []

  return (
    <section class="reader-entry-stack">
      <div class="reader-entry-stack-head">
        <div>
          <p class="reader-kicker">entries</p>
          <p class="reader-stack-copy">↑↓ 在当前列表内漫游，←→ 在 source / entry 间切换焦点。</p>
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
            <button
              type="button"
              class={`reader-entry-button${index === 0 ? ' is-active' : ''}`}
              data-entry-index={String(index)}
              aria-selected={index === 0 ? 'true' : 'false'}
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
          ))
        )}
      </div>
    </section>
  )
}

function EntryPanel(props: { entry?: ReaderEntrySnapshot }) {
  if (!props.entry) {
    return (
      <article
        id="reader-entry-panel"
        class="reader-entry-panel"
      >
        <p class="reader-empty">选择 entry 后，这里会显示正文。</p>
      </article>
    )
  }

  const entry = props.entry

  return (
    <article
      id="reader-entry-panel"
      class="reader-entry-panel"
    >
      <header class="reader-article-head">
        <div>
          <p class="reader-kicker">entry 阅读面</p>
          <h2 class="reader-article-title">{entry.title || entry.id}</h2>
        </div>
        <span class={`reader-run-badge is-${entry.status}`}>{formatStatus(entry.status)}</span>
      </header>
      <dl class="reader-meta-grid">
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
        <h3>摘要</h3>
        <p class="reader-article-copy">{stripMarkup(entry.description) || '暂无摘要。'}</p>
      </section>
      <section class="reader-article-section">
        <h3>内容</h3>
        <pre class="reader-article-content">{stripMarkup(entry.content) || '暂无正文。'}</pre>
      </section>
    </article>
  )
}

const readerPageScript = `(() => {
  const bootstrap = document.getElementById('reader-bootstrap')
  const sourceList = document.getElementById('reader-source-list')
  const sourceCard = document.getElementById('reader-source-card')
  const feedBanner = document.getElementById('reader-feed-banner')
  const entryList = document.getElementById('reader-entry-list')
  const entryPanel = document.getElementById('reader-entry-panel')
  const summary = document.getElementById('reader-summary')

  if (!(bootstrap instanceof HTMLScriptElement) ||
    !(sourceList instanceof HTMLElement) ||
    !(sourceCard instanceof HTMLElement) ||
    !(feedBanner instanceof HTMLElement) ||
    !(entryList instanceof HTMLElement) ||
    !(entryPanel instanceof HTMLElement) ||
    !(summary instanceof HTMLElement)
  ) return

  let overview
  try {
    overview = JSON.parse(bootstrap.textContent || '{"sources": []}')
  } catch {
    return
  }

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
  const getEntry = () => getEntries()[entryIndex]

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

  const renderSourceList = () => {
    sourceList.replaceChildren()
    sources.forEach((source, index) => {
      const button = make('button', 'reader-source-button' + (index === sourceIndex ? ' is-active' : ''))
      button.type = 'button'
      button.dataset.sourceIndex = String(index)
      button.setAttribute('aria-selected', index === sourceIndex ? 'true' : 'false')

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
      const button = make('button', 'reader-entry-button' + (index === entryIndex ? ' is-active' : ''))
      button.type = 'button'
      button.dataset.entryIndex = String(index)
      button.setAttribute('aria-selected', index === entryIndex ? 'true' : 'false')

      const row = make('span', 'reader-entry-row')
      row.appendChild(make('span', 'reader-entry-name', entry.title || entry.id))
      row.appendChild(createRunBadge(entry.status))
      button.appendChild(row)
      button.appendChild(make('span', 'reader-entry-excerpt', stripMarkup(entry.description || entry.content) || '暂无摘要。'))
      button.addEventListener('click', () => {
        entryIndex = index
        renderEntryPanel()
        renderEntryList()
        focusSelectedEntry()
      })
      entryList.appendChild(button)
    })
  }

  const renderEntryPanel = () => {
    const entry = getEntry()
    entryPanel.replaceChildren()

    if (!entry) {
      entryPanel.appendChild(make('p', 'reader-empty', '选择 entry 后，这里会显示正文。'))
      return
    }

    const head = make('header', 'reader-article-head')
    const titleWrap = make('div')
    titleWrap.appendChild(make('p', 'reader-kicker', 'entry 阅读面'))
    titleWrap.appendChild(make('h2', 'reader-article-title', entry.title || entry.id))
    head.appendChild(titleWrap)
    head.appendChild(createRunBadge(entry.status))

    const meta = make('dl', 'reader-meta-grid')
    meta.appendChild(createMetaPair('published', entry.published || '—'))
    meta.appendChild(createMetaPair('updated', entry.updated || '—'))
    meta.appendChild(createMetaPair('entry id', entry.id || '—'))
    meta.appendChild(createMetaPair('status', formatStatus(entry.status)))

    entryPanel.appendChild(head)
    entryPanel.appendChild(meta)

    if (typeof entry.link === 'string' && entry.link !== '') {
      const link = make('a', 'reader-link', '打开原文')
      link.href = entry.link
      link.target = '_blank'
      link.rel = 'noreferrer'
      entryPanel.appendChild(link)
    }

    const summarySection = make('section', 'reader-article-section')
    summarySection.appendChild(make('h3', '', '摘要'))
    summarySection.appendChild(make('p', 'reader-article-copy', stripMarkup(entry.description) || '暂无摘要。'))

    const contentSection = make('section', 'reader-article-section')
    contentSection.appendChild(make('h3', '', '内容'))
    contentSection.appendChild(make('pre', 'reader-article-content', stripMarkup(entry.content) || '暂无正文。'))

    entryPanel.appendChild(summarySection)
    entryPanel.appendChild(contentSection)
  }

  const render = () => {
    if (sourceIndex >= sources.length) sourceIndex = 0
    const entries = getEntries()
    if (entryIndex >= entries.length) entryIndex = 0
    renderSourceList()
    renderSourceCard()
    renderFeedBanner()
    renderEntryList()
    renderEntryPanel()
  }

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
      entryIndex = Math.min(entries.length - 1, Math.max(0, entryIndex + delta))
      renderEntryList()
      renderEntryPanel()
      focusSelectedEntry()
      return
    }

    event.preventDefault()
    sourceIndex = Math.min(sources.length - 1, Math.max(0, sourceIndex + delta))
    entryIndex = 0
    render()
    focusSelectedSource()
  })

  render()
})()`

export default function ReaderPage(props: { overview: ReaderOverview }) {
  const source = getInitialSource(props.overview)
  const entry = getInitialEntry(source)

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
          <EntryList source={source} />
          <EntryPanel entry={entry} />
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
