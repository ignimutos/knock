import { runInTransaction, type FactsDbClient } from '../../db/client.ts'

export function markInterruptedAttempts(db: FactsDbClient, at: string): Promise<void> {
  return Promise.resolve().then(() => {
    runInTransaction(db, () => {
      const affectedRunIds = (
        db.$client
          .prepare(
            `
              SELECT DISTINCT source_run_id AS sourceRunId
              FROM delivery_attempts
              WHERE status IN ('planned', 'running')
            `,
          )
          .all() as Array<{ sourceRunId: string }>
      ).map((row) => row.sourceRunId)

      if (affectedRunIds.length === 0) {
        return
      }

      db.$client
        .prepare(
          `
            UPDATE delivery_attempts
            SET status = 'interrupted',
                finished_at = ?,
                reason = 'process_interrupted'
            WHERE status IN ('planned', 'running')
          `,
        )
        .run(at)

      const updateRun = db.$client.prepare(
        `
          UPDATE source_runs
          SET status = 'interrupted',
              finished_at = ?
          WHERE run_id = ?
        `,
      )

      for (const runId of affectedRunIds) {
        updateRun.run(at, runId)
      }
    })
  })
}
