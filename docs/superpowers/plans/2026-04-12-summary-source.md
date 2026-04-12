# Summary Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `summary` source 类型，按自身 `schedule` 聚合指定上游 sources 的最近窗口内容，生成 1 条统一 summary entry，并继续复用现有 filter / delivery / dedupe / state 存储链路。

**Architecture:** 在配置层新增 `summary` source shape，并在 runtime 层引入 summary 专用查询与组装逻辑：窗口前界复用 summary 自身 feed 记录时间作为 checkpoint，窗口内上游数据按 `entries.last_seen_at` 选取、按最新 feed/entry 快照读取，再生成 deterministic 默认 `feed` / `entry` 并允许字段级模板覆写。整体保持现有 `sourceProcessor -> sourceStateStore -> deliveryRuntime` 主链路不变，只为 summary 分支补最小注入点与测试面。

**Tech Stack:** Deno、TypeScript、Zod、SQLite + Drizzle、Croner、liquidjs、现有 AI runtime / content runtime。

---

## File Structure

### Existing files to modify

- `src/config/schema.ts` — 为 `summary` source 增加 schema、互斥校验、source 引用校验、模板字段校验。
- `src/config/types.ts` — 为 resolved source 增加 summary config 类型与 runtime window 元数据承载位。
- `src/config/resolve_config.ts` — 解析 summary source，保留 deliveries / defaults，同时为 summary source 清空 `http` / `byparr` / `syndication` / `xquery` 分支。
- `src/config/capabilities.ts` — 登记 `sources.*.summary.feed.*` 与 `sources.*.summary.entry.*` 的模板能力白名单。
- `src/config/validate_config_test.ts` — summary schema、schedule 必填、引用校验、互斥校验。
- `src/config/resolve_config_test.ts` — summary resolved shape、默认值与 runtime 路径解析。
- `src/config/capabilities_test.ts` — summary feed / entry 能力声明。
- `src/config/load_config_test.ts` — summary 模板中的环境变量展开与 loadConfig 闭环。
- `src/sources/source_runtime.ts` — 为 `fetchAndParseSource()` 新增 summary 分支与新的 parser / observedAt 透传。
- `src/sources/source_runtime_test.ts` — 验证 summary 分支接线与 runtime 日志。
- `src/core/source_processor.ts` — 把 source runtime 透传的 observedAt 传给 state store，并保持现有 filter / delivery 主循环不感知 summary 细节。
- `src/core/source_processor_test.ts` — 验证 observedAt 被写入 store，且 summary 0-entry 分支仍走持久化。
- `src/core/app.ts` — 注入 summary 查询依赖，并在 schedule / immediate 执行时为 summary source 传入 `scheduledAt`。
- `src/core/app_test.ts` — 验证 immediate / scheduled 两条链路的 summary 行为。
- `src/db/source_state_store.ts` — 支持 `persistParsedSource()` 使用外部传入的 observedAt，而不是一律取 `now()`。
- `src/db/source_state_store_test.ts` — 验证 observedAt 覆写 feed / entry 时间戳，并保持普通 source 旧行为不变。
- `config.example.yml` — 增加最小 summary source 示例。
- `README.md` — 记录 summary source 契约、窗口语义、最小模板上下文。
- `src/config/config_example_test.ts` — 验证 `config.example.yml` 中 summary 示例通过当前 schema。

### New files to create

- `src/db/source_state_query.ts` — 只负责读取 summary 所需状态：summary checkpoint、上游 feed 快照、窗口内 entries 快照。
- `src/db/source_state_query_test.ts` — 验证 checkpoint 读取、last_seen 窗口查询、按 source id keyed map 返回。
- `src/sources/summary.ts` — summary source 组装逻辑：checkpoint 读取、窗口计算、上游状态汇总、默认 feed/entry、字段级模板覆写、跳过原因。
- `src/sources/summary_test.ts` — 覆盖首次运行、空窗口、部分上游缺失、默认 feed/entry、模板覆写、显式 AI 调用。

