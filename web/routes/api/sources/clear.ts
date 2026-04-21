import { createSourceActionHandler } from '../../../../src/interfaces/web/create_source_action_handler.ts'
import {
  classifySourceManagementError,
  clearSourceHistory,
} from '../../../../src/interfaces/web/source_management.ts'

export type { SourceActionLogMeta } from '../../../../src/interfaces/web/create_source_action_handler.ts'

export const handler = createSourceActionHandler({
  action: 'clear_history',
  runAction: clearSourceHistory,
  classifyError: classifySourceManagementError,
})

export const POST = handler
