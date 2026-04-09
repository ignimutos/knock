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
  overflow: hidden;
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
}
.xq-side-rail {
  position: sticky;
  top: 24px;
  display: grid;
  gap: 16px;
  align-content: start;
  background: var(--panel-strong);
  box-shadow: 0 18px 32px rgba(20, 31, 57, 0.08);
}
.xq-side-rail .badge {
  justify-self: start;
}
html[data-theme="dark"] .xq-side-rail {
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.03);
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
