import type { SourceDeliveryOverride } from '../../config/types.ts'
import { writeConfigRuntimeContext } from '../../config/runtime_config_context.ts'
import {
  parseSourceConfigUpdate,
  SourceManagementContractError,
} from './source_management_contract.ts'
import {
  applySourceConfigDocumentUpdate,
  SourceConfigDocumentUpdateError,
} from '../../config/update_source_document.ts'
import { throwConflict, throwNotFound, throwValidation } from './source_management_errors.ts'
import { type ReaderOverview } from '../../web/reader_overview.ts'
import { restoreConfigSecrets } from '../../web/config_secret_redaction.ts'
import { buildReaderOverviewFromSession, loadRuntimeSession } from './runtime_session.ts'
import { loadSourceActionContext } from './source_management_context.ts'
import {
  RunSourceNowUseCase,
  RunSourceNowUseCaseError,
} from '../../application/source_actions/run_source_now_use_case.ts'
import {
  ClearSourceHistoryUseCase,
  ClearSourceHistoryUseCaseError,
} from '../../application/source_actions/clear_source_history_use_case.ts'

export { classifySourceManagementError, SourceManagementError } from './source_management_errors.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? structuredClone(value) : {}
}

export async function updateSourceConfig(input: unknown): Promise<{
  message: string
  overview: ReaderOverview
}> {
  let request
  try {
    request = parseSourceConfigUpdate(input)
  } catch (error) {
    if (error instanceof SourceManagementContractError) {
      throwValidation(error.message)
    }
    throw error
  }
  const session = await loadRuntimeSession()
  const currentSource = cloneRecord(
    cloneRecord(session.context.rawDocument.document.sources)[request.sourceId],
  )
  const currentOverrides = cloneRecord(currentSource.deliveries)
  const deliveryOverrides = Object.fromEntries(
    Object.entries(request.deliveryOverrides).map(([deliveryId, override]) => [
      deliveryId,
      restoreConfigSecrets(override, currentOverrides[deliveryId]) as SourceDeliveryOverride,
    ]),
  )

  try {
    applySourceConfigDocumentUpdate(session.context.rawDocument.document, {
      ...request,
      deliveryOverrides,
    })
  } catch (error) {
    if (error instanceof SourceConfigDocumentUpdateError) {
      if (error.kind === 'not_found') {
        throwNotFound(error.message)
      }
      throwValidation(error.message)
    }
    throw error
  }
  let updatedContext
  try {
    updatedContext = await writeConfigRuntimeContext(session.context.rawDocument)
  } catch (error) {
    if (error instanceof Error) {
      throwValidation(error.message)
    }
    throw error
  }

  return {
    message: `source ${request.sourceId} 配置已保存`,
    overview: await buildReaderOverviewFromSession({
      context: updatedContext,
    }),
  }
}

type SourceActionUseCaseError = RunSourceNowUseCaseError | ClearSourceHistoryUseCaseError

function rethrowSourceActionUseCaseError(error: SourceActionUseCaseError): never {
  if (error.kind === 'not_found') {
    throwNotFound(error.message)
  }
  if (error.kind === 'conflict') {
    throwConflict(error.message)
  }
  throwValidation(error.message)
}

const runSourceNowUseCase = new RunSourceNowUseCase(loadSourceActionContext)
const clearSourceHistoryUseCase = new ClearSourceHistoryUseCase(loadSourceActionContext)

export async function runSourceNow(input: unknown): Promise<{
  started: boolean
  message: string
  overview: ReaderOverview
}> {
  try {
    return await runSourceNowUseCase.execute(input)
  } catch (error) {
    if (error instanceof RunSourceNowUseCaseError) {
      rethrowSourceActionUseCaseError(error)
    }
    throw error
  }
}

export async function clearSourceHistory(input: unknown): Promise<{
  message: string
  deletedRuns: number
  deletedItems: number
  deletedAttempts: number
  overview: ReaderOverview
}> {
  try {
    return await clearSourceHistoryUseCase.execute(input)
  } catch (error) {
    if (error instanceof ClearSourceHistoryUseCaseError) {
      rethrowSourceActionUseCaseError(error)
    }
    throw error
  }
}
