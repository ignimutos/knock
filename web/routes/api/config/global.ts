import { createConfigActionHandler } from '../../../../src/interfaces/web/create_config_action_handler.ts'
import {
  classifyConfigManagementError,
  updateGlobalConfig,
} from '../../../../src/interfaces/web/config_management.ts'

export const handler = createConfigActionHandler({
  runAction: updateGlobalConfig,
  classifyError: classifyConfigManagementError,
})

export const POST = handler
