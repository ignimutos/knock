// layer: contract
// risk-id: R03
import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { buildWorkbenchOverviewFromSession, loadRuntimeSession } from './runtime_session.ts'
import { withEnv, withRuntimeHarness, writeRuntimeFile } from '../../testing/test_helpers.ts'

test('[contract] R03 runtime session: workbench overview 应复用同一 runtime context', async () => {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(
      runtimeDir,
      'config.yml',
      'logging:\n  level: info\nsources: {}\ndeliveries: {}\n',
    )
    await withEnv({ KNOCK_RUNTIME_DIR: runtimeDir }, async () => {
      const session = await loadRuntimeSession()
      const overview = await buildWorkbenchOverviewFromSession(session)
      assertEquals(overview.global.logging?.level, 'info')
      assertEquals(Array.isArray(overview.reader.sources), true)
    })
  })
})
