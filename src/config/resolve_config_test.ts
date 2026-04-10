import { assertEquals, assertNotStrictEquals } from '@std/assert'
import { resolveConfig } from './resolve_config.ts'
import { validateConfig } from './validate_config.ts'
import type { AppConfigInput } from './schema.ts'

Deno.test(
  'resolveConfig: sources.<id>.deliveries 应展开成 ResolvedDeliveryConfig[] 并保留 content',
  () => {
    const input: AppConfigInput = {
      runtimeDir: '/tmp/runtime',
      deliveries: {
        archive: {
          file: {
            path: 'a.md',
            content: '{{ entry.title }}',
          },
        },
        webhook: {
          push: {
            http: {
              method: 'POST',
              url: 'https://example.com/hook',
            },
          },
        },
      },
      sources: {
        s1: {
          http: {
            url: 'https://example.com/feed.xml',
          },
          deliveries: ['archive', 'webhook'],
        },
      },
    }

    const resolved = resolveConfig(validateConfig(input))
    assertEquals(resolved.deliveries.length, 2)
    assertEquals(resolved.sources[0].deliveries.length, 2)
    assertEquals(resolved.sources[0].deliveries[0].file?.content, '{{ entry.title }}')
    assertEquals(resolved.sources[0].deliveries[1].push?.http.url, 'https://example.com/hook')
  },
)

Deno.test('resolveConfig: 默认值与路径解析仍应成立', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      archive: {
        file: {
          path: 'outputs/feed.md',
          content: '{{ entry.title }}',
          rotation: {
            size: '10m',
            backups: 3,
          },
        },
      },
    },
    sources: {
      s1: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: ['archive'],
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.sqlite.path, '/tmp/runtime/knock.db')
  assertEquals(resolved.logging.level, 'info')
  assertEquals(resolved.logging.format, 'json')
  assertEquals(resolved.sources[0].enabled, true)
  assertEquals(resolved.sources[0].syndication, {})
  assertEquals(resolved.sources[0].xquery, undefined)
  assertEquals(resolved.sources[0].deliveries[0].file?.path, '/tmp/runtime/outputs/feed.md')
  assertEquals(resolved.sources[0].deliveries[0].file?.rotation?.enabled, false)
  assertEquals(resolved.sources[0].deliveries[0].file?.rotation?.size, '10m')
  assertEquals(resolved.sources[0].deliveries[0].file?.rotation?.backups, 3)
})

Deno.test('resolveConfig: push.http transport 与 push.request 应进入 resolved 层', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
            timeout: '10s',
            proxy: 'http://proxy.internal:8080',
            headers: {
              Authorization: 'Bearer token',
            },
          },
          request: {
            type: 'body',
            payload: {
              text: '{{ entry.title }}',
            },
          },
          response: {
            predicate: '{{ ok }}',
            message: '{{ body.error }}',
          },
        },
      },
    },
    sources: {
      rust: {
        http: {
          url: 'https://example.com/feed.xml',
          timeout: '5s',
          proxy: 'socks5://127.0.0.1:1080',
          headers: {
            'User-Agent': 'knock-test',
          },
        },
        deliveries: ['webhook'],
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))

  assertEquals(resolved.deliveries.length, 1)
  assertEquals(resolved.deliveries[0].push?.http.timeout, '10s')
  assertEquals(resolved.deliveries[0].push?.http.proxy, 'http://proxy.internal:8080')
  assertEquals(resolved.deliveries[0].push?.http.headers?.Authorization, 'Bearer token')
  assertEquals(resolved.deliveries[0].push?.http.method, 'POST')
  assertEquals(resolved.deliveries[0].push?.http.url, 'https://example.com/hook')
  assertEquals(resolved.deliveries[0].push?.request.type, 'body')
  assertEquals(resolved.deliveries[0].push?.request.payload, {
    text: '{{ entry.title }}',
  })
  assertEquals(resolved.deliveries[0].push?.response?.predicate, '{{ ok }}')

  assertEquals(resolved.sources[0].http!.url, 'https://example.com/feed.xml')
  assertEquals(resolved.sources[0].http!.timeout, '5s')
  assertEquals(resolved.sources[0].http!.proxy, 'socks5://127.0.0.1:1080')
  assertEquals(resolved.sources[0].http!.headers?.['User-Agent'], 'knock-test')
  assertEquals(resolved.sources[0].deliveries[0].push?.http.url, 'https://example.com/hook')
  assertEquals(resolved.sources[0].deliveries[0].push?.request.type, 'body')
})

