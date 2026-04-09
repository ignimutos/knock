import { AppShell } from '../components/layout/app_shell.tsx'

export default function IndexPage() {
  return (
    <AppShell
      title="Knock"
      subtitle="一个面向抓取与投递调试的控制台：先在页面上验证，再进入自动化运行。"
    >
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
          <h2>当前能力</h2>
          <ul class="panel-list">
            <li>服务端抓取网页，避免浏览器跨域限制</li>
            <li>统一查看 JSON 结果，便于复制到配置</li>
            <li>后续可扩展 feed/entry 映射调试</li>
          </ul>
        </article>
      </section>
    </AppShell>
  )
}
