/** @jsxImportSource preact */

import { hydrate } from '../src/platform/preact.ts'
import type { ConfigWorkbenchOverview } from '../src/web/config_workbench_overview.ts'
import ConfigWorkbench from './islands/config_workbench.tsx'

const root = document.getElementById('config-workbench-root')
const data = document.getElementById('config-workbench-props')

if (root instanceof HTMLElement && data instanceof HTMLScriptElement && data.textContent) {
  try {
    hydrate(
      <ConfigWorkbench workbench={JSON.parse(data.textContent) as ConfigWorkbenchOverview} />,
      root,
    )
  } catch {
    // noop
  }
}
