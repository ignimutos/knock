import { AppShell } from '../components/layout/app_shell.tsx'

export default function IndexPage() {
  return (
    <AppShell
      title="Knock Web"
      subtitle="面向最终 Web RSS 阅读器的工作台：先在 Reader 浏览真实 source 内容，再用 Playground 调试抓取与解析。"
    >
      <section class="panel reader-home-panel">
        <h2>RSS Reader</h2>
        <p>
          浏览所有 source 的最近 feed / entry 快照，把阅读面放在前台，推送能力继续留在 delivery 层。
        </p>
        <a
          href="/reader"
          class="cta-link"
        >
          打开 Reader →
        </a>
      </section>
      <section class="card-grid">
        <article class="panel">
          <h2>XQuery Playground</h2>
          <p>
            在浏览器里快速验证 URL、定位表达式和映射逻辑，先得到结构化 JSON，再决定是否写入正式
            source 配置。
          </p>
          <a
            href="/xquery"
            class="cta-link"
          >
            进入 Playground →
          </a>
        </article>
        <article class="panel">
          <h2>Syndication Playground</h2>
          <p>直接预览 RSS / Atom / JSON Feed 的标准化结果，并调试 feed / entry 字段映射。</p>
          <a
            href="/syndication"
            class="cta-link"
          >
            进入 Playground →
          </a>
        </article>
      </section>
    </AppShell>
  )
}