### Responsibilities and boundaries

- `src/db/source_state_query.ts` 只读数据库，不关心模板与 delivery。
- `src/sources/summary.ts` 只负责把 DB 查询结果变成统一 `feedMapped` + `entries`。
- `src/sources/source_runtime.ts` 只做分派：普通 source 走原抓取解析链，summary source 走 summary builder。
- `src/core/source_processor.ts` 不感知 summary 细节，只透传 observedAt 并继续跑现有 filter / delivery 链。

---

### Task 1: 定义 summary 配置契约与 resolved shape

**Files:**

- Modify: `src/config/schema.ts`
- Modify: `src/config/types.ts`
- Modify: `src/config/resolve_config.ts`
- Modify: `src/config/capabilities.ts`
- Test: `src/config/validate_config_test.ts`
- Test: `src/config/resolve_config_test.ts`
- Test: `src/config/capabilities_test.ts`

- [ ] **Step 1: 写 summary schema 的失败测试**

```ts
Deno.test(
  'validateConfig: summary source 应要求 schedule、禁止与抓取型字段并存',
  () => {
    const valid: AppConfigInput = {
      runtimeDir: '/tmp/runtime',
      sources: {
        deno: {
          http: { url: 'https://example.com/feed.xml' },
          syndication: {},
        },
        daily_summary: {
          schedule: '0 0 9 * * *',
          summary: {
            sources: ['deno'],
          },
        },
      },
    }

    validateConfig(valid)

    assertThrows(
      () =>
        validateConfig({
          ...valid,
          sources: {
            ...valid.sources,
            daily_summary: {
              summary: { sources: ['deno'] },
            },
          },
        }),
      Error,
      'source.daily_summary.schedule 必填',
    )

    assertThrows(
      () =>
        validateConfig({
          ...valid,
          sources: {
            ...valid.sources,
            daily_summary: {
              schedule: '0 0 9 * * *',
              http: { url: 'https://example.com/feed.xml' },
              summary: { sources: ['deno'] },
            },
          },
        }),
      Error,
      'source.daily_summary 不能同时配置 summary 与 http',
    )
  },
)
```

- [ ] **Step 2: 写 summary 引用与 capability 的失败测试**

```ts
Deno.test('validateConfig: summary.sources 引用未定义 source 应拒绝', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        sources: {
          daily_summary: {
            schedule: '0 0 9 * * *',
            summary: {
              sources: ['missing'],
            },
          },
        },
      }),
    Error,
    'source.daily_summary.summary.sources[0] 配置非法: 未定义 source missing',
  )
})

Deno.test('capabilities: summary feed / entry 模板路径应已登记', () => {
  assertEquals(
    getConfigFieldCapability('sources.daily.summary.feed.title')?.allowLiquid,
    true,
  )
  assertEquals(
    getConfigFieldCapability('sources.daily.summary.entry.content')
      ?.allowLiquid,
    true,
  )
})
```

- [ ] **Step 3: 运行配置层测试，确认当前失败**

Run:
`deno task test src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/capabilities_test.ts`

Expected: FAIL，报 `summary` 未定义、互斥/引用校验缺失或 capability 未登记。

- [ ] **Step 4: 实现 summary schema 与类型**

