import { createPlaygroundEvaluateHandler } from '../../../../src/interfaces/web/create_playground_evaluate_handler.ts'
import {
  classifyPlaygroundError,
  evaluatePlayground,
} from '../../../../src/web/xquery_playground.ts'

export type { EvaluateLogMeta } from '../../../../src/interfaces/web/create_playground_evaluate_handler.ts'

export const handler = createPlaygroundEvaluateHandler({
  evaluatePlayground,
  classifyError: classifyPlaygroundError,
})

export const POST = handler
