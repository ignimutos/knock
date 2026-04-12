# Delivery Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `sources.<id>.deliveries` 从字符串数组改为 keyed map，使 source 可以按 delivery id 覆写默认消息子树，同时禁止触碰 transport 层字段。

**Architecture:** 保留顶层 `deliveries` 作为 canonical delivery 定义，只在 source 侧增加 typed override map。校验层负责拒绝旧数组 shape、非法 override 字段与 `null`/裸 key；解析层负责按 delivery type 把 source override merge 到 `file.content`、`push.request.payload`、`email.message`。运行时 delivery 抽象不重写，继续消费 merged 后的 resolved delivery。

**Tech Stack:** Deno, TypeScript, zod, @std/yaml

---

## File map

- Modify: `src/config/schema.ts` — 把 `source.deliveries` 改成 keyed map schema，定义 file/push/email override shape，并补充引用校验
- Modify: `src/config/types.ts` — 调整 source input/resolved 类型，补充 source delivery override 的中间表示
- Modify: `src/config/resolve_config.ts` — 按 delivery type merge source override，保持声明顺序生成 resolved deliveries
- Modify: `src/config/validate_config.ts` — 复用现有报错映射，必要时补充 override 相关报错文案
- Modify: `src/config/issue_codes.ts` — 如需新增 issue code，在这里集中维护
- Modify: `src/config/validate_config_test.ts` — 覆盖新 shape、非法字段、裸 key/null、未知 delivery 引用
- Modify: `src/config/resolve_config_test.ts` — 覆盖 keyed map 顺序、deep merge、array replace、transport 不可改
- Modify: `src/config/config_example_test.ts` — 保证 `config.example.yml` 更新后仍能通过 schema
- Modify: `config.example.yml` — 切到 keyed map 写法并展示 file/push/email override 示例
- Modify: `README.md` — 同步新的 source deliveries 配置方式与 breaking 说明
- Optional verify: `src/deliveries/delivery_runtime.ts` / `src/deliveries/delivery_runtime_test.ts` — 确认无需改 runtime；若 merge 后测试暴露问题，再最小调整

## Task 1: 锁定 schema 新 shape

**Files:**

- Modify: `src/config/schema.ts:1040-1185`
- Modify: `src/config/issue_codes.ts`
- Test: `src/config/validate_config_test.ts`

- [ ] **Step 1: 写 failing tests，覆盖 keyed map 基本 shape 与 breaking 边界**

```ts
Deno.test('validateConfig: source.deliveries keyed map 应通过', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      local: {
        file: {
          path: 'feed.md',
          content: '{{ entry.title }}',
        },
      },
      telegram: {
        push: {
          http: {
            url: 'https://example.com/hook',
          },
          request: {
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
        },
        deliveries: {
          local: {},
          telegram: {
            payload: {
              text: 'custom',
            },
          },
        },
      },
    },
  }

  validateConfig(input)
})

Deno.test('validateConfig: source.deliveries 旧字符串数组应拒绝', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      local: {
        file: {
          path: 'feed.md',
          content: '{{ entry.title }}',
        },
      },
    },
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: ['local'],
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'source.feed.deliveries 必须是对象',
  )
})

Deno.test('validateConfig: source.deliveries 裸 key/null 应拒绝', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      local: {
        file: {
          path: 'feed.md',
          content: '{{ entry.title }}',
        },
      },
    },
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: {
          local: null,
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'source.feed.deliveries.local 必须是对象',
  )
})
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `deno task test src/config/validate_config_test.ts`
Expected: FAIL，错误集中在 `sources.*.deliveries` 仍被当作字符串数组

- [ ] **Step 3: 修改 schema，定义 keyed map override shape**

```ts
const sourceFileDeliveryOverrideSchema = z
  .object({
    content: requiredString(),
  })
  .strict()

const sourcePushDeliveryOverrideSchema = z
  .object({
    payload: httpPayloadSchema,
  })
  .strict()

const sourceEmailDeliveryOverrideSchema = z
  .object({
    message: emailMessageSchema.partial(),
  })
  .strict()

const sourceDeliveryOverrideSchema = z.object({}).catchall(z.unknown())

