import type { JSX } from 'preact'

export function AppShell(props: {
  title: string
  subtitle?: string
  children: JSX.Element | JSX.Element[]
}) {
  return (
    <div class="page-wrap">
      <div class="shell">
        <header class="shell-header">
          <a
            href="/"
            class="brand"
          >
            <span class="brand-dot" />
            Knock Web
          </a>
          <nav class="top-nav">
            <a
              href="/"
              class="nav-link"
            >
              首页
            </a>
            <a
              href="/reader"
              class="nav-link"
            >
              Reader
            </a>
            <a
              href="/xquery"
              class="nav-link"
            >
              XQuery
            </a>
            <a
              href="/syndication"
              class="nav-link"
            >
              Syndication
            </a>
            <label>
              <span class="sr-only">主题模式</span>
              <select
                class="theme-select js-theme-select"
                aria-label="主题模式"
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
          </nav>
        </header>
        <main class="shell-main">
          <h1 class="hero-title">{props.title}</h1>
          {props.subtitle ? <p class="hero-sub">{props.subtitle}</p> : null}
          {props.children}
        </main>
      </div>
    </div>
  )
}
