import {
  loadConfigRuntimeContext,
  type ConfigRuntimeContext,
} from '../../config/runtime_config_context.ts'
import type { RawConfigDocumentLoadResult } from '../../config/raw_config_document.ts'
import type { ConfigWorkbenchOverview, ReaderOverview } from '../../contracts/workbench.ts'
import { normalizeWorkbenchIssue } from '../../config/workbench_overview.ts'

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
  const { buildCurrentReaderOverview } = await import('../../config/reader_overview.ts')
  return await buildCurrentReaderOverview({
    loaded: session.context.loaded,
    rawDocument: session.context.rawDocument.document,
  })
}

export async function buildWorkbenchOverviewFromSession(
  session: RuntimeSession,
): Promise<ConfigWorkbenchOverview> {
  const { buildConfigWorkbenchOverview } = await import('../../config/workbench_overview.ts')
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