export const sourceSchema = z
  .object({
    name: z.string().optional(),
    enabled: optionalBoolean(),
    schedule: z.string().optional(),
    deliveries: z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .optional(),
    filter: z.string().optional(),
    http: sourceHttpSchema.optional(),
    byparr: byparrSchema.optional(),
    syndication: syndicationSchema.optional(),
    xquery: xquerySchema.optional(),
    push: z.unknown().optional(),
  })
  .strict()
```

实现时不要原样照抄上面最后一段占位式过宽 schema；真正落地时需要：

- `deliveries` 是 `z.record(z.string(), z.object({}).strict().catchall(...))` 的 object map
- 在 app-level reference 校验里根据顶层 delivery type 再细分 override shape
- 对 `null` / 非 object 值给出明确报错

- [ ] **Step 4: 在引用校验中增加 delivery type 对应的 override shape 校验**

```ts
for (const [sourceId, source] of Object.entries(value.sources ?? {})) {
  for (const [deliveryId, override] of Object.entries(
    source.deliveries ?? {},
  )) {
    if (!deliveryIds.has(deliveryId)) {
      ctx.addIssue({
        code: 'custom',
        message: `source.${sourceId}.deliveries 引用了未定义 delivery: ${deliveryId}`,
      })
      continue
    }

    const target = value.deliveries?.[deliveryId]
    const parsed = target?.file
      ? sourceFileDeliveryOverrideSchema.safeParse(override)
      : target?.push
        ? sourcePushDeliveryOverrideSchema.safeParse(override)
        : target?.email
          ? sourceEmailDeliveryOverrideSchema.safeParse(override)
          : undefined

    if (parsed && !parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          path: ['sources', sourceId, 'deliveries', deliveryId, ...issue.path],
          code: 'custom',
          message: issue.message,
        })
      }
    }
  }
}
```

- [ ] **Step 5: 增补非法 transport 字段测试**

```ts
Deno.test('validateConfig: source file override 不允许 path', () => {
  const input = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      local: {
        file: {
          path: 'feed.md',
          content: '{{ entry.title }}',
        },
      },
    },
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: {
          local: {
            path: 'other.md',
          },
        },
      },
    },
  } as unknown as AppConfigInput

  assertThrows(
    () => validateConfig(input),
    Error,
    'source.feed.deliveries.local.path 非法',
  )
})
```

- [ ] **Step 6: 运行测试，确认 schema 通过**

Run: `deno task test src/config/validate_config_test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/config/schema.ts src/config/issue_codes.ts src/config/validate_config_test.ts

git commit -m "feat: validate source delivery overrides"
```

## Task 2: 在 resolved 层合并 source override

**Files:**

- Modify: `src/config/types.ts:106-127`
- Modify: `src/config/resolve_config.ts:122-162,328-349`
- Test: `src/config/resolve_config_test.ts`

- [ ] **Step 1: 写 failing tests，覆盖 keyed map 顺序与 merge 结果**

```ts
Deno.test('resolveConfig: source.deliveries keyed map 顺序应保留', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      first: {
        file: {
          path: 'a.md',
          content: 'A',
        },
      },
      second: {
        file: {
          path: 'b.md',
          content: 'B',
        },
      },
    },
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: {
          second: {},
          first: {},
        },
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(
    resolved.sources[0].deliveries.map((item) => item.id),
    ['feed__second__0', 'feed__first__1'],
  )
})

Deno.test('resolveConfig: file override 应只改 content', () => {
  const input: AppConfigInput = {
    runtimeDir: '/tmp/runtime',
    deliveries: {
      local: {
        file: {
          path: 'a.md',
          content: 'default',
        },
      },
    },
    sources: {
      feed: {
        http: {
          url: 'https://example.com/feed.xml',
        },
        deliveries: {
          local: {
            content: 'custom',
          },
        },
      },
    },
  }

  const resolved = resolveConfig(validateConfig(input))
  assertEquals(
    resolved.sources[0].deliveries[0].file?.path,
    '/tmp/runtime/a.md',
  )
  assertEquals(resolved.sources[0].deliveries[0].file?.content, 'custom')
})
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `deno task test src/config/resolve_config_test.ts`
Expected: FAIL，当前 `resolveSourceDeliveries()` 仍假设 source deliveries 是字符串数组