```ts
const summaryTemplateFeedSchema = z
  .object({
    title: createTemplateStringSchema('sources.*.summary.feed.title', {
      required: false,
    }),
    link: createTemplateStringSchema('sources.*.summary.feed.link', {
      required: false,
    }),
    description: createTemplateStringSchema(
      'sources.*.summary.feed.description',
      { required: false },
    ),
    generator: createTemplateStringSchema('sources.*.summary.feed.generator', {
      required: false,
    }),
    language: createTemplateStringSchema('sources.*.summary.feed.language', {
      required: false,
    }),
    published: createTemplateStringSchema('sources.*.summary.feed.published', {
      required: false,
    }),
  })
  .strict()

const summaryTemplateEntrySchema = z
  .object({
    id: createTemplateStringSchema('sources.*.summary.entry.id', {
      required: false,
    }),
    title: createTemplateStringSchema('sources.*.summary.entry.title', {
      required: false,
    }),
    link: createTemplateStringSchema('sources.*.summary.entry.link', {
      required: false,
    }),
    description: createTemplateStringSchema(
      'sources.*.summary.entry.description',
      { required: false },
    ),
    content: createTemplateStringSchema('sources.*.summary.entry.content', {
      required: false,
    }),
    published: createTemplateStringSchema('sources.*.summary.entry.published', {
      required: false,
    }),
    updated: createTemplateStringSchema('sources.*.summary.entry.updated', {
      required: false,
    }),
  })
  .strict()

export const summarySourceSchema = z
  .object({
    sources: z.array(requiredString()).min(1),
    feed: summaryTemplateFeedSchema.optional(),
    entry: summaryTemplateEntrySchema.optional(),
  })
  .strict()
```

```ts
export interface SummarySourceConfigResolved {
  sources: string[]
  feed?: Partial<UnifiedFeedFields>
  entry?: Partial<UnifiedEntryFields>
}

export interface SummaryWindowRuntime {
  previousCheckpoint?: string
  scheduledAt: string
}

export interface ResolvedSourceConfig extends Omit<
  SourceConfigInput,
  'enabled' | 'deliveries'
> {
  id: string
  enabled: boolean
  deliveries: ResolvedDeliveryConfig[]
  summary?: SummarySourceConfigResolved
}
```

- [ ] **Step 5: 在 schema / resolve 中实现互斥与引用校验**

```ts
if (value.summary) {
  if (value.http || value.byparr) {
    ctx.addIssue({
      code: 'custom',
      message: 'source 不能同时配置 summary 与 http/byparr',
    })
  }
  if (value.syndication || value.xquery) {
    ctx.addIssue({
      code: 'custom',
      message: 'source 不能同时配置 summary 与 syndication/xquery',
    })
  }
  if (!value.schedule || value.schedule.trim() === '') {
    ctx.addIssue({
      path: ['schedule'],
      code: 'custom',
      message: ISSUE_REQUIRED,
    })
  }
}
```

```ts
for (const [sourceId, source] of Object.entries(value.sources ?? {})) {
  for (const upstreamId of source.summary?.sources ?? []) {
    if (!value.sources?.[upstreamId]) {
      ctx.addIssue({
        path: ['sources', sourceId, 'summary', 'sources'],
        code: 'custom',
        message: createInvalidIssueMessage(`未定义 source ${upstreamId}`),
      })
    }
  }
}
```

- [ ] **Step 6: 在 resolve / capabilities 中接入 summary**

```ts
if (source.summary) {
  return {
    ...source,
    enabled: source.enabled ?? true,
    deliveries: resolveSourceDeliveries(
      source.id,
      source.deliveries ?? {},
      deliveries,
    ),
    summary: {
      sources: [...source.summary.sources],
      feed: source.summary.feed ? { ...source.summary.feed } : undefined,
      entry: source.summary.entry ? { ...source.summary.entry } : undefined,
    },
    http: undefined,
    byparr: undefined,
    syndication: undefined,
    xquery: undefined,
  }
}
```

```ts
CONFIG_FIELD_CAPABILITIES.push(
  { path: 'sources.*.summary.feed.*', allowEnv: true, allowLiquid: true },
  { path: 'sources.*.summary.entry.*', allowEnv: true, allowLiquid: true },
)
```

- [ ] **Step 7: 重新运行配置层测试，确认通过**

Run:
`deno task test src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/capabilities_test.ts`

Expected: PASS

- [ ] **Step 8: 提交这一批配置改动**

```bash
git add src/config/schema.ts src/config/types.ts src/config/resolve_config.ts src/config/capabilities.ts src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/capabilities_test.ts
git commit -m "feat: add summary source config contract"
```

### Task 2: 增加 summary 查询与 checkpoint 时间覆写

