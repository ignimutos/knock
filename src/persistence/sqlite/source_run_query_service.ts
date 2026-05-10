import type {
  SourceRunQueryService,
  SourceRunView,
} from '../../workflow/ports/source_run_query_service.ts'
import type { FactsDbClient } from '../../persistence/sqlite/client.ts'
import { createSqliteReadModel } from '../../persistence/sqlite/read_model.ts'

export function createSourceRunQueryService(db: FactsDbClient): SourceRunQueryService {
  const readModel = createSqliteReadModel(db)

  return {
    getRun(runId: string): Promise<SourceRunView | undefined> {
      return readModel.getRun(runId)
    },
  }
}
