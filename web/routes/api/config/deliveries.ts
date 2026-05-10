import { createConfigActionHandler } from '../../../../src/adapters/web/create_config_action_handler.ts'
import { classifyConfigManagementError } from '../../../../src/contracts/errors.ts'
import { saveCanonicalDelivery } from '../../../../src/config/mutation_service.ts'

export const handler = createConfigActionHandler({
  runAction: saveCanonicalDelivery,
  classifyError: classifyConfigManagementError,
})

export const POST = handler
