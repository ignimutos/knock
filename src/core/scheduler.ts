import type { Logger } from './logger.ts'

/**
 * 进程内只保证同一 source 同时最多一个执行实例；任务结束后必须允许下一次调度重新进入。
 */
const runningSourceIds = new Set<string>()

export interface Scheduler {
  runSource(sourceId: string, task: () => Promise<void>): Promise<void>
}

export function createScheduler(logger?: Logger): Scheduler {
  return {
    async runSource(sourceId: string, task: () => Promise<void>): Promise<void> {
      if (runningSourceIds.has(sourceId)) {
        logger?.warn('跳过重入执行', {
          'scheduler.operation': 'run_source',
          'scheduler.outcome': 'skipped',
          'source.id': sourceId,
          'scheduler.reason': 'reentry_inflight',
        })
        return
      }

      runningSourceIds.add(sourceId)
      try {
        await task()
      } finally {
        runningSourceIds.delete(sourceId)
      }
    },
  }
}
