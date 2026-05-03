import { assertEquals } from '../testing/assert.ts'
import { test } from '../testing/test_api.ts'
import { classifyReloadTransition } from './config_reload_policy.ts'
import type { AppConfigResolved } from './types.ts'

function createConfig(sqlitePath: string): AppConfigResolved {
  return {
    runtimeDir: '/tmp/runtime',
    language: 'zh-CN',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    sqlite: {
      path: sqlitePath,
      busyTimeout: '5s',
      journalMode: 'WAL',
      retention: {
        maxAge: '7d',
        maxEntriesPerSource: 100,
        vacuum: 'off',
      },
    },
    deliveries: [],
    sources: [],
    logging: {
      level: 'info',
      sinks: {},
    },
  }
}

test('[contract] reload policy: sqlite 未变化时应允许热重载', () => {
  const decision = classifyReloadTransition(createConfig('facts.db'), createConfig('facts.db'))
  assertEquals(decision, { kind: 'hot_reload' })
})

test('[contract] reload policy: sqlite.path 变化时应要求重启', () => {
  const decision = classifyReloadTransition(createConfig('facts.db'), createConfig('next.db'))
  assertEquals(decision, { kind: 'requires_restart', reason: 'sqlite' })
})

test('[contract] reload policy: sqlite 新增未知字段时也应要求重启', () => {
  const previous = createConfig('facts.db')
  const next = createConfig('facts.db')
  ;(next.sqlite as unknown as Record<string, unknown>).futureField = 'x'

  const decision = classifyReloadTransition(previous, next)

  assertEquals(decision, { kind: 'requires_restart', reason: 'sqlite' })
})