**Files:**

- Create: `src/db/source_state_query.ts`
- Create: `src/db/source_state_query_test.ts`
- Modify: `src/db/source_state_store.ts`
- Test: `src/db/source_state_store_test.ts`

- [ ] **Step 1: 写 DB 查询与 observedAt 覆写的失败测试**

```ts
test('sourceStateStore: persistParsedSource 应支持 observedAt 覆写 feed 与 entry 时间', async () => {
  await store.persistParsedSource({
    sourceId: 'daily_summary',
    parser: 'summary',
    payload: '{}',
    feedMapped: { title: 'Daily Summary' },
    entries: [{ mapped: { id: 'daily:1', title: 'Summary' } }],
    observedAt: '2026-04-12T09:00:00.000Z',
  })

  const feedRow = db.$client
    .prepare(
      "SELECT fetched_at, updated_at FROM feeds WHERE source_id='daily_summary'",
    )
    .get()
  const entryRow = db.$client
    .prepare(
      "SELECT first_seen_at, last_seen_at, updated_at FROM entries WHERE source_id='daily_summary' AND entry_id='daily:1'",
    )
    .get()

  assertEquals(feedRow, {
    fetched_at: '2026-04-12T09:00:00.000Z',
    updated_at: '2026-04-12T09:00:00.000Z',
  })
  assertEquals(entryRow.last_seen_at, '2026-04-12T09:00:00.000Z')
})
```

```ts
test('sourceStateQuery: 应读取 summary checkpoint、feed 快照与窗口内 entries', async () => {
  const query = createSourceStateQuery({ db })

  const checkpoint = query.getSummaryCheckpoint('daily_summary')
  const upstream = query.getSummaryInputs(['deno'], {
    after: '2026-04-12T08:00:00.000Z',
    atOrBefore: '2026-04-12T09:00:00.000Z',
  })

  assertEquals(checkpoint, '2026-04-12T08:00:00.000Z')
  assertEquals(upstream.deno.feed.title, 'Deno Feed')
  assertEquals(
    upstream.deno.entries.map((entry) => entry.id),
    ['entry-1'],
  )
})
```

- [ ] **Step 2: 运行 DB 测试，确认当前失败**

Run:
`deno task test src/db/source_state_store_test.ts src/db/source_state_query_test.ts`

Expected: FAIL，提示 `observedAt` 不存在、`createSourceStateQuery` 未实现。

- [ ] **Step 3: 在 state store 中实现 observedAt 覆写**

```ts
export interface PersistParsedSourceInput {
  sourceId: string
  parser: ParsedSourceResult['parser']
  payload: string
  feedMapped: ParsedSourceResult['feedMapped']
  entries: ParsedSourceEntry[]
  observedAt?: string
}

function resolveObservedAt(input: PersistParsedSourceInput): string {
  return input.observedAt ?? new Date().toISOString()
}
```

```ts
const now = resolveObservedAt(input)
db.insert(feeds).values({
  sourceId: input.sourceId,
  parser: input.parser,
  payloadText: input.payload,
  payloadHash: input.payloadHash,
  feedText,
  fetchedAt: now,
  updatedAt: now,
})
```

- [ ] **Step 4: 新建 summary 只读查询层**

```ts
export interface SummaryQueryWindow {
  after: string
  atOrBefore: string
}

export interface SummaryUpstreamState {
  name: string
  feed: Record<string, string>
  entries: Array<Record<string, string>>
}

export interface SourceStateQuery {
  getSummaryCheckpoint(sourceId: string): string | undefined
  getSummaryInputs(
    sourceIds: string[],
    window: SummaryQueryWindow,
  ): Record<string, SummaryUpstreamState>
}
```

```ts
const rows = db
  .select({ entryText: entries.entryText })
  .from(entries)
  .where(
    and(
      eq(entries.sourceId, sourceId),
      gt(entries.lastSeenAt, window.after),
      lte(entries.lastSeenAt, window.atOrBefore),
    ),
  )
  .orderBy(entries.lastSeenAt)
  .all()
```

