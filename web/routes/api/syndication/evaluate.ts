import { createPlaygroundEvaluateHandler } from '../../../../src/interfaces/web/create_playground_evaluate_handler.ts'
import {
  classifySyndicationPlaygroundError,
  evaluateSyndicationPlayground,
} from '../../../../src/web/syndication_playground.ts'

export type { EvaluateLogMeta } from '../../../../src/interfaces/web/create_playground_evaluate_handler.ts'

export const handler = createPlaygroundEvaluateHandler({
  evaluatePlayground: evaluateSyndicationPlayground,
  classifyError: classifySyndicationPlaygroundError,
})

export const POST = handler
