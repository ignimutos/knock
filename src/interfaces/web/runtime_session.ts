import {
  loadConfigRuntimeContext,
  type ConfigRuntimeContext,
} from '../../config/runtime_config_context.ts'
import type { ConfigWorkbenchOverview } from '../../web/config_workbench_overview.ts'
import type { ReaderOverview } from '../../web/reader_overview.ts'

export interface RuntimeSession {
  context: ConfigRuntimeContext
}

export async function loadRuntimeSession(): Promise<RuntimeSession> {
  return {
    context: await loadConfigRuntimeContext({ envMode: 'preserve_unknown' }),
  }
}

export async function buildReaderOverviewFromSession(
  session: RuntimeSession,
): Promise<ReaderOverview> {
  const { buildCurrentReaderOverview } = await import('../../web/reader_overview.ts')
  return await buildCurrentReaderOverview({
    loaded: session.context.loaded,
    rawDocument: session.context.rawDocument.document,
  })
}

export async function buildWorkbenchOverviewFromSession(
  session: RuntimeSession,
): Promise<ConfigWorkbenchOverview> {
  const { buildConfigWorkbenchOverview } = await import('../../web/config_workbench_overview.ts')
  return buildConfigWorkbenchOverview({
    rawDocument: session.context.rawDocument.document,
    reader: await buildReaderOverviewFromSession(session),
  })
}
