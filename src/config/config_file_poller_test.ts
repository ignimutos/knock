import { assertEquals } from '../testing/assert.ts'
import { test } from '../testing/test_api.ts'
import { createConfigFilePoller } from './config_file_poller.ts'
import type { FileInfo } from '../platform/fs.ts'

function createFileInfo(mtime: string): FileInfo {
  return {
    isFile: true,
    isDirectory: false,
    size: 1,
    mtime: new Date(mtime),
  }
}

test('[contract] config file poller: 首次 poll 只建立基线，mtime 变化后只触发一次 onChange', async () => {
  const infos = [
    createFileInfo('2026-05-04T00:00:00.000Z'),
    createFileInfo('2026-05-04T00:00:00.000Z'),
    createFileInfo('2026-05-04T00:00:01.000Z'),
    createFileInfo('2026-05-04T00:00:01.000Z'),
  ]
  let index = 0
  const calls: string[] = []

  const poller = createConfigFilePoller({
    configPath: '/tmp/runtime/config.yml',
    onChange: async () => {
      calls.push('reload')
    },
    statPathImpl: async () => infos[index++]!,
  })

  await poller.poll()
  await poller.poll()
  await poller.poll()
  await poller.poll()

  assertEquals(calls, ['reload'])
})

test('[contract] config file poller: stop 后不应再触发 onChange', async () => {
  const infos = [
    createFileInfo('2026-05-04T00:00:00.000Z'),
    createFileInfo('2026-05-04T00:00:01.000Z'),
  ]
  let index = 0
  let calls = 0

  const poller = createConfigFilePoller({
    configPath: '/tmp/runtime/config.yml',
    onChange: async () => {
      calls += 1
    },
    statPathImpl: async () => infos[index++]!,
  })

  await poller.poll()
  poller.stop()
  await poller.poll()

  assertEquals(calls, 0)
})

test('[contract] config file poller: 并发 poll 应复用同一轮检查且只触发一次 onChange', async () => {
  const infos = [
    createFileInfo('2026-05-04T00:00:00.000Z'),
    createFileInfo('2026-05-04T00:00:01.000Z'),
  ]
  let index = 0
  let statCalls = 0
  let changeCalls = 0
  let releaseChange: (() => void) | undefined

  const changeGate = new Promise<void>((resolve) => {
    releaseChange = resolve
  })

  const poller = createConfigFilePoller({
    configPath: '/tmp/runtime/config.yml',
    onChange: async () => {
      changeCalls += 1
      await changeGate
    },
    statPathImpl: async () => {
      statCalls += 1
      return infos[index++] ?? infos[infos.length - 1]!
    },
  })

  await poller.poll()
  const first = poller.poll()
  const second = poller.poll()
  releaseChange?.()
  await Promise.all([first, second])

  assertEquals(statCalls, 2)
  assertEquals(changeCalls, 1)
})

test('[contract] config file poller: 创建后应立即采样一次基线', async () => {
  let statCalls = 0
  let intervalCallback: (() => void) | undefined

  const poller = createConfigFilePoller({
    configPath: '/tmp/runtime/config.yml',
    onChange: async () => {},
    statPathImpl: async () => {
      statCalls += 1
      return createFileInfo('2026-05-04T00:00:00.000Z')
    },
    setIntervalImpl: (callback) => {
      intervalCallback = callback
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    clearIntervalImpl: () => {},
  })

  await Promise.resolve()
  await Promise.resolve()
  poller.stop()

  assertEquals(typeof intervalCallback, 'function')
  assertEquals(statCalls, 1)
})

test('[contract] config file poller: 定时回调中的失败不应向外抛出未处理 rejection', async () => {
  let intervalCallback: (() => void) | undefined

  const poller = createConfigFilePoller({
    configPath: '/tmp/runtime/config.yml',
    onChange: async () => {
      throw new Error('reload failed')
    },
    statPathImpl: async () => createFileInfo('2026-05-04T00:00:00.000Z'),
    setIntervalImpl: (callback) => {
      intervalCallback = callback
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    clearIntervalImpl: () => {},
  })

  await Promise.resolve()
  await Promise.resolve()
  intervalCallback?.()
  await Promise.resolve()
  await Promise.resolve()
  poller.stop()

  assertEquals(typeof intervalCallback, 'function')
})

test('[contract] config file poller: stop 后 in-flight poll 完成也不应触发 onChange', async () => {
  let releaseStat: (() => void) | undefined
  let calls = 0
  let baselineRead = false

  const statGate = new Promise<void>((resolve) => {
    releaseStat = resolve
  })

  const poller = createConfigFilePoller({
    configPath: '/tmp/runtime/config.yml',
    onChange: async () => {
      calls += 1
    },
    statPathImpl: async () => {
      if (!baselineRead) {
        baselineRead = true
        return createFileInfo('2026-05-04T00:00:00.000Z')
      }
      await statGate
      return createFileInfo('2026-05-04T00:00:01.000Z')
    },
    setIntervalImpl: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearIntervalImpl: () => {},
  })

  await Promise.resolve()
  await Promise.resolve()
  const pending = poller.poll()
  poller.stop()
  releaseStat?.()
  await pending

  assertEquals(calls, 0)
})
