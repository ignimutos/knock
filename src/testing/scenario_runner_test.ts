import { assertEquals, assertRejects } from '@std/assert'
import { runScenario } from './scenario_runner.ts'

Deno.test('scenario-runner: 应按 arrange -> act -> assert 执行', async () => {
  const trace: string[] = []

  const result = await runScenario({
    arrange: async () => {
      trace.push('arrange')
      return { value: 40 }
    },
    act: ({ arranged }) => {
      trace.push('act')
      return arranged.value + 2
    },
    assert: ({ result: computed }) => {
      trace.push('assert')
      assertEquals(computed, 42)
    },
  })

  assertEquals(result, 42)
  assertEquals(trace, ['arrange', 'act', 'assert'])
})

Deno.test('scenario-runner: cleanup 应在 act 失败后执行', async () => {
  const trace: string[] = []

  await assertRejects(
    () =>
      runScenario({
        arrange: () => {
          trace.push('arrange')
          return { value: 1 }
        },
        act: () => {
          trace.push('act')
          throw new Error('act failed')
        },
        cleanup: () => {
          trace.push('cleanup')
        },
      }),
    Error,
    'act failed',
  )

  assertEquals(trace, ['arrange', 'act', 'cleanup'])
})
