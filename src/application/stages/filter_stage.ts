import type { PipelineItem } from '../../domain/pipeline_item.ts'

export interface FilterStageInput {
  item: PipelineItem
  filterTemplate?: string
}

export interface FilterStageDeps {
  shouldPassFilter?: (input: FilterStageInput) => Promise<boolean>
}

export interface FilterStageResult {
  status: 'passed' | 'filtered'
}

export class FilterStage {
  constructor(private readonly deps: FilterStageDeps = {}) {}

  async run(input: FilterStageInput): Promise<FilterStageResult> {
    if (!input.filterTemplate || input.filterTemplate.trim() === '') {
      return { status: 'passed' }
    }

    const passed = await (this.deps.shouldPassFilter?.(input) ?? Promise.resolve(true))
    return { status: passed ? 'passed' : 'filtered' }
  }
}
