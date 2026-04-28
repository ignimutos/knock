import type { ComponentChildren } from '../../src/platform/preact_types.ts'

const themeBootstrapScript = `(() => {
  const STORAGE_KEY = 'knock.theme.mode'
  const root = document.documentElement

  const readMode = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved
      }
    } catch {
      // ignore
    }
    const mode = root.dataset.themeMode
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      return mode
    }
    return 'system'
  }

  const resolveTheme = (mode) => {
    if (mode === 'light' || mode === 'dark') {
      return mode
    }
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  }

  const applyMode = (mode) => {
    const theme = resolveTheme(mode)
    root.dataset.themeMode = mode
    root.dataset.theme = theme
    root.style.colorScheme = theme
    return theme
  }

  const syncSelects = (mode) => {
    document.querySelectorAll('.js-theme-select').forEach((node) => {
      if (node instanceof HTMLSelectElement) {
        node.value = mode
      }
    })
  }

  const bindControls = () => {
    document.querySelectorAll('.js-theme-select').forEach((node) => {
      if (!(node instanceof HTMLSelectElement)) {
        return
      }
      if (node.dataset.boundTheme === '1') {
        return
      }
      node.dataset.boundTheme = '1'
      node.addEventListener('change', (event) => {
        const target = event.currentTarget
        if (!(target instanceof HTMLSelectElement)) {
          return
        }

        const nextMode = target.value === 'light' || target.value === 'dark' || target.value === 'system'
          ? target.value
          : 'system'

        applyMode(nextMode)
        syncSelects(nextMode)
        try {
          localStorage.setItem(STORAGE_KEY, nextMode)
        } catch {
          // ignore
        }
      })
    })
  }

  const currentMode = readMode()
  applyMode(currentMode)
  syncSelects(currentMode)

  try {
    localStorage.setItem(STORAGE_KEY, currentMode)
  } catch {
    // ignore
  }

  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', () => {
      if (root.dataset.themeMode === 'system') {
        applyMode('system')
      }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindControls()
      syncSelects(readMode())
    }, { once: true })
  } else {
    bindControls()
    syncSelects(readMode())
  }
})()`

