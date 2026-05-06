import { assertEquals, assertRejects } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { withRuntimeHarness, writeRuntimeFile } from '../../testing/test_helpers.ts'
import { startDaemonProcess } from './start_daemon_process.ts'

test('[contract] start daemon process: immediate 与 once 不能同时为 true', async () => {
  await assertRejects(
    () => startDaemonProcess({ immediate: true, once: true }),
    Error,
    'immediate 与 once 不能同时为 true',
  )
})

test('[contract] start daemon process: 非 immediate 模式应通过 daemon reload controller 启动', async () => {
  const calls: string[] = []

  await startDaemonProcess(
    {
      runtimeDir: '/tmp/runtime',
      keepAlive: false,
      once: false,
    },
    {
      createReloadController: () => ({
        start: async () => {
          calls.push('controller:start')
        },
        stop: async () => {
          calls.push('controller:stop')
        },
      }),
    },
  )

  assertEquals(calls, ['controller:start', 'controller:stop'])
})

test('[contract] start daemon process: immediate=true 应先跑启动轮次再进入 daemon reload controller 生命周期', async () => {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(
      runtimeDir,
      'config.yml',
      `sqlite:
  path: knock.db

deliveries:
  local:
    file:
      path: output.txt
      content: '{{ entry.title }}'

sources:
  demo:
    http:
      url: https://example.test/feed.xml
    deliveries:
      local: {}
`,
    )

    const calls: string[] = []
    let fetchCalls = 0
    const atomFeed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Demo</title><entry><id>e-1</id><title>Hello</title><link href="https://example.test/items/1" /><updated>2026-01-01T00:00:00Z</updated></entry></feed>`

    await startDaemonProcess(
      {
        runtimeDir,
        keepAlive: false,
        immediate: true,
        once: false,
        httpFetcher: async () => {
          fetchCalls += 1
          return new Response(atomFeed, {
            status: 200,
            headers: {
              'content-type': 'application/atom+xml',
            },
          })
        },
      },
      {
        createReloadController: () => ({
          start: async () => {
            calls.push('controller:start')
          },
          stop: async () => {
            calls.push('controller:stop')
          },
        }),
      },
    )

    assertEquals(fetchCalls, 1)
    assertEquals(calls, ['controller:start', 'controller:stop'])
  })
})

test('[contract] start daemon process: once=true 不应进入 daemon reload controller 生命周期', async () => {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(
      runtimeDir,
      'config.yml',
      `sqlite:
  path: knock.db

deliveries:
  local:
    file:
      path: output.txt
      content: '{{ entry.title }}'

sources:
  demo:
    http:
      url: https://example.test/feed.xml
    deliveries:
      local: {}
`,
    )

    const calls: string[] = []
    let fetchCalls = 0
    const atomFeed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Demo</title><entry><id>e-1</id><title>Hello</title><link href="https://example.test/items/1" /><updated>2026-01-01T00:00:00Z</updated></entry></feed>`

    await startDaemonProcess(
      {
        runtimeDir,
        keepAlive: false,
        once: true,
        httpFetcher: async () => {
          fetchCalls += 1
          return new Response(atomFeed, {
            status: 200,
            headers: {
              'content-type': 'application/atom+xml',
            },
          })
        },
      },
      {
        createReloadController: () => ({
          start: async () => {
            calls.push('controller:start')
          },
          stop: async () => {
            calls.push('controller:stop')
          },
        }),
      },
    )

    assertEquals(fetchCalls, 1)
    assertEquals(calls, [])
  })
})
