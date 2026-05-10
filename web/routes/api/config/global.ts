import { createConfigActionHandler } from '../../../../src/adapters/web/create_config_action_handler.ts'
import { classifyConfigManagementError } from '../../../../src/contracts/errors.ts'
import { saveGlobalConfig } from '../../../../src/config/mutation_service.ts'

export const handler = createConfigActionHandler({
  runAction: saveGlobalConfig,
  classifyError: classifyConfigManagementError,
})

export const POST = handler
