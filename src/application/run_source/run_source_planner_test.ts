import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { RunSourcePlanner } from './run_source_planner.ts'

test('[unit] runSourcePlanner: 应补默认 scheduledAt 与空 bindings', async () => {
  const planner = new RunSourcePlanner({
    now: () => '2026-04-13T09:00:00.000Z',
    createRunId: () => 'run-1',
  })

  const plan = await planner.plan({
    source: {
      kind: 'fetch',
      sourceId: 'rust',
      fetcher: 'http',
      parser: 'syndication',
    },
    profile: 'production',
    effectDomain: 'production',
    trigger: 'scheduled',
  })

  assertEquals(plan.runId, 'run-1')
  assertEquals(plan.scheduledAt, '2026-04-13T09:00:00.000Z')
  assertEquals(plan.bindings, [])
})
