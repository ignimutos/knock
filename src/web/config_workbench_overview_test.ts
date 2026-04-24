import { assertEquals } from '@std/assert'
import { loadConfigWorkbenchContext } from './config_workbench_overview.ts'

async function withRuntimeDir(configYml: string, fn: (runtimeDir: string) => Promise<void>) {
  const runtimeDir = await Deno.makeTempDir()
  const previous = Deno.env.get('KNOCK_RUNTIME_DIR')
  try {
    await Deno.writeTextFile(`${runtimeDir}/config.yml`, configYml)
    Deno.env.set('KNOCK_RUNTIME_DIR', runtimeDir)
    await fn(runtimeDir)
  } finally {
    if (previous === undefined) {
      Deno.env.delete('KNOCK_RUNTIME_DIR')
    } else {
      Deno.env.set('KNOCK_RUNTIME_DIR', previous)
    }
    await Deno.remove(runtimeDir, { recursive: true })
  }
}

Deno.test('[contract] config workbench overview: 应对 raw secret 做 redaction', async () => {
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

Deno.test('[contract] config workbench overview: 加载失败时应返回通用 issue 文案', async () => {
  await withRuntimeDir('deliveries:\n  broken: {}\n', async () => {
    const { workbench } = await loadConfigWorkbenchContext().catch(async () => ({
      rawDocument: undefined,
      workbench: await (
        await import('./config_workbench_overview.ts')
      ).loadConfigWorkbenchOverview(),
    }))

    assertEquals(workbench.issue, '读取 Config Workbench 数据失败，请查看服务端日志。')
  })
})
