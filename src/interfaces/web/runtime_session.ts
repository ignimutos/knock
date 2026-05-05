import {
  loadConfigRuntimeContext,
  type ConfigRuntimeContext,
} from '../../config/runtime_config_context.ts'
import type { RawConfigDocumentLoadResult } from '../../config/raw_config_document.ts'
import type { ConfigWorkbenchOverview } from '../../application/config_workbench/workbench_contract.ts'
import { normalizeWorkbenchIssue } from '../../web/config_workbench_overview.ts'
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

export async function loadConfigWorkbenchContext(): Promise<{
  rawDocument: RawConfigDocumentLoadResult
  workbench: ConfigWorkbenchOverview
}> {
  const session = await loadRuntimeSession()

  return {
    rawDocument: session.context.rawDocument,
    workbench: await buildWorkbenchOverviewFromSession(session),
  }
}

export async function loadConfigWorkbenchOverview(): Promise<ConfigWorkbenchOverview> {
  try {
    return (await loadConfigWorkbenchContext()).workbench
  } catch (error) {
    return {
      reader: { sources: [], deliveries: [] },
      global: {
        language: '',
        timezone: '',
        timestampFormat: '',
        sqlite: undefined,
        sqliteJson: '',
        logging: undefined,
        loggingJson: '',
        ai: undefined,
        aiJson: '',
      },
      deliveries: [],
      issue: normalizeWorkbenchIssue(error),
    }
  }
}
