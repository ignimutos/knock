import { createConfigActionHandler } from '../../../../src/interfaces/web/create_config_action_handler.ts'
import {
  classifyConfigManagementError,
  deleteDeliveryConfig,
} from '../../../../src/interfaces/web/config_management.ts'

export const handler = createConfigActionHandler({
  runAction: deleteDeliveryConfig,
  classifyError: classifyConfigManagementError,
})

export const POST = handler
