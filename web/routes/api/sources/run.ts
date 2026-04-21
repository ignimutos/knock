import { createSourceActionHandler } from '../../../../src/interfaces/web/create_source_action_handler.ts'
import {
  classifySourceManagementError,
  runSourceNow,
} from '../../../../src/interfaces/web/source_management.ts'

export type { SourceActionLogMeta } from '../../../../src/interfaces/web/create_source_action_handler.ts'

export const handler = createSourceActionHandler({
  action: 'run_now',
  runAction: runSourceNow,
  classifyError: classifySourceManagementError,
})

export const POST = handler
