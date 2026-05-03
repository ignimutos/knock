import { assertEquals, assertRejects, assertStringIncludes } from '../../testing/assert.ts'
import { parse as parseYaml } from 'yaml'
import {
  deleteDeliveryConfig,
  upsertDeliveryConfig,
  updateGlobalConfig,
} from './config_management.ts'
import { setConfigReloadRequester } from './config_reload_signal.ts'
import { readTextFile } from '../../platform/fs.ts'
import { test } from '../../testing/test_api.ts'
import { withEnv, withRuntimeHarness, writeRuntimeFile } from '../../testing/test_helpers.ts'

async function withRuntimeDir(configYml: string, fn: (runtimeDir: string) => Promise<void>) {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(runtimeDir, 'config.yml', configYml)
    await withEnv({ KNOCK_RUNTIME_DIR: runtimeDir }, async () => {
      await fn(runtimeDir)
    })
  })
}

const CONFIG_YML = `language: en-US\ntimezone: UTC\ntimestampFormat: yyyy-MM-dd HH:mm:ss\nsqlite:\n  path: facts.db\nlogging:\n  level: info\ndeliveries:\n  local:\n    file:\n      path: outputs/releases.md\n      content: '{{ entry.title }}'\nsources:\n  rust:\n    enabled: true\n    http:\n      url: https://example.com/feed.xml\n    syndication: {}\n    deliveries:\n      local: {}\n`

const SECRET_SENTINEL = '__KNOCK_SECRET_UNCHANGED__'

test('[contract] config management: updateGlobalConfig 应写回 global 子树', async () => {
  await withRuntimeDir(CONFIG_YML, async (runtimeDir) => {
    const result = await updateGlobalConfig({
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
      timestampFormat: 'yyyy/MM/dd HH:mm:ss',
      sqliteMode: 'json',
      sqliteJson:
        '{"path":"knock.db","busyTimeout":"5s","journalMode":"WAL","retention":{"maxAge":"7d","maxEntriesPerSource":10,"vacuum":"off"}}',
      loggingMode: 'json',
      loggingJson: '{"level":"debug","sinks":{}}',
      aiMode: 'json',
      aiJson: '',
    })

    assertEquals(result.message, 'global 配置已保存')
    const nextConfig = parseYaml(await readTextFile(`${runtimeDir}/config.yml`)) as {
      language?: string
      timezone?: string
      timestampFormat?: string
      logging?: { level?: string }
    }
    assertEquals(nextConfig.language, 'zh-CN')
    assertEquals(nextConfig.timezone, 'Asia/Shanghai')
    assertEquals(nextConfig.timestampFormat, 'yyyy/MM/dd HH:mm:ss')
    assertEquals(nextConfig.logging?.level, 'debug')
  })
})

test('[contract] config management: updateGlobalConfig 保存成功后应请求 web_save reload', async () => {
  const triggers: string[] = []
  setConfigReloadRequester(async (trigger) => {
    triggers.push(trigger)
  })

  try {
    await withRuntimeDir(CONFIG_YML, async () => {
      await updateGlobalConfig({
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
        timestampFormat: 'yyyy/MM/dd HH:mm:ss',
        sqliteMode: 'json',
        sqliteJson:
          '{"path":"knock.db","busyTimeout":"5s","journalMode":"WAL","retention":{"maxAge":"7d","maxEntriesPerSource":10,"vacuum":"off"}}',
        loggingMode: 'json',
        loggingJson: '{"level":"debug","sinks":{}}',
        aiMode: 'json',
        aiJson: '',
      })
    })
  } finally {
    setConfigReloadRequester(undefined)
  }

  assertEquals(triggers, ['web_save'])
})

test('[contract] config management: reload 失败不应让已成功写盘的 updateGlobalConfig 失败', async () => {
  setConfigReloadRequester(async () => {
    throw new Error('reload failed')
  })

  try {
    await withRuntimeDir(CONFIG_YML, async (runtimeDir) => {
      const result = await updateGlobalConfig({
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
        timestampFormat: 'yyyy/MM/dd HH:mm:ss',
        sqliteMode: 'json',
        sqliteJson:
          '{"path":"knock.db","busyTimeout":"5s","journalMode":"WAL","retention":{"maxAge":"7d","maxEntriesPerSource":10,"vacuum":"off"}}',
        loggingMode: 'json',
        loggingJson: '{"level":"debug","sinks":{}}',
        aiMode: 'json',
        aiJson: '',
      })

      assertEquals(result.message, 'global 配置已保存')
      const nextConfig = parseYaml(await readTextFile(`${runtimeDir}/config.yml`)) as {
        language?: string
      }
      assertEquals(nextConfig.language, 'zh-CN')
    })
  } finally {
    setConfigReloadRequester(undefined)
  }
})

