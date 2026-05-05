import { assertEquals } from '../testing/assert.ts'
import { loadConfigWorkbenchContext } from '../interfaces/web/runtime_session.ts'
import { test } from '../testing/test_api.ts'
import { withEnv, withRuntimeHarness, writeRuntimeFile } from '../testing/test_helpers.ts'

async function withRuntimeDir(configYml: string, fn: (runtimeDir: string) => Promise<void>) {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(runtimeDir, 'config.yml', configYml)
    await withEnv({ KNOCK_RUNTIME_DIR: runtimeDir }, async () => {
      await fn(runtimeDir)
    })
  })
}

test('[contract] config workbench overview: 应对 raw secret 做 redaction', async () => {
  await withRuntimeDir(
    `ai:\n  providers:\n    anthropic:\n      type: anthropic\n      apiKey: real-api-key\n      models: {}\ndeliveries:\n  mailer:\n    email:\n      smtp:\n        host: smtp.example.com\n        port: 587\n        security: starttls\n        auth:\n          username: bot\n          password: real-secret\n      message:\n        from: noreply@example.com\n        to:\n          - ops@example.com\n        subject: hello\n        text: body\nsources:\n  rust:\n    enabled: true\n    http:\n      url: https://example.com/feed.xml\n    syndication: {}\n    deliveries:\n      mailer:\n        message:\n          headers:\n            Authorization: Bearer top-secret\n`,
    async () => {
      const { workbench } = await loadConfigWorkbenchContext()
      assertEquals(workbench.global.aiJson.includes('real-api-key'), false)
      assertEquals(workbench.deliveries[0]?.configJson.includes('real-secret'), false)
      assertEquals(
        JSON.stringify(workbench.reader.sources[0]?.deliveryOverrides).includes('top-secret'),
        false,
      )
      assertEquals(workbench.global.aiJson.includes('__KNOCK_SECRET_UNCHANGED__'), true)
    },
  )
})

test('[contract] config workbench overview: 加载失败时应返回通用 issue 文案', async () => {
  await withRuntimeDir('deliveries:\n  broken: {}\n', async () => {
    const { workbench } = await loadConfigWorkbenchContext().catch(async () => ({
      rawDocument: undefined,
      workbench: await (
        await import('../interfaces/web/runtime_session.ts')
      ).loadConfigWorkbenchOverview(),
    }))

    assertEquals(workbench.issue, '读取 Config Workbench 数据失败，请查看服务端日志。')
  })
})
