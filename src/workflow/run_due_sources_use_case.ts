import type { Logger } from '../core/logger.ts'
import type { RunSourceResult, RunSourceUseCase } from './run_source_use_case.ts'
import type { SourceQueryService } from '../workflow/ports/query_service.ts'

export interface RunDueSourcesCommand {
  trigger: 'scheduled' | 'immediate' | 'manual'
  scheduledAt?: string
  sourceId?: string
}

export interface RunDueSourcesUseCaseDeps {
  now: () => string
  sourceQueryService: SourceQueryService
  runSourceUseCase: Pick<RunSourceUseCase, 'execute'>
  logger?: Pick<Logger, 'error'>
}

export class RunDueSourcesUseCase {
  constructor(private readonly deps: RunDueSourcesUseCaseDeps) {}

  async execute(command: RunDueSourcesCommand): Promise<RunSourceResult[]> {
    const scheduledAt = command.scheduledAt ?? this.deps.now()

    if (command.sourceId) {
      const source = await this.deps.sourceQueryService.getSource(command.sourceId)
      if (!source) {
        throw new Error(`source 未定义: ${command.sourceId}`)
      }

      return [
        await this.deps.runSourceUseCase.execute({
          source,
          profile: 'production',
          effectDomain: 'production',
          trigger: command.trigger,
          scheduledAt,
          bindings: await this.deps.sourceQueryService.getBindings(command.sourceId),
        }),
      ]
    }

    const dueSources = await this.deps.sourceQueryService.listDueSources(
      scheduledAt,
      command.trigger,
    )

    return await Promise.all(
      dueSources.map((dueSource) =>
        this.deps.runSourceUseCase
          .execute({
            source: dueSource.source,
            profile: 'production',
            effectDomain: 'production',
            trigger: command.trigger,
            scheduledAt,
            bindings: dueSource.bindings,
          })
          .catch((error: unknown) => {
            this.deps.logger?.error('source run failed', {
              'scheduler.operation': 'run_source',
              'scheduler.outcome': 'failure',
              'source.id': dueSource.source.sourceId,
              error_name: error instanceof Error ? error.name : 'Error',
              error_message: 'source run failed',
            })
            return undefined
          }),
      ),
    ).then((results) => results.filter((result): result is RunSourceResult => result !== undefined))
  }
}