Deno.test(
  'resolveConfig: source.http 与 push.request block 应 clone，并保留 source.http.url',
  () => {
    const input: AppConfigInput = {
      runtimeDir: '/tmp/runtime',
      deliveries: {
        webhook: {
          push: {
            http: {
              method: 'POST',
              url: 'https://example.com/hook',
              timeout: '10s',
              proxy: 'http://proxy.internal:8080',
              headers: {
                Authorization: 'Bearer token',
              },
            },
            request: {
              type: 'body',
              payload: {
                text: '{{ entry.title }}',
              },
            },
          },
        },
      },
      sources: {
        feed: {
          http: {
            url: 'https://example.com/feed.xml',
            timeout: '5s',
            headers: {
              'User-Agent': 'knock-test',
            },
          },
          deliveries: ['webhook'],
        },
      },
    }

    const resolved = resolveConfig(validateConfig(input))
    const resolvedSource = resolved.sources[0]
    const resolvedDelivery = resolved.deliveries[0]
    const sourceDelivery = resolvedSource.deliveries[0]

    assertEquals(resolvedSource.http!.url, 'https://example.com/feed.xml')
    assertEquals(resolvedSource.http!.timeout, '5s')
    assertEquals(resolvedDelivery.push?.http.timeout, '10s')
    assertEquals(sourceDelivery.push?.http.proxy, 'http://proxy.internal:8080')
    assertNotStrictEquals(resolvedDelivery.push?.http, sourceDelivery.push?.http)
    assertNotStrictEquals(resolvedDelivery.push?.http.headers, sourceDelivery.push?.http.headers)
    assertNotStrictEquals(resolvedDelivery.push?.request, sourceDelivery.push?.request)
  },
)

Deno.test('resolveConfig: 缺省 deliveries 时应收口为空数组', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.deliveries, [])
})

Deno.test('resolveConfig: source.byparr 应进入 resolved 层并保持字段', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      news: {
        byparr: {
          endpoint: 'http://byparr:8191/v1',
          cmd: 'request.get',
          url: 'https://example.com/news',
          maxTimeout: '90s',
          proxy: 'http://user:pass@127.0.0.1:8080',
        },
        deliveries: [],
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.sources[0].http, undefined)
  assertEquals(resolved.sources[0].byparr?.endpoint, 'http://byparr:8191/v1')
  assertEquals(resolved.sources[0].byparr?.cmd, 'request.get')
  assertEquals(resolved.sources[0].byparr?.url, 'https://example.com/news')
  assertEquals(resolved.sources[0].byparr?.maxTimeout, '90s')
  assertEquals(resolved.sources[0].byparr?.proxy, 'http://user:pass@127.0.0.1:8080')
})

Deno.test('resolveConfig: 缺省全局块时应收口为空数组、默认日志配置与默认 sqlite 配置', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.deliveries, [])
  assertEquals(resolved.sources, [])
  assertEquals(resolved.sqlite, {
    path: '/tmp/runtime/knock.db',
    busyTimeout: '5s',
    journalMode: 'WAL',
    retention: {
      maxAge: '180d',
      maxEntriesPerSource: 1000,
      vacuum: 'off',
    },
  })
  assertEquals(resolved.logging, {
    level: 'info',
    format: 'json',
    sinks: {
      console: {
        type: 'console',
      },
    },
  })
})

Deno.test('resolveConfig: source 未配置 enabled 时默认启用', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      s1: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: [],
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.sources[0].enabled, true)
})

Deno.test('resolveConfig: source 未显式配置 parser 时默认补为 syndication', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      s1: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: [],
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.sources[0].syndication, {})
  assertEquals(resolved.sources[0].xquery, undefined)
})

Deno.test('resolveConfig: source 应保留 schedule 配置', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      s1: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        schedule: '*/5 * * * *',
        deliveries: [],
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.sources[0].schedule, '*/5 * * * *')
})

