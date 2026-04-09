import { AppShell } from '../components/layout/app_shell.tsx'
import { XqueryForm } from '../islands/xquery_form.tsx'

const xqueryPageScript = `(() => {
  const form = document.getElementById('xq-form')
  if (!(form instanceof HTMLFormElement)) return

  const submitButton = document.getElementById('xq-submit')
  const runningPanel = document.getElementById('xq-running')
  const errorPanel = document.getElementById('xq-error')
  const errorMessage = document.getElementById('xq-error-message')
  const warningPanel = document.getElementById('xq-warnings')
  const warningList = document.getElementById('xq-warning-list')
  const debugPanel = document.getElementById('xq-debug')
  const debugList = document.getElementById('xq-debug-list')
  const jsonViewer = document.getElementById('xq-json-viewer')
  const expandAllButton = document.getElementById('xq-expand-all')
  const collapseAllButton = document.getElementById('xq-collapse-all')
  const addNamespaceButton = document.getElementById('xq-add-namespace')
  const namespaceRows = document.getElementById('xq-namespaces-rows')

  if (!(submitButton instanceof HTMLButtonElement) ||
    !(runningPanel instanceof HTMLElement) ||
    !(errorPanel instanceof HTMLElement) ||
    !(errorMessage instanceof HTMLElement) ||
    !(warningPanel instanceof HTMLElement) ||
    !(warningList instanceof HTMLElement) ||
    !(debugPanel instanceof HTMLElement) ||
    !(debugList instanceof HTMLElement) ||
    !(jsonViewer instanceof HTMLElement) ||
    !(expandAllButton instanceof HTMLButtonElement) ||
    !(collapseAllButton instanceof HTMLButtonElement) ||
    !(addNamespaceButton instanceof HTMLButtonElement) ||
    !(namespaceRows instanceof HTMLElement)
  ) return

  let namespaceRowId = 2

  const feedModeInputs = Array.from(form.querySelectorAll('input[name="feed-mode"]'))
  const entryModeInputs = Array.from(form.querySelectorAll('input[name="entry-mode"]'))
  const feedStructuredGroup = form.querySelector('[data-mode-group="feed-structured"]')
  const feedScriptGroup = form.querySelector('[data-mode-group="feed-script"]')
  const entryStructuredGroup = form.querySelector('[data-mode-group="entry-structured"]')
  const entryScriptGroup = form.querySelector('[data-mode-group="entry-script"]')

  const isModeInput = (value) => value instanceof HTMLInputElement

  const getMode = (inputs, fallback) => {
    const active = inputs.find((input) => isModeInput(input) && input.checked)
    if (!isModeInput(active)) return fallback
    return active.value === 'script' ? 'script' : 'structured'
  }

  const syncModeGroups = () => {
    const feedMode = getMode(feedModeInputs, 'structured')
    const entryMode = getMode(entryModeInputs, 'structured')

    if (feedStructuredGroup instanceof HTMLElement) feedStructuredGroup.hidden = feedMode !== 'structured'
    if (feedScriptGroup instanceof HTMLElement) feedScriptGroup.hidden = feedMode !== 'script'
    if (entryStructuredGroup instanceof HTMLElement) entryStructuredGroup.hidden = entryMode !== 'structured'
    if (entryScriptGroup instanceof HTMLElement) entryScriptGroup.hidden = entryMode !== 'script'
  }

  const clearList = (element) => {
    while (element.firstChild) {
      element.removeChild(element.firstChild)
    }
  }

  const setRunning = (running) => {
    submitButton.disabled = running
    submitButton.textContent = running ? '运行中…' : '运行 XQuery'
    runningPanel.hidden = !running
  }

  const hideError = () => {
    errorPanel.hidden = true
    errorMessage.textContent = ''
  }

  const showError = (message) => {
    errorPanel.hidden = false
    errorMessage.textContent = message
  }

  const renderWarnings = (warnings) => {
    clearList(warningList)
    if (!Array.isArray(warnings) || warnings.length === 0) {
      warningPanel.hidden = true
      return
    }

    warningPanel.hidden = false
    warnings.forEach((warning) => {
      const li = document.createElement('li')
      li.textContent = String(warning)
      warningList.appendChild(li)
    })
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
  }

  const setAllExpanded = (expanded) => {
    const handlers = getJsonToggleHandlers()
    handlers.forEach((setVisibility) => {
      if (typeof setVisibility === 'function') {
        setVisibility(expanded)
      }
    })
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

  const readNamespaces = () => {
    const namespaces = {}
    form.querySelectorAll('[data-ns-row]').forEach((row) => {
      if (!(row instanceof HTMLElement)) return
      const id = row.dataset.nsRow
      if (!id) return
      const prefixInput = form.querySelector('[name="ns-prefix-' + id + '"]')
      const uriInput = form.querySelector('[name="ns-uri-' + id + '"]')
      if (!(prefixInput instanceof HTMLInputElement) || !(uriInput instanceof HTMLInputElement)) return
      const prefix = prefixInput.value.trim()
      const uri = uriInput.value.trim()
      if (prefix && uri) {
        namespaces[prefix] = uri
      }
    })
    return namespaces
  }

  const buildSection = (prefix, mode) => {
    if (mode === 'script') {
      const scriptInput = form.querySelector('[name="' + prefix + '-script"]')
      return {
        mode: 'script',
        code: scriptInput instanceof HTMLTextAreaElement ? scriptInput.value : '',
      }
    }

    return {
      mode: 'mapping',
      fields: buildFields(prefix),
    }
  }

  const buildPayload = () => {
    const urlInput = form.querySelector('[name="url"]')
    const locateInput = form.querySelector('[name="locate"]')
    const payload = {
      url: urlInput instanceof HTMLInputElement ? urlInput.value.trim() : '',
      locate: locateInput instanceof HTMLInputElement ? locateInput.value.trim() : '',
      feed: buildSection('feed', getMode(feedModeInputs, 'structured')),
      entry: buildSection('entry', getMode(entryModeInputs, 'structured')),
    }

    const namespaces = readNamespaces()
    if (Object.keys(namespaces).length > 0) {
      payload.namespaces = namespaces
    }
    if (!payload.locate) {
      delete payload.locate
    }
    return payload
  }

  const addNamespaceRow = () => {
    const rowId = namespaceRowId++
    const row = document.createElement('div')
    row.className = 'toolbar'
    row.dataset.nsRow = String(rowId)
    row.innerHTML = '<input class="input" name="ns-prefix-' + rowId + '" placeholder="prefix" />' +
      '<input class="input" name="ns-uri-' + rowId + '" placeholder="https://www.w3.org/..." />' +
      '<button type="button" class="btn btn-secondary" data-ns-remove>删除</button>'
    namespaceRows.appendChild(row)
  }

  namespaceRows.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!target.hasAttribute('data-ns-remove')) return

    const row = target.closest('[data-ns-row]')
    if (!(row instanceof HTMLElement)) return
    if (namespaceRows.children.length <= 1) {
      const prefixInput = row.querySelector('input[name^="ns-prefix-"]')
      const uriInput = row.querySelector('input[name^="ns-uri-"]')
      if (prefixInput instanceof HTMLInputElement) prefixInput.value = ''
      if (uriInput instanceof HTMLInputElement) uriInput.value = ''
      return
    }
    row.remove()
  })

  addNamespaceButton.addEventListener('click', addNamespaceRow)
  expandAllButton.addEventListener('click', () => setAllExpanded(true))
  collapseAllButton.addEventListener('click', () => setAllExpanded(false))

  feedModeInputs.forEach((input) => {
    if (isModeInput(input)) {
      input.addEventListener('change', syncModeGroups)
    }
  })
  entryModeInputs.forEach((input) => {
    if (isModeInput(input)) {
      input.addEventListener('change', syncModeGroups)
    }
  })

  syncModeGroups()

  form.addEventListener('submit', async (event) => {
    event.preventDefault()

    hideError()
    renderWarnings([])
    debugPanel.hidden = true
    setRunning(true)

    try {
      const response = await fetch('/api/xquery/evaluate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildPayload()),
      })

      const payload = await response.json()
      if (!response.ok) {
        jsonViewer.innerHTML = ''
        showError(typeof payload?.message === 'string' ? payload.message : '运行失败')
        return
      }

      hideError()
      renderWarnings(payload?.warnings)
      renderDebug(payload)
      renderJson(payload)
    } catch (error) {
      jsonViewer.innerHTML = ''
      showError(error instanceof Error ? error.message : '运行失败')
    } finally {
      setRunning(false)
    }
  })
})()`

export default function XqueryPage() {
  return (
    <AppShell
      title="XQuery Playground"
      subtitle="输入目标 URL 和表达式，快速预览解析结果。"
    >
      <XqueryForm />
      <script dangerouslySetInnerHTML={{ __html: xqueryPageScript }} />
    </AppShell>
  )
}