- [ ] **Step 5: 重新运行 DB 测试，确认通过**

Run:
`deno task test src/db/source_state_store_test.ts src/db/source_state_query_test.ts`

Expected: PASS

- [ ] **Step 6: 提交 DB 查询与 checkpoint 改动**

```bash
git add src/db/source_state_store.ts src/db/source_state_store_test.ts src/db/source_state_query.ts src/db/source_state_query_test.ts
git commit -m "feat: add summary source state queries"
```

### Task 3: 实现 summary source runtime 与模板上下文

**Files:**

- Create: `src/sources/summary.ts`
- Create: `src/sources/summary_test.ts`
- Modify: `src/sources/source_runtime.ts`
- Test: `src/sources/source_runtime_test.ts`

- [ ] **Step 1: 写 summary runtime 的失败测试**

```ts
Deno.test(
  'summary source: 首次运行应跳过 entry 但返回 checkpoint feed',
  async () => {
    const result = await buildSummarySource({
      source: {
        id: 'daily_summary',
        name: '每日摘要',
        schedule: '0 0 9 * * *',
        summary: { sources: ['deno'] },
        deliveries: [],
        enabled: true,
      },
      scheduledAt: '2026-04-12T09:00:00.000Z',
      stateQuery: {
        getSummaryCheckpoint: () => undefined,
        getSummaryInputs: () => ({
          deno: { name: 'Deno', feed: {}, entries: [] },
        }),
      },
      aiRuntime,
    })

    assertEquals(result.entries, [])
    assertEquals(result.observedAt, '2026-04-12T09:00:00.000Z')
    assertEquals(result.feedMapped.title, '每日摘要')
  },
)
```

```ts
Deno.test(
  'summary source: 模板可访问 source.runtime.window 与 sources.<id>.entries',
  async () => {
    const result = await buildSummarySource({
      source: {
        id: 'daily_summary',
        name: '每日摘要',
        schedule: '0 0 9 * * *',
        summary: {
          sources: ['deno'],
          entry: {
            title: '{{ source.name }}',
            content:
              '{{ source.runtime.window.previousCheckpoint }} => {{ sources.deno.entries[0].title | ai_summarize: length: 20 }}',
          },
        },
        deliveries: [],
        enabled: true,
      },
      scheduledAt: '2026-04-12T09:00:00.000Z',
      stateQuery: {
        getSummaryCheckpoint: () => '2026-04-12T08:00:00.000Z',
        getSummaryInputs: () => ({
          deno: {
            name: 'Deno Feed',
            feed: { title: 'Deno Feed' },
            entries: [
              { id: 'entry-1', title: 'Deno 2.0', content: 'release note' },
            ],
          },
        }),
      },
      aiRuntime,
    })

    assertEquals(result.entries.length, 1)
    assertEquals(result.entries[0].mapped.title, '每日摘要')
    assertEquals(
      result.entries[0].mapped.content.includes('2026-04-12T08:00:00.000Z'),
      true,
    )
  },
)
```

- [ ] **Step 2: 运行 summary runtime 测试，确认当前失败**

Run:
`deno task test src/sources/summary_test.ts src/sources/source_runtime_test.ts`

Expected: FAIL，提示 `buildSummarySource` 未定义、parser 不支持 `summary`、`observedAt` 未透传。

- [ ] **Step 3: 实现 summary builder**