Deno.test('resolveConfig: source 显式 enabled=false 时应保留禁用状态', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      s1: {
        enabled: false,
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: [],
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.sources[0].enabled, false)
})

Deno.test('resolveConfig: 未配置 language 时应补系统语言，失败时回退 zh-CN', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.language?.length ? true : false, true)
})

Deno.test('resolveConfig: 缺省时应补系统时区与默认时间格式', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
  assertEquals(resolved.timestampFormat, 'yyyy-MM-dd HH:mm:ss')
})

Deno.test('resolveConfig: 应按 source deliveries 展开独立 resolved delivery', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      archive: {
        file: { path: 'a.md', content: '{{ entry.title }}' },
      },
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
          },
        },
      },
    },
    sources: {
      s1: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: ['archive', 'archive', 'webhook'],
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.deliveries.length, 2)
  assertEquals(resolved.sources.length, 1)
  assertEquals(resolved.sources[0].deliveries.length, 3)
  assertEquals(resolved.sources[0].deliveries[0].id, 's1__archive__0')
  assertEquals(resolved.sources[0].deliveries[0].file?.content, '{{ entry.title }}')
  assertEquals(resolved.sources[0].deliveries[1].id, 's1__archive__1')
  assertEquals(resolved.sources[0].deliveries[1].file?.content, '{{ entry.title }}')
  assertEquals(resolved.sources[0].deliveries[2].id, 's1__webhook__2')
  assertEquals(resolved.sources[0].deliveries[2].push?.http.url, 'https://example.com/hook')
})

Deno.test('resolveConfig: delivery.file.rotation 未显式 enabled 时默认 false', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      archive: {
        file: {
          path: 'a.md',
          content: '{{ entry.title }}',
          rotation: {
            size: '10m',
            backups: 3,
          },
        },
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.deliveries[0].file?.path, '/tmp/runtime/a.md')
  assertEquals(resolved.deliveries[0].file?.rotation?.enabled, false)
  assertEquals(resolved.deliveries[0].file?.rotation?.size, '10m')
  assertEquals(resolved.deliveries[0].file?.rotation?.backups, 3)
})

Deno.test('resolveConfig: delivery.file.path 绝对路径应保持原样', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      archive: {
        file: {
          path: '/var/lib/knock/archive.md',
          content: '{{ entry.title }}',
        },
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.deliveries[0].file?.path, '/var/lib/knock/archive.md')
})

Deno.test('resolveConfig: sqlite.path 相对路径应解析为基于 runtimeDir 的绝对路径', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sqlite: {
      path: 'data/custom.db',
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.sqlite.path, '/tmp/runtime/data/custom.db')
})

Deno.test('resolveConfig: email delivery 应进入 resolved 层并按 source 展开 clone', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      release_email: {
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 465,
            security: 'implicit',
            auth: {
              username: 'user',
              password: 'pass',
            },
          },
          message: {
            from: '{{ source.id }}@example.com',
            to: ['team+{{ entry.id }}@example.com'],
            subject: '[{{ source.id }}] {{ entry.title }}',
            text: '{{ entry.title }}',
            headers: {
              'X-Knock-Source': '{{ source.id }}',
            },
          },
        },
      },
    },
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: ['release_email'],
      },
    },
  } as const satisfies AppConfigInput

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.deliveries[0].email?.smtp.security, 'implicit')
  assertEquals(resolved.sources[0].deliveries[0].id, 'feed__release_email__0')
  assertEquals(
    resolved.sources[0].deliveries[0].email?.message.headers?.['X-Knock-Source'],
    '{{ source.id }}',
  )
  assertNotStrictEquals(resolved.deliveries[0].email, resolved.sources[0].deliveries[0].email)
  assertNotStrictEquals(
    resolved.deliveries[0].email?.message,
    resolved.sources[0].deliveries[0].email?.message,
  )
})

Deno.test('resolveConfig: sqlite.path 绝对路径应保持原样', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sqlite: {
      path: '/var/lib/knock/custom.db',
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(resolved.sqlite.path, '/var/lib/knock/custom.db')
})

