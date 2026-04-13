import type { ContentRuntime } from '../../core/content_runtime.ts'
import type { RunPlan } from '../../domain/run_plan.ts'
import type { FetchedSourceInput } from '../../application/ports/source_input_gateway.ts'
import type { SummaryQueryService } from '../sqlite/summary_query_service.ts'

export interface SummarySourceInputGatewayDeps {
  summaryQueryService: SummaryQueryService
  contentRuntime: ContentRuntime
  language: string
}

export class SummarySourceInputGateway {
  constructor(private readonly _deps: SummarySourceInputGatewayDeps) {}

  fetch(plan: RunPlan): Promise<FetchedSourceInput> {
    if (plan.source.kind !== 'summary') {
      throw new Error('summary source gateway 只能处理 summary source')
    }
    return Promise.resolve({
      kind: 'summary',
      collectedAt: plan.scheduledAt,
      collectedJson: {
        sourceId: plan.source.sourceId,
        runId: plan.runId,
      },
      payloadSummary: {
        hash: `summary:${plan.source.sourceId}:${plan.scheduledAt}`,
        reference: plan.source.sourceId,
      },
    })
  }
}
