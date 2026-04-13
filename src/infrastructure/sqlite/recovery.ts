import { eq, inArray } from 'drizzle-orm'
import { runInTransaction, type FactsDbClient } from '../../db/client.ts'
import { deliveryAttempts, sourceRuns } from './schema.ts'

export function markInterruptedAttempts(db: FactsDbClient, at: string): Promise<void> {
  return Promise.resolve().then(() => {
    runInTransaction(db, () => {
      const affectedRunIds = db
        .selectDistinct({ sourceRunId: deliveryAttempts.sourceRunId })
        .from(deliveryAttempts)
        .where(inArray(deliveryAttempts.status, ['planned', 'running']))
        .all()
        .map((row) => row.sourceRunId)

      if (affectedRunIds.length === 0) {
        return
      }

      db.update(deliveryAttempts)
        .set({
          status: 'interrupted',
          finishedAt: at,
          reason: 'process_interrupted',
        })
        .where(inArray(deliveryAttempts.status, ['planned', 'running']))
        .run()

      for (const runId of affectedRunIds) {
        db.update(sourceRuns)
          .set({
            status: 'interrupted',
            finishedAt: at,
          })
          .where(eq(sourceRuns.runId, runId))
          .run()
      }
    })
  })
}
