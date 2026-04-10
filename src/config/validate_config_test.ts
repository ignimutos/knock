import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { validateConfig } from './validate_config.ts'
import type { AppConfigInput } from './schema.ts'

Deno.test('validateConfig: schema 静态默认值应在校验阶段生效', () => {
  const validated = validateConfig({
    runtimeDir: '/tmp/runtime',
    sqlite: {},
    logging: {},
  })

  assertEquals(validated.timestampFormat, 'yyyy-MM-dd HH:mm:ss')
  assertEquals(validated.sqlite, {
    path: 'knock.db',
    busyTimeout: '5s',
    journalMode: 'WAL',
    retention: {
      maxAge: '180d',
      maxEntriesPerSource: 1000,
      vacuum: 'off',
    },
  })
  assertEquals(validated.logging, {
    level: 'info',
    format: 'json',
    sinks: {
      console: {
        type: 'console',
      },
    },
  })
})

Deno.test('validateConfig: logging.format 支持 pretty', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    logging: {
      format: 'pretty',
    },
  }

  const validated = validateConfig(input)
  assertEquals(validated.logging.format, 'pretty')
})

Deno.test('validateConfig: 新 push.http + push.request + source.http.url shape 应通过', () => {
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
          proxy: 'socks5://127.0.0.1:1080',
          headers: {
            'User-Agent': 'knock-test',
          },
        },
        deliveries: ['webhook'],
      },
    },
  }

  validateConfig(input)
})

Deno.test('validateConfig: push.http.method 与 push.request.type 未配置时应使用默认值', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            url: 'https://example.com/hook',
          },
        },
      },
    },
  }

  const validated = validateConfig(input)
  const push = validated.deliveries.webhook.push
  assertEquals(push?.http.method, 'POST')
  assertEquals(push?.request.type, 'body')
})

Deno.test('validateConfig: push.request 为空对象时也应补全 body 默认值', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            url: 'https://example.com/hook',
          },
          request: {},
        },
      },
    },
  }

  const validated = validateConfig(input)
  assertEquals(validated.deliveries.webhook.push?.request.type, 'body')
})

Deno.test('validateConfig: 旧 delivery.http 应拒绝并指向新路径', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        http: {
          timeout: '10s',
        },
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
          },
          request: {
            type: 'body',
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.http 已废弃，请改用 delivery.webhook.push.http',
  )
})

Deno.test('validateConfig: 旧 push.http.type/payload 或新旧混用应拒绝', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
            type: 'body',
          },
          request: {
            payload: {
              text: 'hello',
            },
          },
        },
      },
    },
  } as unknown as AppConfigInput

  const err = assertThrows(() => validateConfig(input), Error)
  assertStringIncludes(err.message, 'delivery.webhook.push.http.type')
})

Deno.test('validateConfig: push.http.url 为空时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: '   ',
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(() => validateConfig(input), Error, 'delivery.webhook.push.http.url 必填')
})

Deno.test('validateConfig: push.http.url 不支持 Liquid 模板时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: '{{ entry.link }}',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.http.url 配置非法: deliveries.*.push.http.url 不支持 Liquid 模板',
  )
})

Deno.test('validateConfig: push.http.method 非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'TRACE',
            url: 'https://example.com/hook',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.http.method 配置非法: TRACE',
  )
})

Deno.test('validateConfig: GET/HEAD + body payload 应拒绝', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'GET',
            url: 'https://example.com/hook',
          },
          request: {
            type: 'body',
            payload: {
              text: 'hello',
            },
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.request.payload 配置非法: GET/HEAD 请求不允许 body payload',
  )
})

Deno.test('validateConfig: push.http.proxy 协议非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
            proxy: 'ftp://proxy.internal:21',
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.http.proxy 配置非法: ftp://proxy.internal:21',
  )
})

Deno.test('validateConfig: push.http.proxy 格式非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      webhook: {
        push: {
          http: {
            method: 'POST',
            url: 'https://example.com/hook',
            proxy: 'proxy.internal:8080',
          },
        },
      },
    },
  } as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.webhook.push.http.proxy 配置非法: proxy.internal:8080',
  )
})