test('[contract] config management: updateGlobalConfig 不应等待 web_save reload 完成', async () => {
  let releaseReload: (() => void) | undefined
  const reloadGate = new Promise<void>((resolve) => {
    releaseReload = resolve
  })

  setConfigReloadRequester(async () => {
    await reloadGate
  })

  try {
    await withRuntimeDir(CONFIG_YML, async (runtimeDir) => {
      const pending = updateGlobalConfig({
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
        timestampFormat: 'yyyy/MM/dd HH:mm:ss',
        sqliteMode: 'json',
        sqliteJson:
          '{"path":"knock.db","busyTimeout":"5s","journalMode":"WAL","retention":{"maxAge":"7d","maxEntriesPerSource":10,"vacuum":"off"}}',
        loggingMode: 'json',
        loggingJson: '{"level":"debug","sinks":{}}',
        aiMode: 'json',
        aiJson: '',
      })

      const result = await Promise.race([
        pending.then((value) => ({ kind: 'resolved' as const, value })),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'timeout' }), 200)
        }),
      ])

      assertEquals(result.kind, 'resolved')
      const nextConfig = parseYaml(await readTextFile(`${runtimeDir}/config.yml`)) as {
        language?: string
      }
      assertEquals(nextConfig.language, 'zh-CN')
      releaseReload?.()
      await pending
    })
  } finally {
    setConfigReloadRequester(undefined)
  }
})

test('[contract] config management: updateGlobalConfig 结构化保存应保留合法未编辑键', async () => {
  await withRuntimeDir(
    `language: en-US\ntimezone: UTC\ntimestampFormat: yyyy-MM-dd HH:mm:ss\nsqlite:\n  path: facts.db\n  busyTimeout: 5s\n  journalMode: WAL\n  retention:\n    maxAge: 7d\n    maxEntriesPerSource: 20\n    vacuum: off\nlogging:\n  level: info\n  sinks:\n    console:\n      type: console\n      format: pretty\n    file:\n      type: file\n      format: jsonl\n      path: logs/app.jsonl\n      rotation:\n        type: size\n        maxSize: 10m\n        maxFiles: 3\n`,
    async (runtimeDir) => {
      await updateGlobalConfig({
        language: 'en-US',
        timezone: 'Asia/Shanghai',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        sqliteMode: 'structured',
        sqlitePath: 'knock.db',
        sqliteBusyTimeout: '5s',
        sqliteJournalMode: 'WAL',
        sqliteRetentionMaxAge: '7d',
        sqliteRetentionMaxEntriesPerSource: 20,
        sqliteRetentionVacuum: 'off',
        loggingMode: 'structured',
        loggingLevel: 'debug',
        loggingConsoleEnabled: true,
        loggingConsoleFormat: 'pretty',
        loggingFileEnabled: true,
        loggingFilePath: 'logs/app.jsonl',
      })

      const nextConfig = parseYaml(await readTextFile(`${runtimeDir}/config.yml`)) as {
        sqlite?: { path?: string; retention?: { maxEntriesPerSource?: number } }
        logging?: {
          level?: string
          sinks?: { file?: { rotation?: { maxSize?: string; maxFiles?: number } } }
        }
      }
      assertEquals(nextConfig.sqlite?.path, 'knock.db')
      assertEquals(nextConfig.sqlite?.retention?.maxEntriesPerSource, 20)
      assertEquals(nextConfig.logging?.level, 'debug')
      assertEquals(nextConfig.logging?.sinks?.file?.rotation?.maxSize, '10m')
      assertEquals(nextConfig.logging?.sinks?.file?.rotation?.maxFiles, 3)
    },
  )
})

test('[contract] config management: upsertDeliveryConfig 应写回 canonical delivery 子树', async () => {
  await withRuntimeDir(CONFIG_YML, async (runtimeDir) => {
    const result = await upsertDeliveryConfig({
      deliveryId: 'local',
      enabled: false,
      kind: 'file',
      configMode: 'json',
      configJson: '{"path":"outputs/archive.md","content":"{{ entry.link }}"}',
    })

    assertEquals(result.message, 'delivery local 配置已保存')
    const nextConfig = parseYaml(await readTextFile(`${runtimeDir}/config.yml`)) as {
      deliveries?: Record<string, { enabled?: boolean; file?: { path?: string; content?: string } }>
    }
    assertEquals(nextConfig.deliveries?.local?.enabled, false)
    assertEquals(nextConfig.deliveries?.local?.file?.path, 'outputs/archive.md')
    assertEquals(nextConfig.deliveries?.local?.file?.content, '{{ entry.link }}')
  })
})

