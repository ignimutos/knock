import { assertEquals, assertRejects } from '../testing/assert.ts'
import { join } from 'node:path'
import { startApp } from '../main.ts'
import { cwd, statPath } from '../platform/fs.ts'
import { test } from '../testing/test_api.ts'
import { withRuntimeHarness, writeRuntimeFile } from '../testing/test_helpers.ts'

function withAppRuntime(
  testName: string,
  run: (runtimeDir: string) => Promise<void>,
): Promise<void> {
  return withRuntimeHarness(join(cwd(), '.tmp', `runtime-app-${testName}`), run)
}

test('[contract] app: 启动入口应拒绝非法 keepAlive 类型', async () => {
  await assertRejects(
    () => startApp({ keepAlive: 'yes' as never }),
    Error,
    'keepAlive 必须是布尔值',
  )
})

test('[contract] app: 启动入口应拒绝非法 runtimeDir 类型', async () => {
  await assertRejects(
    () => startApp({ runtimeDir: 123 as never }),
    Error,
    'runtimeDir 必须是字符串',
  )
})

test('[contract] app: 启动入口应拒绝非法 httpProxyClientFactory 类型', async () => {
  await assertRejects(
    () => startApp({ httpProxyClientFactory: 'not-fn' as never }),
    Error,
    'httpProxyClientFactory 必须是函数',
  )
})

test('[flow] R03 app: 未传 immediate 时入口模型应显式视为 false', async () => {
  await withAppRuntime('default-immediate-false', async (testRuntime) => {
    await writeRuntimeFile(
      testRuntime,
      'config.yml',
      `
sources: {}
`,
    )

    const result = await startApp({ runtimeDir: testRuntime, keepAlive: false, once: false })
    assertEquals(result.mode, 'daemon')
  })
})

test('[flow] R03 app: immediate 模式应走 v2 daemon wiring 并返回 daemon 结果', async () => {
  await withAppRuntime('immediate-v2-daemon', async (testRuntime) => {
    await writeRuntimeFile(
      testRuntime,
      'config.yml',
      `
sources: {}
`,
    )

    const result = await startApp({
      runtimeDir: testRuntime,
      keepAlive: false,
      immediate: true,
      once: false,
    })

    assertEquals(result.mode, 'daemon')
  })
})

test('[flow] R03 app: once 模式应在一次启动执行后返回 daemon 结果', async () => {
  await withAppRuntime('once-v2-daemon', async (testRuntime) => {
    await writeRuntimeFile(
      testRuntime,
      'config.yml',
      `
sources: {}
`,
    )

    const result = await startApp({
      runtimeDir: testRuntime,
      keepAlive: false,
      once: true,
    })
    assertEquals(result.mode, 'daemon')
  })
})

test('[contract] app: stop 后应释放 logging runtime', async () => {
  await withAppRuntime('logging-runtime-dispose', async (testRuntime) => {
    await writeRuntimeFile(
      testRuntime,
      'config.yml',
      `
logging:
  sinks:
    file:
      type: file
      format: jsonl
      path: logs/app.jsonl
sources: {}
`,
    )

    await startApp({
      runtimeDir: testRuntime,
      keepAlive: false,
      immediate: true,
      once: false,
    })

    const logPath = join(testRuntime, 'logs', 'app.jsonl')
    const stat = await statPath(logPath)
    assertEquals(stat.isFile, true)
  })
})
export const testMeta = [
  {
    title: '[flow] R03 app: 未传 immediate 时入口模型应显式视为 false',
    layer: 'flow',
    risks: ['R03'],
  },
  {
    title: '[flow] R03 app: immediate 模式应走 v2 daemon wiring 并返回 daemon 结果',
    layer: 'flow',
    risks: ['R03'],
  },
  {
    title: '[flow] R03 app: once 模式应在一次启动执行后返回 daemon 结果',
    layer: 'flow',
    risks: ['R03'],
  },
] as const
