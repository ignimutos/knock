import {
  createRunSourceAttemptId,
  createRunSourceItemId,
  renderRunSourcePayloadTemplate,
  renderRunSourceTemplate,
} from './run_source_context_helpers.ts'
import type {
  RunSourceExecutionContext,
  RunSourceUseCaseDeps,
} from './run_source_execution_types.ts'

export class RunSourceExecutionContextFactory {
  constructor(private readonly deps: RunSourceUseCaseDeps) {}

  create(): RunSourceExecutionContext {
    if (
      this.deps.runRepository === undefined ||
      this.deps.itemRepository === undefined ||
      this.deps.deliveryAttemptRepository === undefined ||
      this.deps.deduplicationRepository === undefined ||
      this.deps.deliveryExecutors === undefined
    ) {
      throw new Error('run source execute 缺少完整 pipeline 依赖')
    }

    return {
      now: this.deps.now,
      createItemId: (entry) =>
        createRunSourceItemId({
          entry,
          createRunId: this.deps.createRunId,
          createItemId: this.deps.createItemId,
        }),
      createAttemptId: this.deps.createAttemptId ?? createRunSourceAttemptId,
      runRepository: this.deps.runRepository,
      itemRepository: this.deps.itemRepository,
      deliveryAttemptRepository: this.deps.deliveryAttemptRepository,
      deduplicationRepository: this.deps.deduplicationRepository,
      deliveryExecutors: this.deps.deliveryExecutors,
      renderContent: (template, context) =>
        this.deps.renderContent?.(template, context) ?? renderRunSourceTemplate(template, context),
      renderPayload: (payload, context) =>
        this.deps.renderPayload?.(payload, context) ??
        renderRunSourcePayloadTemplate(payload, context),
      shouldPassFilter: this.deps.shouldPassFilter,
      logger: this.deps.logger,
    }
  }
}
