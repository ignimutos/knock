import { AppShell } from '../components/layout/app_shell.tsx'
import { SyndicationForm } from '../islands/syndication_form.tsx'

const syndicationPageScript = `(() => {
  const form = document.getElementById('syn-form')
  if (!(form instanceof HTMLFormElement)) return

  const submitButton = document.getElementById('syn-submit')
  const fillDefaultsButton = document.getElementById('syn-fill-defaults')
  const runningPanel = document.getElementById('xq-running')
  const errorPanel = document.getElementById('xq-error')
  const errorMessage = document.getElementById('xq-error-message')
  const warningPanel = document.getElementById('xq-warnings')
  const warningList = document.getElementById('xq-warning-list')
  const debugPanel = document.getElementById('xq-debug')
  const debugList = document.getElementById('xq-debug-list')
  const rawPanel = document.getElementById('xq-raw-panel')
  const rawContent = document.getElementById('xq-raw-content')
  const jsonViewer = document.getElementById('xq-json-viewer')
  const expandAllButton = document.getElementById('xq-expand-all')
  const collapseAllButton = document.getElementById('xq-collapse-all')
  const sideRail = document.querySelector('.xq-side-rail')

  if (!(submitButton instanceof HTMLButtonElement) ||
    !(fillDefaultsButton instanceof HTMLButtonElement) ||
    !(runningPanel instanceof HTMLElement) ||
    !(errorPanel instanceof HTMLElement) ||
    !(errorMessage instanceof HTMLElement) ||
    !(warningPanel instanceof HTMLElement) ||
    !(warningList instanceof HTMLElement) ||
    !(debugPanel instanceof HTMLElement) ||
    !(debugList instanceof HTMLElement) ||
    !(jsonViewer instanceof HTMLElement) ||
    !(expandAllButton instanceof HTMLButtonElement) ||
    !(collapseAllButton instanceof HTMLButtonElement)
  ) return

  const runtimeInputs = Array.from(form.querySelectorAll('input[name="runtime"]'))

  const FEED_DEFAULTS = {
    title: '{{ title }}',
    link: '{{ link }}',
    description: '{{ description }}',
    generator: '{{ generator }}',
    language: '{{ language }}',
    published: '{{ published }}',
  }

  const ENTRY_DEFAULTS = {
    id: '{{ id }}',
    title: '{{ title }}',
    link: '{{ link }}',
    description: '{{ description }}',
    content: '{{ content }}',
    published: '{{ published }}',
    updated: '{{ updated }}',
  }

  const isModeInput = (value) => value instanceof HTMLInputElement

  const getRuntime = () => {
    const active = runtimeInputs.find((input) => isModeInput(input) && input.checked)
    return active instanceof HTMLInputElement && active.value === 'byparr' ? 'byparr' : 'native'
  }

  const syncRailTop = () => {
    if (!(sideRail instanceof HTMLElement)) return
    if (window.matchMedia('(max-width: 900px)').matches) {
      sideRail.style.removeProperty('--xq-rail-top')
      return
    }

    const viewportHeight = window.innerHeight
    const railHeight = sideRail.offsetHeight
    const nextTop = railHeight >= viewportHeight - 64
      ? 24
      : Math.max(24, Math.round((viewportHeight - railHeight) / 2))
    sideRail.style.setProperty('--xq-rail-top', String(nextTop) + 'px')
  }

  const clearList = (element) => {
    while (element.firstChild) {
      element.removeChild(element.firstChild)
    }
  }

  const setRunning = (running) => {
    submitButton.disabled = running
    submitButton.textContent = running ? '运行中…' : '运行'
    runningPanel.hidden = !running
    syncRailTop()
  }

  const hideError = () => {
    errorPanel.hidden = true
    errorMessage.textContent = ''
    syncRailTop()
  }

  const showError = (message) => {
    errorPanel.hidden = false
    errorMessage.textContent = message
    syncRailTop()
  }

  const renderWarnings = (warnings) => {
    clearList(warningList)
    if (!Array.isArray(warnings) || warnings.length === 0) {
      warningPanel.hidden = true
      syncRailTop()
      return
    }

    warningPanel.hidden = false
    warnings.forEach((warning) => {
      const li = document.createElement('li')
      li.textContent = String(warning)
      warningList.appendChild(li)
    })
    syncRailTop()
  }

  const renderDebug = (result) => {
    clearList(debugList)
    const items = [
      ['parser', result?.parser],
      ['payloadBytes', result?.fetchMeta?.payloadBytes],
      ['fetchDurationMs', result?.fetchMeta?.fetchDurationMs],
      ['parseDurationMs', result?.fetchMeta?.parseDurationMs],
    ]

    items.forEach(([key, value]) => {
      const li = document.createElement('li')
      li.textContent = String(key) + ': ' + (value === undefined ? '-' : String(value))
      debugList.appendChild(li)
    })

    debugPanel.hidden = false
    syncRailTop()
  }

  const renderRawContent = (value) => {
    if (!(rawPanel instanceof HTMLElement) || !(rawContent instanceof HTMLElement)) return
    if (typeof value !== 'string' || value === '') {
      rawPanel.hidden = true
      rawContent.textContent = ''
      syncRailTop()
      return
    }

    rawPanel.hidden = false
    rawContent.textContent = value
    syncRailTop()
  }

  const createLineCounter = () => {
    let current = 0
    return () => {
      current += 1
      return current
    }
  }

  const renderLine = (nextLineNo, text, depth) => {
    const row = document.createElement('div')
    row.className = 'json-line'

    const no = document.createElement('span')
    no.className = 'json-lno'
    no.textContent = String(nextLineNo()).padStart(3, ' ')

    const content = document.createElement('span')
    content.className = 'json-code'
    content.style.paddingLeft = String(depth * 16) + 'px'
    content.textContent = text

    row.appendChild(no)
    row.appendChild(content)
    return row
  }

  const renderNode = (value, depth, lines, defaultExpandedDepth, nextLineNo, toggleHandlers) => {
    if (value === null || typeof value !== 'object') {
      lines.push(renderLine(nextLineNo, JSON.stringify(value), depth))
      return
    }

    const isArray = Array.isArray(value)
    const entries = isArray ? value.map((item, index) => [String(index), item]) : Object.entries(value)
    const open = isArray ? '[' : '{'
    const close = isArray ? ']' : '}'
    const expanded = depth < defaultExpandedDepth

    const row = document.createElement('div')
    row.className = 'json-line'
    row.dataset.depth = String(depth)

    const no = document.createElement('span')
    no.className = 'json-lno'
    no.textContent = String(nextLineNo()).padStart(3, ' ')

    const content = document.createElement('span')
    content.className = 'json-code'
    content.style.paddingLeft = String(depth * 16) + 'px'

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'json-toggle'
    toggle.textContent = expanded ? '▾' : '▸'

    const label = document.createElement('span')
    label.textContent = String(open) + ' ' + String(entries.length) + ' ' + (isArray ? 'items' : 'keys')

    content.appendChild(toggle)
    content.appendChild(label)
    row.appendChild(no)
    row.appendChild(content)

    const childRows = []
    entries.forEach(([key, child]) => {
      if (child !== null && typeof child === 'object') {
        const childRow = renderLine(nextLineNo, JSON.stringify(key) + ':', depth + 1)
        childRows.push(childRow)
        renderNode(child, depth + 2, childRows, defaultExpandedDepth, nextLineNo, toggleHandlers)
      } else {
        childRows.push(renderLine(nextLineNo, JSON.stringify(key) + ': ' + JSON.stringify(child), depth + 1))
      }
    })

    const endLine = renderLine(nextLineNo, close, depth)
    childRows.push(endLine)

    const applyVisibility = (visible) => {
      childRows.forEach((childRow) => {
        childRow.hidden = !visible
      })
      toggle.textContent = visible ? '▾' : '▸'
    }

    toggle.addEventListener('click', () => {
      const visible = childRows.some((childRow) => !childRow.hidden)
      applyVisibility(!visible)
      syncRailTop()
    })

    toggleHandlers.push(applyVisibility)
    lines.push(row)
    lines.push(...childRows)
    applyVisibility(expanded)
  }

  const setJsonToggleHandlers = (handlers) => {
    jsonViewer._toggleHandlers = handlers
  }

  const getJsonToggleHandlers = () => {
    return Array.isArray(jsonViewer._toggleHandlers) ? jsonViewer._toggleHandlers : []
  }

  const renderJson = (data) => {
    jsonViewer.innerHTML = ''
    const lines = []
    const toggleHandlers = []
    const nextLineNo = createLineCounter()
    renderNode(data, 0, lines, 1, nextLineNo, toggleHandlers)
    lines.forEach((line) => jsonViewer.appendChild(line))
    setJsonToggleHandlers(toggleHandlers)
    syncRailTop()
  }

  const setAllExpanded = (expanded) => {
    const handlers = getJsonToggleHandlers()
    handlers.forEach((setVisibility) => {
      if (typeof setVisibility === 'function') {
        setVisibility(expanded)
      }
    })
    syncRailTop()
  }

  const buildFields = (prefix) => {
    const fields = {}
    form.querySelectorAll('[name^="' + prefix + '-field-"]').forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return
      const key = input.name.replace(prefix + '-field-', '')
      const value = input.value.trim()
      if (value) {
        fields[key] = value
      }
    })
    return fields
  }

  const buildPayload = () => ({
    runtime: getRuntime(),
    url: (() => {
      const urlInput = form.querySelector('[name="url"]')
      return urlInput instanceof HTMLInputElement ? urlInput.value.trim() : ''
    })(),
    feed: buildFields('feed'),
    entry: buildFields('entry'),
  })

  function fillDefaults() {
    Object.entries(FEED_DEFAULTS).forEach(([key, value]) => {
      const input = form.querySelector('[name="feed-field-' + key + '"]')
      if (input instanceof HTMLInputElement) {
        input.value = value
      }
    })
    Object.entries(ENTRY_DEFAULTS).forEach(([key, value]) => {
      const input = form.querySelector('[name="entry-field-' + key + '"]')
      if (input instanceof HTMLInputElement) {
        input.value = value
      }
    })
    syncRailTop()
  }

  expandAllButton.addEventListener('click', () => setAllExpanded(true))
  collapseAllButton.addEventListener('click', () => setAllExpanded(false))
  fillDefaultsButton.addEventListener('click', fillDefaults)
  if (rawPanel instanceof HTMLDetailsElement) {
    rawPanel.addEventListener('toggle', syncRailTop)
  }
  window.addEventListener('resize', syncRailTop)
  runtimeInputs.forEach((input) => {
    if (isModeInput(input)) {
      input.addEventListener('change', syncRailTop)
    }
  })

  renderRawContent()
  syncRailTop()

  form.addEventListener('submit', async (event) => {
    event.preventDefault()

    hideError()
    renderWarnings([])
    debugPanel.hidden = true
    renderRawContent()
    syncRailTop()
    setRunning(true)

    try {
      const response = await fetch('/api/syndication/evaluate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildPayload()),
      })

      const payload = await response.json()
      if (!response.ok) {
        jsonViewer.innerHTML = ''
        renderRawContent()
        showError(typeof payload?.message === 'string' ? payload.message : '运行失败')
        return
      }

      hideError()
      renderWarnings(payload?.warnings)
      renderDebug(payload)
      renderRawContent(payload?.rawContent)
      renderJson(payload)
    } catch (error) {
      jsonViewer.innerHTML = ''
      renderRawContent()
      showError(error instanceof Error ? error.message : '运行失败')
    } finally {
      setRunning(false)
    }
  })
})()`

export default function SyndicationPage() {
  return (
    <AppShell
      title="Syndication Playground"
      subtitle="输入目标 URL，预览规范化结果并调试标准字段映射。"
    >
      <SyndicationForm />
      <script dangerouslySetInnerHTML={{ __html: syndicationPageScript }} />
    </AppShell>
  )
}