test('[contract] config management: upsertDeliveryConfig 结构化保存应保留合法未编辑键', async () => {
  await withRuntimeDir(
    `deliveries:\n  local:\n    file:\n      path: outputs/releases.md\n      content: '{{ entry.title }}'\n      rotation:\n        enabled: true\n        size: 10m\n        backups: 3\n`,
    async (runtimeDir) => {
      await upsertDeliveryConfig({
        deliveryId: 'local',
        enabled: true,
        kind: 'file',
        configMode: 'structured',
        configJson: '',
        filePath: 'outputs/archive.md',
        fileContent: '{{ entry.link }}',
      })

      const nextConfig = parseYaml(await readTextFile(`${runtimeDir}/config.yml`)) as {
        deliveries?: Record<
          string,
          {
            file?: {
              path?: string
              content?: string
              rotation?: { size?: string; backups?: number }
            }
          }
        >
      }
      assertEquals(nextConfig.deliveries?.local?.file?.path, 'outputs/archive.md')
      assertEquals(nextConfig.deliveries?.local?.file?.content, '{{ entry.link }}')
      assertEquals(nextConfig.deliveries?.local?.file?.rotation?.size, '10m')
      assertEquals(nextConfig.deliveries?.local?.file?.rotation?.backups, 3)
    },
  )
})

test('[contract] config management: deleteDeliveryConfig 应删除未被引用的 canonical delivery', async () => {
  await withRuntimeDir(
    `language: en-US\ndeliveries:\n  local:\n    file:\n      path: outputs/releases.md\n      content: '{{ entry.title }}'\n`,
    async (runtimeDir) => {
      const result = await deleteDeliveryConfig({
        deliveryId: 'local',
      })

      assertEquals(result.message, 'delivery local 已删除')
      const nextConfig = parseYaml(await readTextFile(`${runtimeDir}/config.yml`)) as {
        deliveries?: Record<string, unknown>
      }
      assertEquals(nextConfig.deliveries, undefined)
    },
  )
})

test('[contract] config management: deleteDeliveryConfig 应拒绝删除仍被 source 引用的 delivery', async () => {
  await withRuntimeDir(CONFIG_YML, async () => {
    const error = await assertRejects(() => deleteDeliveryConfig({ deliveryId: 'local' }), Error)

    assertStringIncludes(error.message, '仍被 source 引用')
    assertStringIncludes(error.message, 'rust')
  })
})

test('[contract] config management: 结构化保存应保留未修改的 secret', async () => {
  await withRuntimeDir(
    `deliveries:\n  mailer:\n    enabled: true\n    email:\n      smtp:\n        host: smtp.example.com\n        port: 587\n        security: starttls\n        auth:\n          username: bot\n          password: real-secret\n      message:\n        from: noreply@example.com\n        to:\n          - ops@example.com\n        subject: hello\n        text: body\n`,
    async (runtimeDir) => {
      await upsertDeliveryConfig({
        deliveryId: 'mailer',
        enabled: true,
        kind: 'email',
        configMode: 'structured',
        configJson: '',
        emailSmtpHost: 'smtp.example.com',
        emailSmtpPort: 587,
        emailSmtpSecurity: 'starttls',
        emailSmtpAuthUsername: 'bot',
        emailSmtpAuthPassword: SECRET_SENTINEL,
        emailMessageFrom: 'noreply@example.com',
        emailMessageTo: ['ops@example.com'],
        emailMessageSubject: 'updated',
        emailMessageText: 'body',
      })

      const nextConfig = parseYaml(await readTextFile(`${runtimeDir}/config.yml`)) as {
        deliveries?: Record<string, { email?: { smtp?: { auth?: { password?: string } } } }>
      }
      assertEquals(nextConfig.deliveries?.mailer?.email?.smtp?.auth?.password, 'real-secret')
    },
  )
})

test('[contract] config management: 应拒绝绝对 sqlite path', async () => {
  await withRuntimeDir(CONFIG_YML, async () => {
    const error = await assertRejects(
      () =>
        updateGlobalConfig({
          language: 'en-US',
          timezone: 'UTC',
          timestampFormat: 'yyyy-MM-dd HH:mm:ss',
          sqliteMode: 'structured',
          sqlitePath: '/tmp/knock.db',
          loggingMode: 'json',
          loggingJson: '',
          aiMode: 'json',
          aiJson: '',
        }),
      Error,
    )

    assertStringIncludes(error.message, 'sqlite.path 必须是 runtime 内相对路径')
  })
})

test('[contract] config management: 应拒绝逃逸 runtime 的 delivery file path', async () => {
  await withRuntimeDir(CONFIG_YML, async () => {
    const error = await assertRejects(
      () =>
        upsertDeliveryConfig({
          deliveryId: 'local',
          enabled: true,
          kind: 'file',
          configMode: 'structured',
          configJson: '',
          filePath: '../escape.txt',
          fileContent: '{{ entry.title }}',
        }),
      Error,
    )

    assertStringIncludes(error.message, 'deliveries.*.file.path 不能逃逸 runtime 目录')
  })
})