```ts
export interface BuildSummarySourceInput {
  source: ResolvedSourceConfig
  scheduledAt: string
  stateQuery: SourceStateQuery
  aiRuntime?: AiRuntime
  logger?: Logger
}

export async function buildSummarySource(
  input: BuildSummarySourceInput,
): Promise<FetchedParsedSourceResult> {
  const previousCheckpoint = input.stateQuery.getSummaryCheckpoint(
    input.source.id,
  )
  const feedMapped = {
    title: input.source.name,
    link: '',
    description: '',
    generator: 'knock.summary',
    language: 'zh-CN',
    published: input.scheduledAt,
  }

  if (!previousCheckpoint) {
    return {
      parser: 'summary',
      payload: JSON.stringify({
        reason: 'summary.previous_checkpoint_missing',
      }),
      feedMapped,
      entries: [],
      timing: { fetchDurationMs: 0, parseDurationMs: 0 },
      observedAt: input.scheduledAt,
    }
  }

  const sources = input.stateQuery.getSummaryInputs(
    input.source.summary!.sources,
    {
      after: previousCheckpoint,
      atOrBefore: input.scheduledAt,
    },
  )

  return await renderSummaryResult({
    source: input.source,
    scheduledAt: input.scheduledAt,
    previousCheckpoint,
    feedMapped,
    sources,
    aiRuntime: input.aiRuntime,
  })
}
```

- [ ] **Step 4: 在 source runtime 中接入 summary 分支与 parser 扩展**

```ts
export interface FetchAndParseSourceInput {
  source: ResolvedSourceConfig
  httpClient: HttpClient
  timeOptions: { timezone: string; timestampFormat: string }
  aiRuntime?: AiRuntime
  logger?: Logger
  sourceStateQuery?: SourceStateQuery
  scheduledAt?: string
}

if (source.summary) {
  return await buildSummarySource({
    source,
    scheduledAt: input.scheduledAt ?? new Date().toISOString(),
    stateQuery: input.sourceStateQuery!,
    aiRuntime: input.aiRuntime,
    logger: input.logger,
  })
}
```

```ts
export interface ParsedSourceResult {
  feedMapped: UnifiedFeedFields | Record<string, string>
  entries: ParsedSourceEntry[]
  parser: 'rss' | 'atom' | 'json' | 'xquery' | 'summary' | 'none'
}
```

- [ ] **Step 5: 重新运行 summary runtime 测试，确认通过**

Run:
`deno task test src/sources/summary_test.ts src/sources/source_runtime_test.ts`

Expected: PASS

- [ ] **Step 6: 提交 summary runtime 改动**

```bash
git add src/sources/summary.ts src/sources/summary_test.ts src/sources/source_runtime.ts src/sources/source_runtime_test.ts
git commit -m "feat: build summary source runtime"
```

### Task 4: 接通 app / source processor 执行链路

**Files:**

- Modify: `src/core/source_processor.ts`
- Test: `src/core/source_processor_test.ts`
- Modify: `src/core/app.ts`
- Test: `src/core/app_test.ts`

- [ ] **Step 1: 写 observedAt 透传与 app summary 执行的失败测试**

```ts
Deno.test(
  'sourceProcessor: observedAt 应透传给 persistParsedSource',
  async () => {
    const logs: Array<Record<string, unknown>> = []
    const persisted: Array<Record<string, unknown>> = []
    const source = createSource({
      summary: { sources: ['deno'] },
      http: undefined,
      syndication: undefined,
    })
    const processor = createSourceProcessor({
      logger: createTestLogger(logs),
      scheduler: {
        runSource: async (_sourceId, task) => {
          await task()
        },
      },
      sourceRuntime: {
        fetchAndParse: () =>
          Promise.resolve({
            parser: 'summary',
            payload: '{}',
            feedMapped: { title: 'Daily Summary' },
            entries: [],
            timing: { fetchDurationMs: 0, parseDurationMs: 0 },
            observedAt: '2026-04-12T09:00:00.000Z',
          }),
      },
      contentRuntime: {
        buildContext: (entry, feed, currentSource) => ({
          entry,
          feed,
          source: currentSource,
        }),
        shouldPassFilter: () => Promise.resolve(true),
      },
      deliveryRuntime: {
        getDeliveryId: (delivery) => delivery.id,
        push: () => Promise.resolve(),
      },
      sourceStateStore: {
        persistParsedSource: (input) => {
          persisted.push(input as unknown as Record<string, unknown>)
          return Promise.resolve()
        },
        deliverIfNeeded: () => Promise.resolve('delivered'),
        pruneSourceState: () => {},
      },
      createRunId: () => 'run-1',
      now: () => 1000,
    })

    await processor.runOnce(source)
    assertEquals(persisted[0].observedAt, '2026-04-12T09:00:00.000Z')
  },
)
```