Deno.test('validateConfig: source.http 与 source.byparr 不能同时存在，且不能同时缺失', () => {
  const bothPresent = {
    runtimeDir: '/tmp/runtime',
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        byparr: {
          endpoint: 'http://byparr:8191/v1',
          url: 'https://example.com/news',
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(bothPresent), Error, 'source.feed 不能同时配置 http 与 byparr')

  const bothMissing = {
    runtimeDir: '/tmp/runtime',
    sources: {
      feed: {
        syndication: {},
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(bothMissing), Error, 'source.feed 必须配置 http 或 byparr')
})

Deno.test('validateConfig: source.byparr 合法配置应通过并使用默认值', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      news: {
        byparr: {
          url: 'https://example.com/news',
          proxy: 'http://user:@127.0.0.1:8080',
        },
        xquery: {
          entry: {
            id: 'string(//article/@id)',
          },
        },
      },
    },
  }

  const validated = validateConfig(input)
  assertEquals(validated.sources.news.byparr?.endpoint, 'http://byparr:8191/v1')
  assertEquals(validated.sources.news.byparr?.cmd, 'request.get')
  assertEquals(validated.sources.news.byparr?.maxTimeout, '60s')
})

Deno.test('validateConfig: source.byparr 关键字段缺失时应报错', () => {
  const missingUrl = {
    runtimeDir: '/tmp/runtime',
    sources: {
      news: {
        byparr: {
          endpoint: 'http://byparr:8191/v1',
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(missingUrl), Error, 'source.news.byparr.url 必填')
})

Deno.test('validateConfig: source.byparr.proxy 协议非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    sources: {
      news: {
        byparr: {
          endpoint: 'http://byparr:8191/v1',
          url: 'https://example.com/news',
          proxy: 'ftp://proxy.internal:21',
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'source.news.byparr.proxy 配置非法: ftp://proxy.internal:21',
  )
})

Deno.test('validateConfig: source.http.proxy 支持带认证信息 URL', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
          proxy: 'http://user:pass@127.0.0.1:8080',
        },
      },
    },
  }

  validateConfig(input)
})

Deno.test('validateConfig: transport key 放在 source 错误层级时应报告完整路径', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    sources: {
      rust: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        timeout: '5s',
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(input), Error, 'source.rust.timeout 配置非法')
})

Deno.test('validateConfig: email.smtp + email.message 合法配置应通过', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      release_email: {
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'starttls',
            auth: {
              username: 'user',
              password: 'pass',
            },
          },
          message: {
            from: '{{ source.id }}@example.com',
            to: ['team+{{ entry.id }}@example.com'],
            cc: ['ops@example.com'],
            bcc: ['audit@example.com'],
            replyTo: ['reply@example.com'],
            subject: '[{{ source.id }}] {{ entry.title }}',
            text: '{{ entry.title }}',
            html: '<p>{{ entry.title }}</p>',
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

  const validated = validateConfig(input)
  assertEquals(validated.deliveries.release_email.email?.smtp.security, 'starttls')
  assertEquals(validated.deliveries.release_email.email?.message.to, [
    'team+{{ entry.id }}@example.com',
  ])
})

Deno.test('validateConfig: delivery 不能同时配置 push 与 email', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      mixed: {
        push: {
          http: {
            url: 'https://example.com/webhook',
          },
        },
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'starttls',
          },
          message: {
            from: 'bot@example.com',
            to: ['team@example.com'],
            subject: 'hello',
            text: 'world',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(() => validateConfig(input), Error, 'delivery 不能同时配置 file、push 与 email')
})

Deno.test('validateConfig: email.message.text 与 html 不能同时缺失', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      release_email: {
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'implicit',
          },
          message: {
            from: 'bot@example.com',
            to: ['team@example.com'],
            subject: 'hello',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.release_email.email.message 必须至少配置 text 或 html',
  )
})

Deno.test('validateConfig: email.smtp.security 非法时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      release_email: {
        email: {
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            security: 'tls',
          },
          message: {
            from: 'bot@example.com',
            to: ['team@example.com'],
            subject: 'hello',
            text: 'world',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'delivery.release_email.email.smtp.security 配置非法: tls',
  )
})

Deno.test('validateConfig: 非法 timezone 时应报错', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    timezone: 'Invalid/Zone',
    sources: {},
  } as AppConfigInput

  assertThrows(() => validateConfig(input), Error, 'timezone 配置非法: Invalid/Zone')
})
