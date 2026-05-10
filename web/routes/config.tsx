import { AppShell } from '../components/layout/app_shell.tsx'
import type { ConfigWorkbenchOverview } from '../../src/contracts/workbench.ts'
import { redactConfigSecrets } from '../../src/web/config_secret_redaction.ts'
import ConfigWorkbench from '../islands/config_workbench.tsx'

function toBootstrapJson(workbench: ConfigWorkbenchOverview): string {
  return JSON.stringify(workbench).replace(/</g, '\\u003c')
}

function redactJsonString(value: string): string {
  if (value.trim() === '') return value

  try {
    return JSON.stringify(redactConfigSecrets(JSON.parse(value)), null, 2)
  } catch {
    return value
  }
}

function sanitizeWorkbench(input: ConfigWorkbenchOverview): ConfigWorkbenchOverview {
  const workbench = redactConfigSecrets(structuredClone(input)) as ConfigWorkbenchOverview

  return {
    ...workbench,
    global: {
      ...workbench.global,
      sqliteJson: redactJsonString(workbench.global.sqliteJson),
      loggingJson: redactJsonString(workbench.global.loggingJson),
      aiJson: redactJsonString(workbench.global.aiJson),
    },
    deliveries: workbench.deliveries.map((delivery) => ({
      ...delivery,
      configJson: redactJsonString(delivery.configJson),
    })),
  }
}

export default function ConfigPage(props: { workbench: ConfigWorkbenchOverview }) {
  const workbench = sanitizeWorkbench(props.workbench)

  return (
    <AppShell
      title="Knock Config"
      subtitle="集中管理 Global、Deliveries 与 Sources；当前保存会重写 YAML 格式与注释。"
    >
      <section class="panel config-page-note">
        <p class="reader-kicker">config workbench</p>
        <p class="reader-empty">当前不保留 YAML 原始注释与布局；本页优先覆盖更多配置能力。</p>
        {workbench.issue ? <p class="reader-issue">{workbench.issue}</p> : null}
      </section>
      <div id="config-workbench-root">
        <ConfigWorkbench workbench={workbench} />
      </div>
      <script
        id="config-workbench-props"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: toBootstrapJson(workbench) }}
      />
      <script
        type="module"
        src="/assets/client.js"
      />
    </AppShell>
  )
}