```ts
test('app: immediate 模式下 summary source 首次运行应只写 checkpoint 不投递', async () => {
  const testRuntime = getTestRuntime('summary-immediate-first-run')
  await emptyDir(testRuntime)
  await ensureDir(testRuntime)

  await Deno.writeTextFile(
    join(testRuntime, 'config.yml'),
    `
deliveries:
  archive:
    file:
      path: outputs/summary.md
      content: "{{ entry.title }}"

sources:
  deno:
    http:
      url: https://example.com/feed.xml
    syndication:
      entry:
        id: "{{ id }}"
        title: "{{ title }}"
  daily_summary:
    name: 每日摘要
    schedule: "0 0 9 * * *"
    deliveries:
      archive: {}
    summary:
      sources:
        - deno
`,
  )

  const result = await startApp({
    runtimeDir: testRuntime,
    keepAlive: false,
    immediate: true,
  })
  assertEquals(result.mode, 'daemon')
  assertEquals(await exists(join(testRuntime, 'outputs', 'summary.md')), false)
})
```

- [ ] **Step 2: 运行 processor / app 测试，确认当前失败**

Run:
`deno task test src/core/source_processor_test.ts src/core/app_test.ts`

Expected: FAIL，提示 `observedAt` 未透传、app 未注入 summary 查询或 summary immediate 用例未通过。

- [ ] **Step 3: 在 source processor 中透传 observedAt**

```ts
await options.sourceStateStore.persistParsedSource(
  {
    sourceId: source.id,
    parser: parsed.parser,
    payload: parsed.payload,
    feedMapped: parsed.feedMapped,
    entries: parsed.entries,
    observedAt: parsed.observedAt,
  },
  runId,
)
```

- [ ] **Step 4: 在 app 中注入 summary 查询依赖与 scheduledAt**

```ts
export interface SourceRuntimeRunOptions {
  scheduledAt?: string
}

export interface SourceRuntime {
  fetchAndParse(
    source: ResolvedSourceConfig,
    logger?: Logger,
    options?: SourceRuntimeRunOptions,
  ): Promise<FetchedParsedSourceResult>
}

const sourceStateQuery = createSourceStateQuery({ db })

const sourceProcessor = createSourceProcessor({
  logger,
  scheduler,
  sourceRuntime: {
    fetchAndParse: (source, sourceRuntimeLogger, runtimeOptions) =>
      fetchAndParseSource({
        source,
        httpClient,
        timeOptions: {
          timezone: config.timezone,
          timestampFormat: config.timestampFormat,
        },
        aiRuntime,
        logger: sourceRuntimeLogger,
        sourceStateQuery,
        scheduledAt: runtimeOptions?.scheduledAt,
      }),
  },
  contentRuntime,
  deliveryRuntime,
  sourceStateStore,
  aiRuntime,
})
```

```ts
export interface SourceRunOptions {
  scheduledAt?: string
}

export interface SourceProcessor {
  runOnce(
    source: ResolvedSourceConfig,
    options?: SourceRunOptions,
  ): Promise<void>
}

scheduledJobs.push(
  new Cron(source.schedule, { protect: true }, () => {
    const scheduledAt = new Date().toISOString()
    void sourceProcessor.runOnce(source, { scheduledAt }).catch(() => {})
  }),
)
```

- [ ] **Step 5: 重新运行 processor / app 测试，确认通过**

Run:
`deno task test src/core/source_processor_test.ts src/core/app_test.ts`

Expected: PASS

- [ ] **Step 6: 提交执行链路改动**

```bash
git add src/core/source_processor.ts src/core/source_processor_test.ts src/core/app.ts src/core/app_test.ts
git commit -m "feat: wire summary source into app runtime"
```