export default function AppDocument(props: { children: ComponentChildren; title?: string }) {
  return (
    <html
      lang="zh-CN"
      data-theme="light"
      data-theme-mode="system"
    >
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <meta
          name="color-scheme"
          content="light dark"
        />
        <title>{props.title ?? 'Knock Web'}</title>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <style
          dangerouslySetInnerHTML={{
            __html: `
:root {
  --bg-base: #f2f4f7;
  --bg-tint: #eef2f6;
  --shell-bg: rgba(251, 252, 253, 0.96);
  --shell-header-bg: rgba(246, 248, 250, 0.94);
  --shell-shadow: 0 18px 40px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.04);
  --line: rgba(109, 122, 142, 0.22);
  --line-strong: rgba(95, 111, 133, 0.34);
  --text: #1d2736;
  --muted: #657286;
  --accent: #58708c;
  --accent-strong: #435c78;
  --success: #2f6a4d;
  --panel: rgba(255, 255, 255, 0.94);
  --panel-strong: #f7f9fb;
  --panel-alt: #eef3f8;
  --btn-text: #f8fafc;
  --result-pre-text: #203045;
  --focus-ring: rgba(67, 92, 120, 0.18);
  --hover-bg: rgba(88, 112, 140, 0.08);
  --badge-line: rgba(47, 106, 77, 0.22);
  --brand-glow: transparent;
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 10px;
  --radius-xl: 10px;
  --radius-pill: 999px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --shadow-soft: 0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.04);
  --shadow-card: 0 1px 2px rgba(15, 23, 42, 0.08), 0 12px 28px rgba(15, 23, 42, 0.05);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --bg-base: #111317;
  --bg-tint: #171c23;
  --shell-bg: rgba(18, 21, 26, 0.96);
  --shell-header-bg: rgba(22, 27, 34, 0.94);
  --shell-shadow: 0 24px 56px rgba(0, 0, 0, 0.32);
  --line: rgba(174, 188, 208, 0.14);
  --line-strong: rgba(174, 188, 208, 0.24);
  --text: #edf1f7;
  --muted: #9aa6b8;
  --accent: #8ea6c4;
  --accent-strong: #a5bed9;
  --success: #8fc39f;
  --panel: rgba(23, 28, 35, 0.96);
  --panel-strong: #1a2028;
  --panel-alt: #222a34;
  --btn-text: #10161d;
  --result-pre-text: #e8edf5;
  --focus-ring: rgba(165, 190, 217, 0.18);
  --hover-bg: rgba(142, 166, 196, 0.12);
  --badge-line: rgba(143, 195, 159, 0.22);
  --brand-glow: transparent;
  --shadow-soft: inset 0 1px 0 rgba(255, 255, 255, 0.02);
  --shadow-card: 0 10px 28px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
* { box-sizing: border-box; }
html { color-scheme: light; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  color: var(--text);
  background: linear-gradient(180deg, var(--bg-base) 0%, var(--bg-tint) 100%);
  font-family: "Avenir Next", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
select, input, textarea, button { font: inherit; }
a { color: inherit; text-decoration: none; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.page-wrap { min-height: 100vh; padding: var(--space-6); }
.shell {
  max-width: 1160px;
  margin: 0 auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--shell-bg);
  box-shadow: var(--shell-shadow);
  overflow: visible;
}
.shell-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--line);
  background: var(--shell-header-bg);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  letter-spacing: 0.08em;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--muted);
}
.brand-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--accent-strong);
  box-shadow: none;
}
.top-nav {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}
.nav-link,
.theme-select {
  min-height: 40px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  color: var(--muted);
  font-size: 13px;
  transition-property: background-color, border-color, color, transform, box-shadow;
  transition-duration: .16s;
  transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  touch-action: manipulation;
}
.nav-link {
  display: inline-flex;
  align-items: center;
  background: transparent;
}
.theme-select {
  background: var(--panel-strong);
  border-color: var(--line);
}
@media (hover: hover) {
  .nav-link:hover {
    color: var(--text);
    background: var(--hover-bg);
  }
  .theme-select:hover {
    border-color: var(--line-strong);
    background: var(--panel);
    color: var(--text);
  }
}
.theme-select {
  min-width: 112px;
}
.theme-select:focus,
.theme-select:focus-visible {
  outline: none;
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.shell-main { padding: var(--space-6) var(--space-6) var(--space-8); }
.hero-title {
  margin: 0;
  font-size: clamp(28px, 5vw, 42px);
  line-height: 1.06;
  letter-spacing: -0.022em;
  text-wrap: balance;
}
.hero-sub {
  margin: var(--space-3) 0 0;
  color: var(--muted);
  font-size: 15px;
  max-width: 72ch;
  line-height: 1.65;
  text-wrap: pretty;
}
.card-grid {
  margin-top: var(--space-6);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}
.card-grid > :last-child:nth-child(odd) {
  grid-column: 1 / -1;
}
.panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--panel);
  padding: 18px var(--space-5);
  box-shadow: none;
}
.reader-home-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  box-shadow: none;
}
.panel h2 { margin: 0 0 6px; font-size: 18px; line-height: 1.2; }
.panel p { margin: 0; color: var(--muted); line-height: 1.6; text-wrap: pretty; }
.panel-list { margin: 0; padding-left: 20px; color: var(--muted); }
.panel-list li { margin: var(--space-2) 0; }
.xq-section {
  margin-top: var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--panel);
  box-shadow: var(--shadow-soft);
}
.xq-section > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  cursor: pointer;
  list-style: none;
  padding: 14px var(--space-5);
}
.xq-section > summary::-webkit-details-marker { display: none; }
.segment-control {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel-strong);
  gap: 3px;
}
.segment-control input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.segment-control label {
  display: inline-flex;
  align-items: center;
}
.segment-control label span {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--muted);
  transition-property: background-color, color, transform;
  transition-duration: .16s;
  transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
.segment-control input:checked + span {
  display: inline-flex;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--accent-strong);
  color: var(--btn-text);
}
.result-pre-wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.cta-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  min-height: 40px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--line-strong);
  color: var(--text);
  background: var(--panel-strong);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
  transition-property: background-color, border-color, color, transform, box-shadow;
  transition-duration: .16s;
  transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
@media (hover: hover) {
  .cta-link:hover {
    background: var(--hover-bg);
    border-color: var(--accent);
    box-shadow: var(--shadow-soft);
  }
}
.xq-grid {
  margin-top: var(--space-5);
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
}
.xq-layout {
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 0.9fr);
  align-items: start;
  gap: var(--space-5);
}
.xq-main-column,
.xq-side-column {
  min-width: 0;
}
.xq-side-column {
  display: grid;
  align-self: stretch;
}
.xq-side-rail {
  position: sticky;
  top: var(--xq-rail-top, 24px);
  display: grid;
  gap: var(--space-4);
  align-self: start;
  align-content: start;
  background: transparent;
  box-shadow: none;
  transition: top .18s ease;
}
.xq-side-rail .badge {
  justify-self: start;
}
html[data-theme="dark"] .xq-side-rail {
  box-shadow: none;
}
@media (prefers-reduced-motion: reduce) {
  .xq-side-rail,
  .reader-source-button,
  .reader-entry-button,
  .reader-link,
  .reader-entry-expand-shell,
  .nav-link,
  .cta-link,
  .btn {
    transition: none;
  }
}
.xq-side-note {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--muted);
  font-size: 13px;
  line-height: 1.65;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel-alt);
}
.field { display: grid; gap: 6px; }
.field label { font-size: 12px; color: var(--muted); letter-spacing: .015em; }
.input, .textarea {
  width: 100%;
  border: 1px solid var(--line);
  background: var(--panel-strong);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 9px 11px;
}
.textarea { min-height: 96px; resize: vertical; }
.input:focus, .textarea:focus,
.input:focus-visible, .textarea:focus-visible {
  border-color: var(--accent-strong);
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.toolbar { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.btn {
  min-height: 36px;
  border-radius: var(--radius-md);
  padding: 0 13px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  transition-property: background-color, border-color, color, transform, box-shadow, filter;
  transition-duration: .16s;
  transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
.btn:focus,
.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.btn:disabled {
  opacity: .68;
  cursor: wait;
}
.btn-primary {
  border: 1px solid var(--accent-strong);
  background: var(--accent-strong);
  color: var(--btn-text);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
@media (hover: hover) {
  .btn-primary:hover {
    filter: brightness(1.06);
    box-shadow: var(--shadow-soft);
  }
}
.btn-secondary {
  border: 1px solid var(--line);
  background: var(--panel-strong);
  color: var(--text);
}
@media (hover: hover) {
  .btn-secondary:hover {
    border-color: var(--line-strong);
    background: var(--hover-bg);
  }
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--success);
  font-size: 12px;
  border: 1px solid var(--badge-line);
  border-radius: var(--radius-pill);
  padding: 5px 10px;
  background: color-mix(in srgb, var(--panel-strong) 88%, transparent);
}
.result-panel {
  display: grid;
  gap: 0;
  border: 0;
  border-radius: var(--radius-xl);
  background: transparent;
  overflow: visible;
}
.xq-result-panel {
  border: 1px solid var(--line);
  background: var(--panel);
  overflow: hidden;
  box-shadow: var(--shadow-soft);
}
.xq-result-actions {
  margin-bottom: var(--space-2);
}
.result-head {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.result-pre {
  margin: 0;
  padding: var(--space-4);
  overflow: auto;
  max-height: 340px;
  color: var(--result-pre-text);
  font-family: "Iosevka SS08", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.55;
}
.reader-home-panel {
  margin-top: var(--space-5);
}
.reader-home-panel p {
  max-width: 64ch;
}
.reader-layout {
  margin-top: var(--space-6);
  display: grid;
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
.reader-sidebar,
.reader-feed-banner,
.reader-source-card,
.reader-entry-expanded,
.reader-entry-stack,
.reader-home-panel,
.reader-delivery-block,
.reader-modal-card,
.xq-section,
.panel,
.xq-result-panel {
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: none;
}
.reader-sidebar {
  display: grid;
  gap: var(--space-4);
}
.reader-sidebar-head,
.reader-entry-stack-head,
.reader-banner-head,
.reader-card-head,
.reader-article-head,
.reader-manager-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}
.reader-sidebar-copy,
.reader-stack-copy,
.reader-banner-copy,
.reader-feed-description,
.reader-article-copy,
.reader-empty,
.reader-issue,
.reader-modal-copy {
  color: var(--muted);
  line-height: 1.65;
  text-wrap: pretty;
}
.reader-kicker {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.reader-summary-text {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.reader-source-list,
.reader-entry-list,
.reader-main-column,
.reader-main-rail,
.reader-manager-panel,
.reader-manager-deliveries,
.reader-manager-delivery-list,
.reader-entry-item,
.reader-source-item {
  display: grid;
  gap: var(--space-3);
}
.reader-source-list,
.reader-entry-list {
  gap: var(--space-2);
  border: 0;
  border-radius: 0;
  background: transparent;
  overflow: visible;
}
.reader-main-column {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
}
.reader-main-rail {
  position: sticky;
  top: 24px;
  z-index: 1;
}
.reader-source-item {
  gap: var(--space-2);
}
.reader-source-expand-shell {
  display: none;
}
.reader-source-expand-shell.is-expanded {
  display: block;
}
.reader-source-button,
.reader-entry-button,
.reader-link {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  color: var(--text);
  padding: 14px var(--space-4);
  text-align: left;
  cursor: pointer;
  transition-property: transform, background-color, box-shadow, color, border-color;
  transition-duration: .16s;
  transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  touch-action: manipulation;
}
.reader-link {
  width: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--panel-strong);
  color: var(--accent-strong);
}
@media (hover: hover) {
  .reader-source-button:hover,
  .reader-entry-button:hover {
    background: var(--panel-strong);
  }
  .reader-link:hover {
    border-color: var(--line-strong);
    background: var(--hover-bg);
    box-shadow: var(--shadow-soft);
  }
}
.reader-source-button:active,
.reader-entry-button:active,
.reader-link:active,
.nav-link:active,
.cta-link:active,
.btn:active {
  transform: scale(0.96);
}
.reader-source-button:focus-visible,
.reader-entry-button:focus-visible,
.reader-link:focus-visible,
.nav-link:focus-visible,
.cta-link:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--accent-strong), 0 0 0 3px var(--focus-ring);
}
.reader-source-button.is-active,
.reader-entry-button.is-active {
  border-color: var(--accent-strong);
  background: var(--panel-strong);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-strong) 28%, transparent);
}
.reader-source-item.is-expanded > .reader-source-button {
  box-shadow:
    inset 3px 0 0 var(--accent-strong),
    0 0 0 1px color-mix(in srgb, var(--accent-strong) 28%, transparent);
}
.reader-source-item.is-expanded > .reader-source-button .reader-source-name {
  color: var(--accent-strong);
}
.reader-source-headline,
.reader-entry-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.reader-source-heading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.reader-source-chevron {
  color: var(--muted);
  font-size: 13px;
  line-height: 1;
  transition: transform .16s cubic-bezier(0.16, 1, 0.3, 1), color .16s cubic-bezier(0.16, 1, 0.3, 1);
}
.reader-source-chevron.is-expanded {
  transform: rotate(180deg);
  color: var(--accent-strong);
}
.reader-source-name,
.reader-entry-name,
.reader-card-title,
.reader-banner-title,
.reader-article-title,
.reader-feed-title,
.reader-manager-title,
.reader-modal-title {
  margin: 0;
  color: var(--text);
  letter-spacing: -0.012em;
}
.reader-source-name,
.reader-entry-name,
.reader-feed-title {
  font-size: 15px;
  font-weight: 700;
}
.reader-card-title,
.reader-banner-title,
.reader-article-title {
  font-size: clamp(24px, 3vw, 32px);
  line-height: 1.08;
}
.reader-manager-title,
.reader-modal-title {
  font-size: 22px;
  line-height: 1.1;
}
.reader-source-meta,
.reader-entry-excerpt,
.reader-banner-meta {
  display: block;
  margin-top: 7px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.reader-source-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.reader-state-badge,
.reader-run-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 4px 9px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid var(--line);
  background: var(--panel-strong);
  color: var(--muted);
}
.reader-state-badge.is-enabled,
.reader-run-badge.is-success,
.reader-run-badge.is-delivered {
  color: #2f6a4d;
  border-color: rgba(47, 106, 77, 0.24);
  background: rgba(235, 244, 238, 0.92);
}
.reader-state-badge.is-disabled,
.reader-run-badge.is-failed,
.reader-run-badge.is-interrupted {
  color: #8a4234;
  border-color: rgba(138, 66, 52, 0.22);
  background: rgba(250, 239, 235, 0.94);
}
.reader-run-badge.is-skipped,
.reader-run-badge.is-partial,
.reader-run-badge.is-running,
.reader-run-badge.is-planned {
  color: #4f647f;
  border-color: rgba(79, 100, 127, 0.2);
  background: rgba(238, 243, 249, 0.94);
}
.reader-feed-note,
.reader-feed-banner,
.reader-source-card,
.reader-entry-expanded,
.reader-entry-stack {
  padding: var(--space-5);
  border-radius: var(--radius-xl);
}
.reader-source-card {
  background: var(--panel-strong);
}
.reader-feed-banner,
.reader-source-card,
.reader-entry-stack {
  background: var(--panel-strong);
}
.reader-feed-note {
  margin-top: var(--space-4);
  border: 1px dashed var(--line-strong);
  background: var(--panel-alt);
}
.reader-manager-panel,
.reader-manager-deliveries,
.reader-manager-delivery-list {
  gap: var(--space-3);
}
.reader-manager-panel > .reader-empty,
.reader-manager-panel > .toolbar,
.reader-manager-panel > .reader-manager-message,
.reader-manager-panel > .reader-manager-grid,
.reader-manager-panel > .reader-manager-deliveries {
  padding-inline: var(--space-5);
}
.reader-manager-panel > .reader-empty {
  margin: 0;
  padding-top: 14px;
}
.reader-manager-panel > .toolbar,
.reader-manager-panel > .reader-manager-message {
  padding-bottom: 14px;
}
.reader-manager-panel > .reader-manager-grid,
.reader-manager-panel > .reader-manager-deliveries {
  padding-top: 14px;
  padding-bottom: 14px;
}
.reader-manager-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px var(--space-3);
}
.reader-manager-wide {
  grid-column: 1 / -1;
}
.reader-check {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  color: var(--text);
  cursor: pointer;
}
.reader-check-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.reader-check-ui {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: var(--panel);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  transition-property: background-color, border-color, transform, box-shadow;
  transition-duration: .16s;
  transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
.reader-check.is-checked .reader-check-ui {
  border-color: var(--accent-strong);
  background: var(--accent-strong);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}
.reader-check.is-checked .reader-check-ui::after {
  content: '✓';
  color: var(--btn-text);
  font-size: 12px;
  font-weight: 700;
}
.reader-check-input:focus-visible + .reader-check-ui {
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.reader-check-input:active + .reader-check-ui,
.reader-check:active .reader-check-ui {
  transform: scale(0.94);
}
.reader-check-copy {
  display: grid;
  gap: 2px;
}
.reader-check-label {
  color: var(--text);
}
.reader-check-meta {
  color: var(--muted);
  font-size: 12px;
}
.reader-manager-enabled {
  justify-self: start;
}
.reader-delivery-block {
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--panel);
}
.reader-delivery-editor[hidden] {
  display: none !important;
}
.reader-manager-actions {
  margin-top: 4px;
}
.reader-manager-message {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
}
.reader-manager-message.is-success {
  border: 1px solid rgba(47, 106, 77, 0.22);
  background: rgba(235, 244, 238, 0.92);
  color: #2f6a4d;
}
.reader-manager-message.is-error,
.reader-issue {
  border: 1px solid rgba(138, 66, 52, 0.18);
  background: rgba(250, 239, 235, 0.92);
  color: #8a4234;
}
.reader-modal-shell {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-6);
  background: rgba(16, 24, 40, 0.38);
  z-index: 40;
}
.reader-modal-shell[hidden] {
  display: none !important;
}
.reader-modal-card {
  width: min(100%, 440px);
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  border-radius: var(--radius-xl);
}
.reader-modal-actions {
  justify-content: flex-end;
}
.reader-entry-expand-shell {
  display: grid;
  grid-template-rows: 0fr;
  min-height: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateY(-8px);
  transition: grid-template-rows .22s cubic-bezier(0.16, 1, 0.3, 1), opacity .18s ease, transform .22s cubic-bezier(0.16, 1, 0.3, 1);
}
.reader-entry-expand-shell.is-expanded {
  grid-template-rows: 1fr;
  opacity: 1;
  transform: translateY(0);
}
.reader-entry-expand-shell > .reader-entry-expanded {
  min-height: 0;
  overflow: hidden;
}
.reader-entry-expanded {
  padding: 0;
  border: 0;
}
.reader-entry-expand-shell.is-expanded > .reader-entry-expanded {
  padding: var(--space-5);
  border: 1px solid var(--line);
}
.reader-meta-grid,
.reader-feed-grid {
  margin: var(--space-4) 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3) var(--space-5);
}
.reader-meta-grid dt,
.reader-feed-grid dt {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.reader-meta-grid dd,
.reader-feed-grid dd {
  margin: 0;
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.reader-entry-meta-grid {
  margin-top: var(--space-3);
}
.reader-article-section {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--line);
}
.reader-article-section h3,
.reader-article-section h4 {
  margin: 0 0 var(--space-2);
  font-size: 15px;
  color: var(--text);
}
.reader-article-content {
  margin: 0;
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.75;
  color: var(--text);
  text-wrap: pretty;
}
.reader-issue {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
}
html[data-theme="dark"] .nav-link,
html[data-theme="dark"] .theme-select,
html[data-theme="dark"] .reader-source-button,
html[data-theme="dark"] .reader-entry-button,
html[data-theme="dark"] .reader-link,
html[data-theme="dark"] .input,
html[data-theme="dark"] .textarea,
html[data-theme="dark"] .btn-secondary,
html[data-theme="dark"] .reader-delivery-block {
  background: var(--panel-strong);
}
html[data-theme="dark"] .reader-home-panel,
html[data-theme="dark"] .reader-sidebar,
html[data-theme="dark"] .reader-feed-banner,
html[data-theme="dark"] .reader-source-card,
html[data-theme="dark"] .reader-entry-expanded,
html[data-theme="dark"] .reader-entry-stack,
html[data-theme="dark"] .reader-modal-card,
html[data-theme="dark"] .xq-result-panel,
html[data-theme="dark"] .xq-section,
html[data-theme="dark"] .panel {
  border-color: var(--line);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
html[data-theme="dark"] .reader-feed-note,
html[data-theme="dark"] .xq-side-note {
  background: var(--panel-alt);
}
html[data-theme="dark"] .reader-source-name,
html[data-theme="dark"] .reader-entry-name,
html[data-theme="dark"] .reader-card-title,
html[data-theme="dark"] .reader-banner-title,
html[data-theme="dark"] .reader-article-title,
html[data-theme="dark"] .reader-feed-title,
html[data-theme="dark"] .reader-manager-title,
html[data-theme="dark"] .reader-modal-title,
html[data-theme="dark"] .reader-meta-grid dd,
html[data-theme="dark"] .reader-feed-grid dd,
html[data-theme="dark"] .reader-article-content,
html[data-theme="dark"] .reader-article-section h3,
html[data-theme="dark"] .reader-article-section h4 {
  color: var(--text);
}
html[data-theme="dark"] .reader-sidebar-copy,
html[data-theme="dark"] .reader-stack-copy,
html[data-theme="dark"] .reader-banner-copy,
html[data-theme="dark"] .reader-feed-description,
html[data-theme="dark"] .reader-article-copy,
html[data-theme="dark"] .reader-empty,
html[data-theme="dark"] .reader-issue,
html[data-theme="dark"] .reader-source-meta,
html[data-theme="dark"] .reader-entry-excerpt,
html[data-theme="dark"] .reader-banner-meta,
html[data-theme="dark"] .reader-summary-text,
html[data-theme="dark"] .reader-kicker,
html[data-theme="dark"] .reader-meta-grid dt,
html[data-theme="dark"] .reader-feed-grid dt,
html[data-theme="dark"] .field label {
  color: var(--muted);
}
@media (max-width: 900px) {
  .page-wrap { padding: var(--space-3); }
  .shell-header,
  .shell-main { padding-inline: var(--space-4); }
  .shell-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-3);
  }
  .brand {
    font-size: 11px;
    letter-spacing: 0.07em;
  }
  .shell-main { padding-block: var(--space-4) var(--space-6); }
  .top-nav {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    min-width: 0;
  }
  .nav-link,
  .theme-select {
    min-height: 32px;
    padding-inline: 10px;
    font-size: 12px;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .nav-link {
    justify-content: center;
    min-height: 32px;
    padding-inline: 10px;
  }
  .top-nav label {
    margin-left: auto;
    flex: 0 0 auto;
  }
  .theme-select {
    min-width: 96px;
  }
  .card-grid,
  .xq-layout,
  .reader-layout,
  .reader-manager-grid,
  .reader-meta-grid,
  .reader-feed-grid,
  .reader-entry-meta-grid {
    grid-template-columns: 1fr;
  }
  .reader-sidebar,
  .xq-side-rail {
    position: static;
    top: auto;
  }
}
        `,
          }}
        />
      </head>
      <body>{props.children}</body>
    </html>
  )
}
