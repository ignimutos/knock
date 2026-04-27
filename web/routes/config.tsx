import { AppShell } from '../components/layout/app_shell.tsx'
import type { ConfigWorkbenchOverview } from '../../src/web/config_workbench_overview.ts'
import ConfigWorkbench from '../islands/config_workbench.tsx'

function toBootstrapJson(workbench: ConfigWorkbenchOverview): string {
  return JSON.stringify(workbench).replace(/</g, '\\u003c')
}

export default function ConfigPage(props: { workbench: ConfigWorkbenchOverview }) {
  return (
    <AppShell
      title="Knock Config"
      subtitle="集中管理 Global、Deliveries 与 Sources；当前保存会重写 YAML 格式与注释。"
    >
      <section class="panel config-page-note">
        <p class="reader-kicker">config workbench</p>
        <p class="reader-empty">当前不保留 YAML 原始注释与布局；本页优先覆盖更多配置能力。</p>
        {props.workbench.issue ? <p class="reader-issue">{props.workbench.issue}</p> : null}
      </section>
      <div id="config-workbench-root">
        <ConfigWorkbench workbench={props.workbench} />
      </div>
      <script
        id="config-workbench-props"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: toBootstrapJson(props.workbench) }}
      />
      <script
        type="module"
        src="/assets/client.js"
      />
    </AppShell>
  )
}