### Task 5: 同步文档、示例与最终验证

**Files:**

- Modify: `config.example.yml`
- Modify: `README.md`
- Test: `src/config/config_example_test.ts`
- Test: `src/config/load_config_test.ts`

- [ ] **Step 1: 写示例与文档测试的失败用例**

```ts
Deno.test('config.example.yml: summary source 示例应通过当前 schema', () => {
  const validated = validateConfig({
    runtimeDir: '/tmp/knock',
    ...(parse(
      Deno.readTextFileSync(
        new URL('../../config.example.yml', import.meta.url),
      ),
    ) as Record<string, unknown>),
  })

  assertEquals(validated.sources.daily_summary.summary?.sources, [
    'deno',
    'website_news',
  ])
})
```

```ts
test('loadConfig: summary.feed / summary.entry 中的环境变量应按 capability 展开', async () => {
  Deno.env.set('KNOCK_SUMMARY_TITLE', 'Daily Summary')
  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    `
sources:
  deno:
    http:
      url: https://example.com/feed.xml
    syndication: {}
  daily_summary:
    schedule: "0 0 9 * * *"
    summary:
      sources:
        - deno
      entry:
        title: "${'${KNOCK_SUMMARY_TITLE}'}"
`,
  )

  const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
  assertEquals(
    config.sources.find((source) => source.id === 'daily_summary')?.summary
      ?.entry?.title,
    'Daily Summary',
  )
})
```

- [ ] **Step 2: 运行文档/示例测试，确认当前失败**

Run:
`deno task test src/config/config_example_test.ts src/config/load_config_test.ts`

Expected: FAIL，提示示例未包含 summary source 或 capability 未覆盖 summary 模板字段。

- [ ] **Step 3: 更新 `config.example.yml` 与 `README.md`**

```yml
sources:
  daily_summary:
    name: 每日摘要
    schedule: '0 0 9 * * *'
    summary:
      sources:
        - deno
        - website_news
      entry:
        title: '{{ source.name }}'
        content: |
          Deno:
          {% for entry in sources.deno.entries %}
          - {{ entry.title }}
          {% endfor %}
```

```md
### Summary source

`summary` source 不抓取外部输入，而是读取已持久化的上游 source 状态。它必须配置 `schedule`，窗口前界取自 summary source 自身上次成功写入的 feed 记录时间，窗口内上游 entries 按 `last_seen_at` 选取。

模板上下文第一版只保证：

- `source.runtime.window.previousCheckpoint`
- `source.runtime.window.scheduledAt`
- `sources.<id>.name`
- `sources.<id>.feed`
- `sources.<id>.entries`
```

- [ ] **Step 4: 运行 scoped 静态检查与测试**

Run:
`deno task fmt:check src/config/schema.ts src/config/types.ts src/config/resolve_config.ts src/config/capabilities.ts src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/capabilities_test.ts src/config/load_config_test.ts src/config/config_example_test.ts src/db/source_state_store.ts src/db/source_state_store_test.ts src/db/source_state_query.ts src/db/source_state_query_test.ts src/sources/source_runtime.ts src/sources/source_runtime_test.ts src/sources/summary.ts src/sources/summary_test.ts src/core/source_processor.ts src/core/source_processor_test.ts src/core/app.ts src/core/app_test.ts README.md config.example.yml`

Expected: PASS

Run:
`deno task check src/config src/db src/sources src/core`

Expected: PASS

Run:
`deno task lint:check src/config src/db src/sources src/core`

Expected: PASS

Run:
`deno task test src/config src/db src/sources src/core`

Expected: PASS

- [ ] **Step 5: 运行全量测试收尾**

Run:
`deno task test`

Expected: PASS

- [ ] **Step 6: 提交文档与最终验证改动**

```bash
git add config.example.yml README.md src/config/config_example_test.ts src/config/load_config_test.ts
git commit -m "docs: document summary source behavior"
```