Deno.test('resolveConfig: AI defaultModel 缺省时按 provider 与 models 声明顺序选第一个模型', () => {
  const resolved = resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      ai: {
        providers: {
          second: {
            type: 'anthropic',
            models: {
              sonnet: {
                model: 'claude-3-7-sonnet-latest',
              },
            },
          },
          first: {
            type: 'openai',
            models: {
              mini: {
                model: 'gpt-4o-mini',
              },
              full: {
                model: 'gpt-4o',
              },
            },
          },
        },
      },
    } as AppConfigInput),
  )

  assertEquals(resolved.ai?.defaultModel?.providerId, 'second')
  assertEquals(resolved.ai?.defaultModel?.modelId, 'sonnet')
  assertEquals(resolved.ai?.defaultModel?.ref, 'second/sonnet')
})

Deno.test('resolveConfig: 裸 modelRef 与 providerId/modelId 都应可解析', () => {
  const resolved = resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      ai: {
        defaultModel: 'mini',
        providers: {
          openai_main: {
            type: 'openai',
            models: {
              mini: {
                model: 'gpt-4o-mini',
              },
            },
          },
        },
      },
    } as AppConfigInput),
  )

  assertEquals(resolved.ai?.defaultModel?.providerId, 'openai_main')
  assertEquals(resolved.ai?.defaultModel?.modelId, 'mini')
  assertEquals(resolved.ai?.defaultModel?.ref, 'openai_main/mini')
  assertEquals(resolved.ai?.modelRefs['mini']?.ref, 'openai_main/mini')
  assertEquals(resolved.ai?.modelRefs['openai_main/mini']?.ref, 'openai_main/mini')
})

Deno.test('resolveConfig: variant options 应与 model options 做浅合并', () => {
  const resolved = resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      ai: {
        providers: {
          openai_main: {
            type: 'openai',
            models: {
              mini: {
                model: 'gpt-4o-mini',
                temperature: 0.2,
                options: {
                  reasoningEffort: 'low',
                  json: false,
                },
                variants: {
                  creative: {
                    temperature: 0.8,
                    options: {
                      json: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as AppConfigInput),
  )

  assertEquals(resolved.ai?.providers[0].models[0].variants.creative.temperature, 0.8)
  assertEquals(resolved.ai?.providers[0].models[0].variants.creative.options, {
    reasoningEffort: 'low',
    json: true,
  })
})

Deno.test('resolveConfig: openai model options 应保留到 resolved 层供 runtime 消费', () => {
  const resolved = resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      ai: {
        providers: {
          openai_main: {
            type: 'openai',
            models: {
              mini: {
                model: 'gpt-4o-mini',
                options: {
                  reasoningEffort: 'low',
                  json: true,
                },
              },
            },
          },
        },
      },
    } as unknown as AppConfigInput),
  )

  assertEquals(resolved.ai?.providers[0].models[0].options, {
    reasoningEffort: 'low',
    json: true,
  })
})

Deno.test('resolveConfig: 热门模型默认表未命中时应回退 provider 默认值', () => {
  const resolved = resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      ai: {
        providers: {
          google: {
            type: 'gemini',
            models: {
              custom: {
                model: 'gemini-custom-preview',
              },
            },
          },
        },
      },
    } as AppConfigInput),
  )

  assertEquals(resolved.ai?.providers[0].models[0].context, 1048576)
  assertEquals(resolved.ai?.providers[0].models[0].maxOutputTokens, 8192)
})

Deno.test('resolveConfig: provider 根层共同字段应进入 resolved，不会被静默忽略', () => {
  const resolved = resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      ai: {
        providers: {
          openai_main: {
            type: 'openai',
            apiKey: '${OPENAI_API_KEY}',
            baseURL: 'https://openai.example.com/v1',
            headers: {
              'X-Trace-Id': 'trace-1',
            },
            options: {
              organization: 'org-demo',
              project: 'proj-demo',
            },
            models: {
              mini: {
                model: 'gpt-4o-mini',
              },
            },
          },
        },
      },
    } as AppConfigInput),
  )

  assertEquals(resolved.ai?.providers[0].apiKey, '${OPENAI_API_KEY}')
  assertEquals(resolved.ai?.providers[0].baseURL, 'https://openai.example.com/v1')
  assertEquals(resolved.ai?.providers[0].headers, {
    'X-Trace-Id': 'trace-1',
  })
  assertEquals(resolved.ai?.providers[0].options, {
    organization: 'org-demo',
    project: 'proj-demo',
  })
})