- [ ] **Step 3: 在 types.ts 中补充 source override 类型**

```ts
export interface SourceFileDeliveryOverride {
  content?: string
}

export interface SourcePushDeliveryOverride {
  payload?: PushRequestConfig['payload']
}

export interface SourceEmailDeliveryOverride {
  message?: Partial<EmailMessageConfig>
}
```

并把 `ResolvedSourceConfig` / 中间 input 类型切到 keyed map 语义。

- [ ] **Step 4: 在 resolve_config.ts 实现 type-specific merge**

```ts
function mergeFileOverride(
  delivery: DeliveryConfig,
  override: SourceFileDeliveryOverride,
): ResolvedDeliveryConfig {
  return {
    id: delivery.id,
    file: delivery.file
      ? {
          ...delivery.file,
          ...(override.content === undefined
            ? {}
            : { content: override.content }),
        }
      : undefined,
  }
}
```

```ts
function deepMergeValue(base: unknown, override: unknown): unknown {
  if (override === undefined) return structuredClone(base)
  if (Array.isArray(override)) return structuredClone(override)
  if (Array.isArray(base)) return structuredClone(override)
  if (
    base &&
    override &&
    typeof base === 'object' &&
    typeof override === 'object'
  ) {
    const merged: Record<string, unknown> = {
      ...(base as Record<string, unknown>),
    }
    for (const [key, value] of Object.entries(
      override as Record<string, unknown>,
    )) {
      merged[key] = deepMergeValue(
        (base as Record<string, unknown>)[key],
        value,
      )
    }
    return merged
  }
  return structuredClone(override)
}
```

```ts
function resolveSourceDeliveries(
  sourceId: string,
  sourceDeliveries: Record<string, Record<string, unknown>>,
  deliveries: DeliveryConfig[],
): ResolvedDeliveryConfig[] {
  const deliveryMap = new Map(
    deliveries.map((delivery) => [delivery.id, delivery]),
  )

  return Object.entries(sourceDeliveries).map(
    ([deliveryId, override], index) => {
      const delivery = deliveryMap.get(deliveryId)
      if (!delivery) {
        throw new Error(
          `source.${sourceId}.deliveries 引用了未定义 delivery: ${deliveryId}`,
        )
      }

      return {
        id: `${sourceId}__${deliveryId}__${index}`,
        file: delivery.file
          ? {
              ...delivery.file,
              ...(override.content === undefined
                ? {}
                : { content: override.content }),
            }
          : undefined,
        push: delivery.push
          ? {
              ...clonePushConfig(delivery.push),
              request: {
                ...clonePushConfig(delivery.push)!.request,
                payload: deepMergeValue(
                  delivery.push.request.payload,
                  override.payload,
                ),
              },
            }
          : undefined,
        email: delivery.email
          ? {
              ...cloneEmailConfig(delivery.email),
              message: deepMergeValue(
                delivery.email.message,
                override.message,
              ) as EmailConfig['message'],
            }
          : undefined,
      }
    },
  )
}
```

实现时注意不要重复调用 `clonePushConfig()`；先 clone 再 patch，避免多次 clone 和潜在不一致。

- [ ] **Step 5: 增补 push/email merge 测试**

```ts
Deno.test(
  'resolveConfig: push override 应 deep merge payload 且数组整体替换',
  () => {
    const input: AppConfigInput = {
      runtimeDir: '/tmp/runtime',
      deliveries: {
        telegram: {
          push: {
            http: {
              url: 'https://example.com/hook',
            },
            request: {
              payload: {
                tags: ['a', 'b'],
                link_preview_options: {
                  is_disabled: true,
                  show_above_text: false,
                },
                text: 'default',
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
          deliveries: {
            telegram: {
              payload: {
                tags: ['c'],
                link_preview_options: {
                  show_above_text: true,
                },
                text: 'custom',
              },
            },
          },
        },
      },
    }

    const resolved = resolveConfig(validateConfig(input))
    assertEquals(resolved.sources[0].deliveries[0].push?.request.payload, {
      tags: ['c'],
      link_preview_options: {
        is_disabled: true,
        show_above_text: true,
      },
      text: 'custom',
    })
  },
)
```

