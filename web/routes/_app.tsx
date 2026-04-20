import type { PageProps } from 'fresh'

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

export default function App(props: PageProps) {
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
        <title>Knock Web</title>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <style
          dangerouslySetInnerHTML={{
            __html: `
:root {
  --bg-base: #f5f7fb;
  --bg-accent-a: rgba(42, 127, 255, 0.2);
  --bg-accent-b: rgba(0, 170, 120, 0.16);
  --shell-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 255, 0.98));
  --shell-header-bg: rgba(255, 255, 255, 0.8);
  --shell-shadow: 0 18px 54px rgba(20, 31, 57, 0.18), inset 0 1px 0 rgba(255,255,255,0.7);
  --line: #d5dded;
  --text: #111c30;
  --muted: #5d6983;
  --accent: #1476ff;
  --accent-strong: #0f63d8;
  --success: #1f8f56;
  --panel: #ffffff;
  --panel-strong: #f5f8ff;
  --panel-alt: #f2f6ff;
  --btn-text: #ffffff;
  --result-pre-text: #10213f;
  --focus-ring: rgba(15, 99, 216, 0.2);
  --hover-bg: rgba(20, 118, 255, 0.1);
  --badge-line: rgba(31, 143, 86, 0.34);
  --brand-glow: rgba(20, 118, 255, 0.45);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --bg-base: #0a0a0d;
  --bg-accent-a: rgba(123, 225, 255, 0.16);
  --bg-accent-b: rgba(149, 255, 164, 0.12);
  --shell-bg: linear-gradient(180deg, rgba(17, 18, 25, 0.95), rgba(13, 14, 20, 0.96));
  --shell-header-bg: rgba(255,255,255,0.01);
  --shell-shadow: 0 20px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
  --line: #2a2d3a;
  --text: #eceef8;
  --muted: #a7adc4;
  --accent: #7be1ff;
  --accent-strong: #4dc8ed;
  --success: #95ffa4;
  --panel: #111219;
  --panel-strong: #1a1d29;
  --panel-alt: #242938;
  --btn-text: #051822;
  --result-pre-text: #cef6ff;
  --focus-ring: rgba(77,200,237,.18);
  --hover-bg: rgba(123,225,255,0.11);
  --badge-line: rgba(149,255,164,.3);
  --brand-glow: rgba(123,225,255,.85);
}
* { box-sizing: border-box; }
html { color-scheme: light; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(1200px 500px at 20% -10%, var(--bg-accent-a), transparent 60%),
    radial-gradient(900px 420px at 90% 0%, var(--bg-accent-b), transparent 70%),
    linear-gradient(180deg, var(--bg-base) 0%, var(--bg-base) 100%);
  font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Noto Serif SC", serif;
}
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
.page-wrap { min-height: 100vh; padding: 28px; }
.shell {
  max-width: 1160px;
  margin: 0 auto;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--shell-bg);
  box-shadow: var(--shell-shadow);
  overflow: visible;
}
.shell-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 26px;
  border-bottom: 1px solid var(--line);
  background: var(--shell-header-bg);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  letter-spacing: 0.08em;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--muted);
}
.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 18px var(--brand-glow);
}
.top-nav {
  display: inline-flex;
  gap: 10px;
  align-items: center;
}
.nav-link {
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--muted);
  transition: .2s ease;
}
.nav-link:hover { border-color: var(--accent); color: var(--text); }
.theme-select {
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  font-size: 12px;
  font-family: inherit;
}
.theme-select:focus {
  outline: none;
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.shell-main { padding: 30px 30px 34px; }
.hero-title {
  margin: 0;
  font-size: clamp(28px, 5vw, 46px);
  line-height: 1.07;
  letter-spacing: -0.01em;
}
.hero-sub {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 15px;
  max-width: 72ch;
  line-height: 1.6;
}
.card-grid {
  margin-top: 26px;
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 16px;
}
.panel {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  padding: 18px;
}
.panel h2 { margin: 0 0 10px; font-size: 20px; }
.panel p { margin: 0; color: var(--muted); line-height: 1.6; }
.panel-list { margin: 0; padding-left: 20px; color: var(--muted); }
.panel-list li { margin: 8px 0; }
.xq-section {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
}
.xq-section > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  list-style: none;
  padding: 16px 18px;
}
.xq-section > summary::-webkit-details-marker { display: none; }
.segment-control {
  display: inline-flex;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel-strong);
  gap: 4px;
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
  border-radius: 8px;
  cursor: pointer;
  color: var(--muted);
}
.segment-control input:checked + span {
  display: inline-flex;
  padding: 8px 12px;
  border-radius: 8px;
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
  gap: 8px;
  margin-top: 18px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--accent-strong);
  color: var(--text);
  background: var(--hover-bg);
  transition: .2s ease;
}
.cta-link:hover { transform: translateY(-1px); }
.xq-grid {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
.xq-layout {
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 0.9fr);
  align-items: start;
  gap: 18px;
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
  gap: 16px;
  align-self: start;
  align-content: start;
  background: var(--panel-strong);
  box-shadow: 0 18px 32px rgba(20, 31, 57, 0.08);
  transition: top .18s ease;
}
.xq-side-rail .badge {
  justify-self: start;
}
html[data-theme="dark"] .xq-side-rail {
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.03);
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
  padding: 12px 14px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.65;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel-alt);
}
.field { display: grid; gap: 8px; }
.field label { font-size: 13px; color: var(--muted); letter-spacing: .03em; }
.input, .textarea {
  width: 100%;
  border: 1px solid var(--line);
  background: var(--panel-strong);
  color: var(--text);
  border-radius: 10px;
  padding: 11px 12px;
  font: inherit;
}
.textarea { min-height: 112px; resize: vertical; }
.input:focus, .textarea:focus {
  border-color: var(--accent-strong);
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.btn {
  border-radius: 10px;
  padding: 10px 14px;
  font-weight: 700;
  font: inherit;
  cursor: pointer;
  transition: .2s ease;
}
.btn:focus {
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
}
.btn-primary:hover { filter: brightness(1.06); }
.btn-secondary {
  border: 1px solid var(--line);
  background: var(--panel-strong);
  color: var(--text);
}
.btn-secondary:hover {
  border-color: var(--accent-strong);
  background: var(--hover-bg);
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--success);
  font-size: 12px;
  border: 1px solid var(--badge-line);
  border-radius: 999px;
  padding: 5px 10px;
}
.result-panel {
  display: grid;
  gap: 0;
  border: 0;
  border-radius: 14px;
  background: transparent;
  overflow: visible;
}
.xq-result-panel {
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--panel-alt), var(--panel));
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.xq-result-actions {
  margin-bottom: 8px;
}
.result-head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.result-pre {
  margin: 0;
  padding: 14px;
  overflow: auto;
  max-height: 340px;
  color: var(--result-pre-text);
  font-family: "Iosevka SS08", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.55;
}
.reader-home-panel {
  margin-top: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 255, 0.92));
  border-color: rgba(112, 138, 182, 0.2);
  box-shadow: 0 18px 36px rgba(36, 54, 92, 0.08);
}
.reader-home-panel p {
  max-width: 64ch;
}
.reader-layout {
  margin-top: 24px;
  display: grid;
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.reader-sidebar,
.reader-feed-banner,
.reader-source-card,
.reader-entry-expanded {
  border-color: rgba(112, 138, 182, 0.18);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 248, 255, 0.95));
  box-shadow: 0 10px 24px rgba(36, 54, 92, 0.08);
}
.reader-entry-stack {
  border-color: rgba(112, 138, 182, 0.16);
  background: linear-gradient(180deg, rgba(250, 252, 255, 0.98), rgba(243, 247, 253, 0.95));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.72);
}
.reader-sidebar {
  display: grid;
  gap: 14px;
  position: sticky;
  top: 24px;
}
.reader-sidebar-head,
.reader-entry-stack-head,
.reader-banner-head,
.reader-card-head,
.reader-article-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.reader-sidebar-copy,
.reader-stack-copy,
.reader-banner-copy,
.reader-feed-description,
.reader-article-copy,
.reader-empty,
.reader-issue {
  color: #5d6983;
  line-height: 1.65;
}
.reader-kicker {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #6c7a98;
}
.reader-summary-text {
  margin: 0;
  color: #6c7a98;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.reader-source-list,
.reader-entry-list,
.reader-main-column {
  display: grid;
  gap: 10px;
}
.reader-main-column {
  min-width: 0;
}
.reader-source-button,
.reader-entry-button {
  width: 100%;
  min-height: 44px;
  border: 1px solid rgba(112, 138, 182, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.74);
  color: var(--text);
  padding: 12px 13px;
  text-align: left;
  cursor: pointer;
  transition: transform .16s ease, border-color .16s ease, background-color .16s ease, box-shadow .16s ease;
  touch-action: manipulation;
}
.reader-source-button:hover,
.reader-entry-button:hover {
  border-color: rgba(71, 112, 178, 0.28);
  background: rgba(248, 251, 255, 0.98);
}
.reader-source-button:active,
.reader-entry-button:active,
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
  box-shadow: 0 0 0 3px rgba(20, 118, 255, 0.14);
  border-color: rgba(20, 118, 255, 0.32);
}
.reader-source-button.is-active,
.reader-entry-button.is-active {
  border-color: rgba(20, 118, 255, 0.24);
  background: rgba(244, 248, 255, 0.98);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.8), 0 8px 18px rgba(36, 54, 92, 0.08);
}
.reader-source-headline,
.reader-entry-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.reader-source-name,
.reader-entry-name,
.reader-card-title,
.reader-banner-title,
.reader-article-title,
.reader-feed-title {
  margin: 0;
  color: #111c30;
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
  font-size: clamp(24px, 3vw, 34px);
  line-height: 1.08;
}
.reader-source-meta,
.reader-entry-excerpt,
.reader-banner-meta {
  display: block;
  margin-top: 7px;
  color: #5d6983;
  font-size: 12px;
  line-height: 1.55;
}
.reader-source-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.reader-state-badge,
.reader-run-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid rgba(112, 138, 182, 0.18);
  background: rgba(247, 250, 255, 0.84);
  color: #5d6983;
}
.reader-state-badge.is-enabled,
.reader-run-badge.is-success,
.reader-run-badge.is-delivered {
  color: #2a6a48;
  border-color: rgba(42, 106, 72, 0.22);
  background: rgba(231, 246, 234, 0.9);
}
.reader-state-badge.is-disabled,
.reader-run-badge.is-failed,
.reader-run-badge.is-interrupted {
  color: #8a4234;
  border-color: rgba(138, 66, 52, 0.24);
  background: rgba(252, 234, 228, 0.92);
}
.reader-run-badge.is-skipped,
.reader-run-badge.is-partial,
.reader-run-badge.is-running,
.reader-run-badge.is-planned {
  color: #3b69a5;
  border-color: rgba(59, 105, 165, 0.2);
  background: rgba(236, 244, 255, 0.92);
}
.reader-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 9px 13px;
  border-radius: 999px;
  border: 1px solid rgba(20, 118, 255, 0.2);
  background: rgba(245, 249, 255, 0.92);
  color: #0f63d8;
}
.reader-feed-note,
.reader-feed-banner,
.reader-source-card,
.reader-entry-expanded {
  padding: 18px;
  border-radius: 18px;
}
.reader-entry-stack {
  padding: 18px;
  border-radius: 18px;
}
.reader-feed-note {
  margin-top: 16px;
  border: 1px dashed rgba(112, 138, 182, 0.22);
  background: rgba(249, 251, 255, 0.72);
}
.reader-entry-item {
  display: grid;
  gap: 10px;
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
  padding: 18px;
  border: 1px solid rgba(112, 138, 182, 0.16);
}
.reader-meta-grid,
.reader-feed-grid {
  margin: 18px 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
}
.reader-meta-grid dt,
.reader-feed-grid dt {
  color: #6c7a98;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.reader-meta-grid dd,
.reader-feed-grid dd {
  margin: 0;
  color: #111c30;
  font-size: 14px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.reader-entry-meta-grid {
  margin-top: 14px;
}
.reader-article-section {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid rgba(112, 138, 182, 0.14);
}
.reader-article-section h3,
.reader-article-section h4 {
  margin: 0 0 10px;
  font-size: 15px;
  color: #111c30;
}
.reader-article-content {
  margin: 0;
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.75;
  color: #111c30;
}
.reader-issue {
  margin: 0;
  padding: 12px 13px;
  border-radius: 12px;
  border: 1px solid rgba(138, 66, 52, 0.18);
  background: rgba(252, 236, 231, 0.88);
}
html[data-theme="dark"] .reader-home-panel,
html[data-theme="dark"] .reader-sidebar,
html[data-theme="dark"] .reader-feed-banner,
html[data-theme="dark"] .reader-source-card,
html[data-theme="dark"] .reader-entry-expanded {
  border-color: rgba(117, 144, 188, 0.18);
  background: linear-gradient(180deg, rgba(19, 24, 34, 0.96), rgba(14, 19, 28, 0.98));
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255,255,255,0.03);
}
html[data-theme="dark"] .reader-entry-stack {
  border-color: rgba(117, 144, 188, 0.14);
  background: linear-gradient(180deg, rgba(16, 21, 31, 0.98), rgba(12, 17, 26, 0.96));
}
html[data-theme="dark"] .reader-source-button,
html[data-theme="dark"] .reader-entry-button,
html[data-theme="dark"] .reader-feed-note,
html[data-theme="dark"] .reader-link,
html[data-theme="dark"] .reader-entry-expanded {
  border-color: rgba(117, 144, 188, 0.16);
  background: rgba(29, 37, 52, 0.8);
  color: #eceef8;
}
html[data-theme="dark"] .reader-source-name,
html[data-theme="dark"] .reader-entry-name,
html[data-theme="dark"] .reader-card-title,
html[data-theme="dark"] .reader-banner-title,
html[data-theme="dark"] .reader-article-title,
html[data-theme="dark"] .reader-feed-title,
html[data-theme="dark"] .reader-meta-grid dd,
html[data-theme="dark"] .reader-feed-grid dd,
html[data-theme="dark"] .reader-article-content,
html[data-theme="dark"] .reader-article-section h3,
html[data-theme="dark"] .reader-article-section h4 {
  color: #eceef8;
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
html[data-theme="dark"] .reader-feed-grid dt {
  color: #a7adc4;
}
@media (max-width: 900px) {
  .reader-layout {
    grid-template-columns: 1fr;
  }
  .reader-sidebar {
    position: static;
    top: auto;
  }
  .reader-meta-grid,
  .reader-feed-grid,
  .reader-entry-meta-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 900px) {
  .page-wrap { padding: 14px; }
  .shell-main { padding: 18px; }
  .card-grid { grid-template-columns: 1fr; }
  .xq-layout { grid-template-columns: 1fr; }
  .xq-side-rail {
    position: static;
    top: auto;
  }
}
        `,
          }}
        />
      </head>
      <body>
        <props.Component />
      </body>
    </html>
  )
}