- [ ] **Step 6: 运行测试，确认 resolved 行为通过**

Run: `deno task test src/config/resolve_config_test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/config/types.ts src/config/resolve_config.ts src/config/resolve_config_test.ts

git commit -m "feat: merge source delivery overrides"
```

## Task 3: 同步示例配置与文档

**Files:**

- Modify: `config.example.yml`
- Modify: `README.md`
- Test: `src/config/config_example_test.ts`

- [ ] **Step 1: 写 failing test，锁定新 example shape**

```ts
Deno.test(
  'config.example.yml: sources.deliveries keyed map 应通过当前 schema 校验',
  () => {
    const example = Deno.readTextFileSync(
      new URL('../../config.example.yml', import.meta.url),
    )
    const parsed = parse(example) as Record<string, unknown>
    const validated = validateConfig({
      runtimeDir: '/tmp/knock',
      ...(parsed ?? {}),
    })

    assertEquals(typeof validated.sources.deno.deliveries, 'object')
    assertEquals(Array.isArray(validated.sources.deno.deliveries), false)
  },
)
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `deno task test src/config/config_example_test.ts`
Expected: FAIL，example 仍是旧数组 shape

- [ ] **Step 3: 更新 config.example.yml 到 keyed map**

```yml
sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      local: {}
      telegram_webhook:
        payload:
          text: |
            <b>{{ title }}</b>

            {{ content | to_telegram_html }}

            {{ link }}
      release_email:
        message:
          subject: '[{{ source.id }}] {{ entry.title }}'
```

````

实际更新时确保示例覆盖：

- `local: {}` 这种 no-op
- push `payload` 覆写
- email `message` 覆写

- [ ] **Step 4: 更新 README 中最小示例与配置说明**

```md
`sources.<id>.deliveries` 现在是 keyed map：

```yml
sources:
  deno:
    deliveries:
      local: {}
      telegram_webhook:
        payload:
          text: '{{ title }}'
```

规则：

- file 覆写 `content`
- push 覆写 `payload`
- email 覆写 `message`
- 空 override 使用 `{}`
```

- [ ] **Step 5: 运行示例测试**

Run: `deno task test src/config/config_example_test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add config.example.yml README.md src/config/config_example_test.ts

git commit -m "docs: document source delivery overrides"
```

## Task 4: 跑 scoped 验证并做收尾检查

**Files:**

- Modify: 如测试修复需要，仅限相关文件
- Test: `src/config/validate_config_test.ts`
- Test: `src/config/resolve_config_test.ts`
- Test: `src/config/config_example_test.ts`

- [ ] **Step 1: 跑 config 相关测试**

Run: `deno task test src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/config_example_test.ts`
Expected: PASS

- [ ] **Step 2: 跑 config 目录类型检查**

Run: `deno task check src/config`
Expected: PASS

- [ ] **Step 3: 跑 config 目录 lint 检查**

Run: `deno task lint:check src/config`
Expected: PASS

- [ ] **Step 4: 跑变更文件格式检查**

Run: `deno task fmt:check src/config/schema.ts src/config/types.ts src/config/resolve_config.ts src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/config_example_test.ts README.md config.example.yml docs/superpowers/specs/2026-04-11-delivery-overrides-design.md docs/superpowers/plans/2026-04-11-delivery-overrides.md`
Expected: PASS

- [ ] **Step 5: 若任何验证失败，只做最小修复并重跑对应命令**

```ts
// 例：如果 resolve_config.ts 的 deepMergeValue 返回 unknown 导致类型报错，
// 只在 merge 返回点补局部断言，不额外重构其它 clone/helper。
const mergedMessage = deepMergeValue(
  base.email.message,
  override.message,
) as EmailConfig['message']
```

- [ ] **Step 6: 提交最终验证通过状态**

```bash
git add src/config/schema.ts src/config/types.ts src/config/resolve_config.ts src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/config_example_test.ts README.md config.example.yml docs/superpowers/specs/2026-04-11-delivery-overrides-design.md docs/superpowers/plans/2026-04-11-delivery-overrides.md

git commit -m "refactor: support source delivery overrides"
```
````
