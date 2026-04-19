# Final Rewrite Architecture Tail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收掉 final rewrite 主线后的 3 个架构尾巴：让 `DefinitionSet.policies` 真正进入 composition/runtime wiring、移除 `src/composition/*` 对 `src/interfaces/*` 的反向依赖、并让 `ProductionRuntime` 暴露 `queryRunsUseCase` 与 `pruneFactsUseCase` 而不扩展任何新 CLI/web/debug surface。

**Architecture:** 保持最小收口。先把 preview/production policy 映射为真实 wiring 决策：preview 禁止 facts/dedupe/external side effects，production 继续使用真实 sqlite facts pipeline。再把 runtime-only helper 从 `src/interfaces/*` 收回 `src/composition/*`，并让 `createRuntimeKernel()` 直接消费完整 `DefinitionSet`。最后仅在 production runtime 上装配 query/prune provider，不触碰 `src/main.ts`、`web/routes/**`、`README.md` 或 `config.example.yml`。

**Tech Stack:** Deno、TypeScript、SQLite/Drizzle、现有 application/composition/runtime layers。

---

## File Structure

### New files

- `src/composition/runtime_source_helpers.ts` — 从 interfaces 收回 runtime-only 的 `resolveSourceConfig` / `selectSourceInputGateway`。
- `src/composition/runtime_source_helpers_test.ts` — 锁 helper 行为不变，允许删除 interfaces 版本。

### Existing files to modify

- `src/composition/create_runtime_kernel.ts` — 让 runtime pipeline 真正消费 `EffectPolicy`，并改为直接接收 `DefinitionSet`。
- `src/composition/create_runtime_kernel_test.ts` — 锁 preview policy 不落 facts/dedupe，以及新的 `DefinitionSet` 输入。
- `src/composition/create_preview_runtime.ts` — 用 `compileDefinitionsFromResolvedConfig()` + preview policy 装配 preview runtime；允许测试注入 `factsDb`。
- `src/composition/create_preview_runtime_test.ts` — 锁 preview capture 仍存在，且 preview 不写 facts/dedupe。
- `src/composition/create_production_runtime.ts` — 用 production policy 装配真实 pipeline，并暴露 query/prune provider；允许测试注入 `factsDb`。
- `src/composition/create_production_runtime_test.ts` — 锁 production runtime 暴露 `queryRunsUseCase` / `pruneFactsUseCase`。
- `src/definitions/compile_definitions_test.ts` — 继续锁 `policies` 常量输出。
- `src/interfaces/config/load_definitions.ts` — 保持 bridge，不让 composition 依赖它。
- `src/interfaces/config/load_definitions_test.ts` — 继续锁 bridge 行为。

### Files to delete

- `src/interfaces/source_runtime_helpers.ts`
- `src/interfaces/source_runtime_helpers_test.ts`

### Files expected to stay untouched

- `src/main.ts`
- `web/routes/**`
- `README.md`
- `config.example.yml`

如果实现过程中看起来必须改这些文件，说明 scope 已经外扩，应立即停下并重规划。

---

### Task 1: Consume `DefinitionSet.policies` in runtime wiring

**Files:**

- Modify: `src/composition/create_runtime_kernel.ts`
- Test: `src/composition/create_runtime_kernel_test.ts`
- Modify: `src/composition/create_preview_runtime.ts`
- Test: `src/composition/create_preview_runtime_test.ts`
- Modify: `src/composition/create_production_runtime.ts`
- Test: `src/definitions/compile_definitions_test.ts`

- [ ] **Step 1: Write the failing policy-consumption tests**

```ts
// src/composition/create_runtime_kernel_test.ts
import { assertEquals } from '@std/assert'
import { createInMemoryDb } from '../db/client.ts'
import { createRuntimePipeline } from './create_runtime_kernel.ts'

function countRows(
  db: ReturnType<typeof createInMemoryDb>,
  tableName: string,
): number {
  const row = db.$client
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get() as {
    count: number
  }
  return row.count
}

Deno.test(
  '[contract] runtime kernel: preview policy 应禁用 facts 与 dedupe 持久化',
  async () => {
    const db = createInMemoryDb()
    const pipeline = createRuntimePipeline({
      factsDb: db,
      policy: {
        persistFacts: false,
        writeDedupe: false,
        allowExternalSideEffects: false,
        exposeToRecovery: false,
        exposeToPrune: false,
      },
      deliveryExecutors: {},
    })

    await pipeline.runRepository.insert({
      runId: 'run-preview',
      sourceId: 'rust',
      trigger: 'preview',
      profile: 'preview',
      effectDomain: 'preview',
      status: 'running',
      scheduledAt: '2026-04-18T13:00:00.000Z',
      startedAt: '2026-04-18T13:00:01.000Z',
      counts: {
        fetchedCount: 0,
        parsedCount: 0,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    })
    await pipeline.itemRepository.insertMany([
      {
        itemId: 'item-preview',
        sourceRunId: 'run-preview',
        sourceId: 'rust',
        effectDomain: 'preview',
        normalized: {
          id: 'entry-preview',
          title: 'Preview',
          link: '',
          description: '',
          content: '',
          published: '',
          updated: '',
        },
        status: 'ready',
      },
    ])
    await pipeline.deliveryAttemptRepository.insertPlanned({
      attemptId: 'attempt-preview',
      itemId: 'item-preview',
      sourceRunId: 'run-preview',
      deliveryId: 'archive',
      channel: 'file',
      attemptNumber: 1,
      effectDomain: 'preview',
      status: 'planned',
      plannedAt: '2026-04-18T13:00:02.000Z',
    })
    await pipeline.deduplicationRepository.registerItemFingerprint({
      sourceId: 'rust',
      effectDomain: 'preview',
      fingerprint: 'entry-preview',
      recordedAt: '2026-04-18T13:00:03.000Z',
    })

    assertEquals(countRows(db, 'source_runs'), 0)
    assertEquals(countRows(db, 'pipeline_items'), 0)
    assertEquals(countRows(db, 'delivery_attempts'), 0)
    assertEquals(countRows(db, 'deduplications'), 0)
    assertEquals(
      await pipeline.deduplicationRepository.isItemDuplicate({
        sourceId: 'rust',
        effectDomain: 'preview',
        fingerprint: 'entry-preview',
      }),
      false,
    )
  },
)
```

```ts
// src/composition/create_preview_runtime_test.ts
import { assertEquals } from '@std/assert'
import { createInMemoryDb } from '../db/client.ts'
import { createPreviewComposition } from './create_preview_runtime.ts'

function countRows(
  db: ReturnType<typeof createInMemoryDb>,
  tableName: string,
): number {
  const row = db.$client
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get() as {
    count: number
  }
  return row.count
}

Deno.test(
  '[contract] preview composition: preview policy 应 capture 但不落 facts',
  async () => {
    const factsDb = createInMemoryDb()
    const captured: string[] = []
    const runtime = createPreviewComposition({
      config: {
        runtimeDir: '/tmp/knock-preview-policy',
        language: 'zh-CN',
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        sqlite: {
          path: '/tmp/knock-preview-policy/facts.db',
          busyTimeout: '5s',
          journalMode: 'WAL',
          retention: {
            maxAge: '7d',
            maxEntriesPerSource: 100,
            vacuum: 'off',
          },
        },
        deliveries: [
          {
            id: 'archive',
            file: {
              path: 'outputs/archive.md',
              content: '{{ entry.title }}',
            },
          },
        ],
        sources: [
          {
            id: 'playground',
            enabled: true,
            http: { url: 'https://example.com/feed.xml' },
            syndication: {},
            deliveries: [
              {
                id: 'archive',
                sourceId: 'playground',
                deliveryId: 'archive',
                file: {
                  path: '/tmp/knock-preview-policy/outputs/archive.md',
                  content: '{{ entry.title }}',
                },
              },
            ],
          },
        ],
        logging: { level: 'info', sinks: {} },
      },
      factsDb,
      now: () => '2026-04-18T13:10:00.000Z',
      fetcher: () =>
        Promise.resolve(
          new Response(
            `<?xml version="1.0"?><rss version="2.0"><channel><title>Preview</title><link>https://example.com</link><description>Preview</description><item><guid>item-1</guid><title>Hello</title><link>https://example.com/items/1</link><description>World</description></item></channel></rss>`,
          ),
        ),
      onCaptured: (plan) => captured.push(plan.deliveryId),
    })

    await runtime.previewSourceUseCase.execute({
      source: {
        kind: 'fetch',
        sourceId: 'playground',
        fetcher: 'http',
        parser: 'syndication',
      },
      bindings: [
        {
          sourceId: 'playground',
          deliveryId: 'archive',
          definition: {
            kind: 'file',
            deliveryId: 'archive',
            path: '/tmp/knock-preview-policy/outputs/archive.md',
            contentTemplate: '{{ entry.title }}',
          },
        },
      ],
    })

    assertEquals(captured, ['archive'])
    assertEquals(countRows(factsDb, 'source_runs'), 0)
    assertEquals(countRows(factsDb, 'pipeline_items'), 0)
    assertEquals(countRows(factsDb, 'delivery_attempts'), 0)
    assertEquals(countRows(factsDb, 'deduplications'), 0)
  },
)
```

- [ ] **Step 2: Run the composition tests and verify they fail**

Run:

```bash
deno task test src/composition/create_runtime_kernel_test.ts src/composition/create_preview_runtime_test.ts src/definitions/compile_definitions_test.ts
```

Expected: FAIL because `createRuntimePipeline()` 还没有 policy 参数，`createPreviewComposition()` 还不能注入 `factsDb`，且 preview 仍会写入 in-memory facts/dedupe。

- [ ] **Step 3: Implement policy-aware runtime pipeline wiring**

```ts
// src/composition/create_runtime_kernel.ts
import type { EffectPolicy } from '../definitions/definition_set.ts'

function createNoopRunRepository(): RunRepository {
  return {
    insert: () => Promise.resolve(),
    update: () => Promise.resolve(),
    setFeedSnapshot: () => Promise.resolve(),
  }
}

function createNoopItemRepository(): ItemRepository {
  return {
    insertMany: () => Promise.resolve(),
    updateStatus: () => Promise.resolve(),
  }
}

function createNoopDeliveryAttemptRepository(): DeliveryAttemptRepository {
  return {
    insertPlanned: () => Promise.resolve(),
    finish: () => Promise.resolve(),
  }
}

function createNoopDeduplicationRepository(): DeduplicationRepository {
  return {
    isItemDuplicate: () => Promise.resolve(false),
    registerItemFingerprint: () => Promise.resolve(),
    isDeliveryDuplicate: () => Promise.resolve(false),
    registerDeliveryFingerprint: () => Promise.resolve(),
  }
}

export function createRuntimePipeline(input: {
  factsDb: FactsDbClient
  policy: EffectPolicy
  deliveryExecutors: Partial<DeliveryExecutorRegistry>
}) {
  return {
    runRepository: input.policy.persistFacts
      ? createRunRepository(input.factsDb)
      : createNoopRunRepository(),
    itemRepository: input.policy.persistFacts
      ? createItemRepository(input.factsDb)
      : createNoopItemRepository(),
    deliveryAttemptRepository: input.policy.persistFacts
      ? createDeliveryAttemptRepository(input.factsDb)
      : createNoopDeliveryAttemptRepository(),
    deduplicationRepository: input.policy.writeDedupe
      ? createApplicationDeduplicationRepository(input.factsDb)
      : createNoopDeduplicationRepository(),
    deliveryExecutors: input.deliveryExecutors,
  }
}
```

```ts
// src/composition/create_preview_runtime.ts
import type { FactsDbClient } from '../db/client.ts'
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'

export function createPreviewComposition(input: {
  config: AppConfigResolved
  factsDb?: FactsDbClient
  fetcher?: typeof fetch
  now?: () => string
  onCaptured?: (plan: DeliveryAttemptPlan) => void
}) {
  const factsDb = input.factsDb ?? createInMemoryDb()
  const definitionSet = compileDefinitionsFromResolvedConfig(input.config)
  const shared = createSourceRuntimeSharedDeps({
    config: input.config,
    factsDb,
    fetcher: input.fetcher ?? fetch,
    sourceConfigsById: definitionSet.sourceConfigsById,
  })
  const captureExecutor = createCaptureDeliveryExecutor({
    onCaptured: input.onCaptured,
  })

  const runSourceUseCase = createRunSourceUseCaseForRuntime({
    requireFullPipeline: true,
    now: input.now ?? (() => new Date().toISOString()),
    createRunId: () => `run-preview-${crypto.randomUUID()}`,
    sourceInputGateway: createRuntimeSourceInputGateway(shared),
    sourceParser: shared.sourceParser,
    pipeline: createRuntimePipeline({
      factsDb,
      policy: definitionSet.policies.preview,
      deliveryExecutors: {
        file: captureExecutor,
        push: captureExecutor,
        email: captureExecutor,
      },
    }),
    renderContent: (template, context) =>
      shared.contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) =>
      shared.contentRuntime.renderPayload(
        asPreviewPushPayload(payload),
        context,
      ),
  })

  return {
    previewSourceUseCase: new PreviewSourceUseCase({ runSourceUseCase }),
  }
}
```

```ts
// src/composition/create_production_runtime.ts
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'

const definitionSet = compileDefinitionsFromResolvedConfig(options.config)

const runSourceUseCase = (() => {
  const shared = createSourceRuntimeSharedDeps({
    config: options.config,
    factsDb,
    sourceConfigsById: definitionSet.sourceConfigsById,
    fetcher: options.httpFetcher ?? fetch,
    proxyClientFactory: options.httpProxyClientFactory ?? Deno.createHttpClient,
    aiLogger: logger.child({ module: 'core.ai.runtime' }),
    contentLogger: logger.child({ module: 'content.render' }),
    parserLogger: logger.child({ module: 'source.parse' }),
    httpLogger: logger.child({ module: 'source.fetch.http' }),
    byparrLogger: logger.child({ module: 'source.fetch.byparr' }),
  })

  return createRunSourceUseCaseForRuntime({
    now,
    createRunId: () => crypto.randomUUID(),
    sourceInputGateway: createRuntimeSourceInputGateway(shared),
    sourceParser: shared.sourceParser,
    pipeline: createRuntimePipeline({
      factsDb,
      policy: definitionSet.policies.production,
      deliveryExecutors: {
        file: createFileDeliveryExecutor({
          runtimeDir: options.config.runtimeDir,
          logger: logger.child({ module: 'delivery.file' }),
        }),
        push: createHttpDeliveryExecutor({
          httpClient: shared.httpClient,
          logger: logger.child({ module: 'delivery.http' }),
        }),
        email: createEmailDeliveryExecutor({
          logger: logger.child({ module: 'delivery.email' }),
          delivery: createEmailDelivery({
            logger: logger.child({ module: 'delivery.email' }),
            createTransport: options.emailTransportFactory,
          }),
        }),
      },
    }),
    renderContent: (template, context) =>
      shared.contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) =>
      shared.contentRuntime.renderPayload(payload as never, context),
    shouldPassFilter: ({ item, feed, source, filterTemplate }) =>
      shared.contentRuntime.shouldPassFilter(
        filterTemplate,
        shared.contentRuntime.buildContext(item, feed, source),
      ),
    logger: logger.child({ module: 'scheduler.source' }),
    requireFullPipeline: true,
  })
})()
```

- [ ] **Step 4: Re-run the scoped policy tests**

Run:

```bash
deno task test src/composition/create_runtime_kernel_test.ts src/composition/create_preview_runtime_test.ts src/composition/create_production_runtime_test.ts src/definitions/compile_definitions_test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the policy wiring**

```bash
git add src/composition/create_runtime_kernel.ts src/composition/create_runtime_kernel_test.ts src/composition/create_preview_runtime.ts src/composition/create_preview_runtime_test.ts src/composition/create_production_runtime.ts src/definitions/compile_definitions_test.ts
git commit -m "refactor(runtime): consume definition policies in wiring"
```

---

### Task 2: Remove `src/composition/*` reverse dependencies on `src/interfaces/*`

**Files:**

- Create: `src/composition/runtime_source_helpers.ts`
- Test: `src/composition/runtime_source_helpers_test.ts`
- Modify: `src/composition/create_runtime_kernel.ts`
- Test: `src/composition/create_runtime_kernel_test.ts`
- Modify: `src/composition/create_production_runtime.ts`
- Test: `src/interfaces/config/load_definitions_test.ts`
- Delete: `src/interfaces/source_runtime_helpers.ts`
- Delete: `src/interfaces/source_runtime_helpers_test.ts`

- [ ] **Step 1: Write the failing extraction tests**

```ts
// src/composition/runtime_source_helpers_test.ts
import { assertEquals, assertThrows } from '@std/assert'
import {
  resolveSourceConfig,
  selectSourceInputGateway,
} from './runtime_source_helpers.ts'

Deno.test(
  '[contract] runtimeSourceHelpers: resolveSourceConfig 应返回命中的 source config',
  () => {
    const source = {
      id: 'rust',
      enabled: true,
      deliveries: [],
    }

    assertEquals(resolveSourceConfig({ rust: source as never }, 'rust'), source)
  },
)

Deno.test(
  '[contract] runtimeSourceHelpers: resolveSourceConfig 缺失时应显式失败',
  () => {
    assertThrows(
      () => resolveSourceConfig({}, 'rust'),
      Error,
      'source 未定义: rust',
    )
  },
)

Deno.test(
  '[contract] runtimeSourceHelpers: selectSourceInputGateway 应按 source kind/fetcher 选择 gateway',
  () => {
    const createGateway = (name: string) => ({
      name,
      fetch: () =>
        Promise.resolve({
          kind: 'fetch' as const,
          collectedAt: '2026-04-18T13:30:00.000Z',
          payloadSummary: { hash: name },
        }),
    })

    const httpGateway = createGateway('http')
    const byparrGateway = createGateway('byparr')
    const summaryGateway = createGateway('summary')

    assertEquals(
      selectSourceInputGateway(
        {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'http',
          parser: 'syndication',
        },
        { httpGateway, byparrGateway, summaryGateway },
      ),
      httpGateway,
    )
    assertEquals(
      selectSourceInputGateway(
        {
          kind: 'fetch',
          sourceId: 'rust',
          fetcher: 'byparr',
          parser: 'xquery',
        },
        { httpGateway, byparrGateway, summaryGateway },
      ),
      byparrGateway,
    )
    assertEquals(
      selectSourceInputGateway(
        {
          kind: 'summary',
          sourceId: 'digest',
          upstreamSourceIds: ['rust'],
        },
        { httpGateway, byparrGateway, summaryGateway },
      ),
      summaryGateway,
    )
  },
)
```

```ts
// src/composition/create_runtime_kernel_test.ts
import { compileDefinitionsFromResolvedConfig } from '../definitions/compile_definitions.ts'

const config = createTestConfig(runtimeDir)
const kernel = createRuntimeKernel({
  config,
  definitions: compileDefinitionsFromResolvedConfig(config),
  now: () => '2026-04-18T13:31:00.000Z',
  runSourceUseCase: {
    execute: () => Promise.resolve({} as RunSourceResult),
  },
})
```

- [ ] **Step 2: Run the composition tests and verify they fail**

Run:

```bash
deno task test src/composition/runtime_source_helpers_test.ts src/composition/create_runtime_kernel_test.ts src/interfaces/config/load_definitions_test.ts
```

Expected: FAIL because `src/composition/runtime_source_helpers.ts` 还不存在，且 `createRuntimeKernel()` 还没有 `definitions` 输入。

- [ ] **Step 3: Move the runtime-only helpers into composition and make `DefinitionSet` the direct kernel input**

```ts
// src/composition/runtime_source_helpers.ts
import type { ResolvedSourceConfig } from '../config/types.ts'
import type { SourceInputGateway } from '../application/ports/source_input_gateway.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'

export function resolveSourceConfig(
  sourceConfigsById: Record<string, ResolvedSourceConfig>,
  sourceId: string,
): ResolvedSourceConfig {
  const source = sourceConfigsById[sourceId]
  if (!source) {
    throw new Error(`source 未定义: ${sourceId}`)
  }
  return source
}

export function selectSourceInputGateway(
  source: SourceDefinition,
  deps: {
    httpGateway: SourceInputGateway
    byparrGateway: SourceInputGateway
    summaryGateway: SourceInputGateway
  },
): SourceInputGateway {
  if (source.kind === 'summary') return deps.summaryGateway
  return source.fetcher === 'byparr' ? deps.byparrGateway : deps.httpGateway
}
```

```ts
// src/composition/create_runtime_kernel.ts
import type { DefinitionSet } from '../definitions/definition_set.ts'
import {
  resolveSourceConfig,
  selectSourceInputGateway,
} from './runtime_source_helpers.ts'

export function createRuntimeKernel(input: {
  config: AppConfigResolved
  definitions: DefinitionSet
  now: () => string
  runSourceUseCase: Pick<RunSourceUseCase, 'execute'>
}): RuntimeKernel {
  const sourceConfigs = Object.values(input.definitions.sourceConfigsById)
  const sourceById = new Map(
    input.definitions.sources.map(
      (source) => [source.sourceId, source] as const,
    ),
  )
  const bindingsBySourceId = new Map<
    string,
    (typeof input.definitions.bindings)[number][]
  >()

  for (const binding of input.definitions.bindings) {
    const existing = bindingsBySourceId.get(binding.sourceId) ?? []
    existing.push(binding)
    bindingsBySourceId.set(binding.sourceId, existing)
  }

  const sourceQueryService: SourceQueryService = {
    getSource: (sourceId) => Promise.resolve(sourceById.get(sourceId)),
    getBindings: (sourceId) =>
      Promise.resolve(bindingsBySourceId.get(sourceId) ?? []),
    listDueSources: (at, trigger) => {
      const dueSources = []

      for (const sourceConfig of sourceConfigs) {
        if (!sourceConfig.enabled) continue
        if (trigger === 'scheduled') {
          if (!sourceConfig.schedule) continue
          if (
            !new Cron(sourceConfig.schedule, {
              paused: true,
              timezone: input.config.timezone,
            }).match(at)
          ) {
            continue
          }
        }

        const source = sourceById.get(sourceConfig.id)
        if (!source) {
          throw new Error(`source 未定义: ${sourceConfig.id}`)
        }

        dueSources.push({
          source,
          bindings: bindingsBySourceId.get(sourceConfig.id) ?? [],
        })
      }

      return Promise.resolve(dueSources)
    },
  }

  return {
    sourceQueryService,
    runDueSourcesUseCase: new RunDueSourcesUseCase({
      now: input.now,
      sourceQueryService,
      runSourceUseCase: input.runSourceUseCase,
    }),
    sourceConfigs,
  }
}
```

```ts
// src/composition/create_production_runtime.ts
const kernel = createRuntimeKernel({
  config: options.config,
  definitions: definitionSet,
  now,
  runSourceUseCase,
})
```

- [ ] **Step 4: Delete the interfaces helper and verify `src/composition/*` is clean**

Run:

```bash
rm src/interfaces/source_runtime_helpers.ts src/interfaces/source_runtime_helpers_test.ts
deno task test src/composition/runtime_source_helpers_test.ts src/composition/create_runtime_kernel_test.ts src/interfaces/config/load_definitions_test.ts
deno task check src/composition src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts
deno task lint:check src/composition src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts
git grep -n "../interfaces/" -- src/composition
```

Expected:

- test/check/lint PASS
- `git grep` no output（并以 exit code 1 结束）

- [ ] **Step 5: Commit the dependency cleanup**

```bash
git add src/composition/runtime_source_helpers.ts src/composition/runtime_source_helpers_test.ts src/composition/create_runtime_kernel.ts src/composition/create_runtime_kernel_test.ts src/composition/create_production_runtime.ts src/interfaces/config/load_definitions_test.ts
git add -u src/interfaces/source_runtime_helpers.ts src/interfaces/source_runtime_helpers_test.ts
git commit -m "refactor(composition): remove interfaces reverse deps"
```

---

### Task 3: Expose query/prune providers from production runtime

**Files:**

- Modify: `src/composition/create_production_runtime.ts`
- Test: `src/composition/create_production_runtime_test.ts`
- Test: `src/infrastructure/sqlite/source_run_query_service_test.ts`
- Test: `src/infrastructure/sqlite/prune_facts_repository_test.ts`
- Test: `src/infrastructure/sqlite/recovery_test.ts`

- [ ] **Step 1: Write the failing provider-exposure tests**

```ts
// src/composition/create_production_runtime_test.ts
import { assertEquals, assertExists } from '@std/assert'
import { createInMemoryDb } from '../db/client.ts'
import { registerItemFingerprint } from '../infrastructure/sqlite/deduplication_repository.ts'
import { insertDeliveryAttempt } from '../infrastructure/sqlite/delivery_attempt_repository.ts'
import { insertPipelineItem } from '../infrastructure/sqlite/item_repository.ts'
import { insertSourceRun } from '../infrastructure/sqlite/run_repository.ts'
import { createProductionRuntime } from './create_production_runtime.ts'

Deno.test(
  '[contract] production composition: 应暴露 queryRunsUseCase',
  async () => {
    const factsDb = createInMemoryDb()

    await insertSourceRun(factsDb, {
      runId: 'run-query',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'running',
      scheduledAt: '2026-04-18T14:00:00.000Z',
      startedAt: '2026-04-18T14:00:01.000Z',
      counts: {
        fetchedCount: 0,
        parsedCount: 0,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 0,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    })
    await insertPipelineItem(factsDb, {
      itemId: 'item-query',
      sourceRunId: 'run-query',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'entry-query',
        title: 'Query',
        link: '',
        description: '',
        content: '',
        published: '',
        updated: '',
      },
      status: 'ready',
    })
    await insertDeliveryAttempt(factsDb, {
      attemptId: 'attempt-query',
      itemId: 'item-query',
      sourceRunId: 'run-query',
      deliveryId: 'archive',
      channel: 'file',
      effectDomain: 'production',
      status: 'planned',
      plannedAt: '2026-04-18T14:00:02.000Z',
      attemptNumber: 1,
    })

    const runtime = createProductionRuntime({
      config: createTestConfig('/tmp/knock-production-query-provider'),
      factsDb,
      now: () => '2026-04-18T14:00:03.000Z',
      keepAlive: false,
    })

    try {
      const view = await runtime.queryRunsUseCase.getRun('run-query')
      assertExists(view)
      assertEquals(view.run.runId, 'run-query')
      assertEquals(view.attempts[0]?.attemptId, 'attempt-query')
    } finally {
      runtime.stop()
    }
  },
)

Deno.test(
  '[contract] production composition: 应暴露 pruneFactsUseCase 并使用 runtime now',
  async () => {
    const factsDb = createInMemoryDb()

    await insertSourceRun(factsDb, {
      runId: 'run-old',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-01T10:00:00.000Z',
      startedAt: '2026-04-01T10:00:00.000Z',
      finishedAt: '2026-04-01T10:01:00.000Z',
      counts: {
        fetchedCount: 1,
        parsedCount: 1,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 1,
        failedAttemptCount: 0,
        skippedCount: 0,
      },
    })
    await registerItemFingerprint(factsDb, {
      deduplicationKey: 'production:item:rust:entry-old',
      scope: 'item',
      scopeId: 'rust',
      effectDomain: 'production',
      fingerprint: 'entry-old',
      recordedAt: '2026-04-01T10:00:00.000Z',
    })

    const runtime = createProductionRuntime({
      config: createTestConfig('/tmp/knock-production-prune-provider'),
      factsDb,
      now: () => '2026-04-18T14:00:00.000Z',
      keepAlive: false,
    })

    try {
      const result = await runtime.pruneFactsUseCase.execute({
        maxAge: '7d',
        maxEntriesPerSource: 100,
      })

      assertEquals(result.deletedRuns, 1)
      assertEquals(result.deletedDeduplications, 1)
    } finally {
      runtime.stop()
    }
  },
)
```

- [ ] **Step 2: Run the production-runtime tests and verify they fail**

Run:

```bash
deno task test src/composition/create_production_runtime_test.ts src/infrastructure/sqlite/source_run_query_service_test.ts src/infrastructure/sqlite/prune_facts_repository_test.ts src/infrastructure/sqlite/recovery_test.ts
```

Expected: FAIL because `ProductionRuntime` 还没有 `queryRunsUseCase` / `pruneFactsUseCase`，且 `createProductionRuntime()` 还不能注入 `factsDb`。

- [ ] **Step 3: Implement the production query/prune providers without expanding public surface**

```ts
// src/composition/create_production_runtime.ts
import { PruneFactsUseCase } from '../application/prune_facts_use_case.ts'
import { QueryRunsUseCase } from '../application/query_runs_use_case.ts'
import type { FactsDbClient } from '../db/client.ts'
import { createPruneFactsRepository } from '../infrastructure/sqlite/prune_facts_repository.ts'
import { createSourceRunQueryService } from '../infrastructure/sqlite/source_run_query_service.ts'

export interface ProductionRuntime {
  runDueSourcesUseCase: {
    execute: ReturnType<
      typeof createRuntimeKernel
    >['runDueSourcesUseCase']['execute']
  }
  queryRunsUseCase: QueryRunsUseCase
  pruneFactsUseCase: PruneFactsUseCase
  recoverInterruptedAttempts: () => Promise<void>
  runImmediate: () => Promise<void>
  enterDaemon: () => Promise<void>
  stop: () => void
}

export interface CreateProductionRuntimeOptions {
  config: AppConfigResolved
  factsDb?: FactsDbClient
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: typeof Deno.createHttpClient
  emailTransportFactory?: typeof nodemailer.createTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
  now?: () => string
  runDueSourcesUseCase?: ProductionRuntime['runDueSourcesUseCase']
  scheduleDueSources?: (task: () => Promise<void>) => { stop: () => void }
}

const factsDb =
  options.factsDb ??
  createFactsDbClient({
    sqlite: options.config.sqlite,
    logger: logger.child({ module: 'db.sqlite' }),
  })
const productionPolicy = definitionSet.policies.production

if (!productionPolicy.persistFacts) {
  throw new Error('production policy 必须持久化 facts 才能暴露 query runtime')
}
if (!productionPolicy.exposeToRecovery || !productionPolicy.exposeToPrune) {
  throw new Error('production policy 必须暴露 recovery/prune provider')
}

const queryRunsUseCase = new QueryRunsUseCase({
  sourceRunQueryService: createSourceRunQueryService(factsDb),
})
const pruneFactsUseCase = new PruneFactsUseCase({
  now,
  pruneFactsRepository: createPruneFactsRepository(factsDb),
})

return {
  runDueSourcesUseCase,
  queryRunsUseCase,
  pruneFactsUseCase,
  recoverInterruptedAttempts: () => markInterruptedAttempts(factsDb, now()),
  async runImmediate() {
    await scheduler.runSource('__run_due_sources__', async () => {
      await runDueSourcesUseCase.execute({
        trigger: 'immediate',
        scheduledAt: now(),
      })
    })
  },
  async enterDaemon() {
    scheduledJobs.push(
      scheduleDueSources(async () => {
        await scheduler.runSource('__run_due_sources__', async () => {
          await runDueSourcesUseCase.execute({
            trigger: 'scheduled',
            scheduledAt: now(),
          })
        })
      }),
    )

    const shouldKeepAlive = options.keepAlive ?? true
    if (!shouldKeepAlive) return
    await (options.keepAliveSignal ?? new Promise(() => {}))
  },
  stop() {
    for (const job of scheduledJobs) {
      job.stop()
    }
    factsDb.$client.close()
  },
}
```

- [ ] **Step 4: Verify no new user-visible surface was added, then run scoped and full verification**

Run:

```bash
git diff --name-only -- src/main.ts web/routes README.md config.example.yml
deno task test src/definitions/compile_definitions_test.ts src/interfaces/config/load_definitions_test.ts src/composition/runtime_source_helpers_test.ts src/composition/create_runtime_kernel_test.ts src/composition/create_preview_runtime_test.ts src/composition/create_production_runtime_test.ts src/infrastructure/sqlite/source_run_query_service_test.ts src/infrastructure/sqlite/prune_facts_repository_test.ts src/infrastructure/sqlite/recovery_test.ts
deno task check src/composition src/definitions src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts src/infrastructure/sqlite/source_run_query_service.ts src/infrastructure/sqlite/prune_facts_repository.ts src/main.ts
deno task lint:check src/composition src/definitions src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts src/infrastructure/sqlite/source_run_query_service.ts src/infrastructure/sqlite/prune_facts_repository.ts src/main.ts
deno task fmt:check src/composition src/definitions src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts src/infrastructure/sqlite/source_run_query_service.ts src/infrastructure/sqlite/prune_facts_repository.ts src/main.ts docs/superpowers/specs/2026-04-18-final-rewrite-architecture-tail-design.md docs/superpowers/plans/2026-04-18-final-rewrite-architecture-tail-implementation.md
deno task test
```

Expected:

- `git diff --name-only -- src/main.ts web/routes README.md config.example.yml` outputs nothing
- All scoped commands PASS
- Final `deno task test` PASS

- [ ] **Step 5: Commit the production provider exposure**

```bash
git add src/composition/create_production_runtime.ts src/composition/create_production_runtime_test.ts src/composition/create_runtime_kernel.ts src/composition/create_runtime_kernel_test.ts src/composition/create_preview_runtime.ts src/composition/create_preview_runtime_test.ts src/composition/runtime_source_helpers.ts src/composition/runtime_source_helpers_test.ts
git add -u src/interfaces/source_runtime_helpers.ts src/interfaces/source_runtime_helpers_test.ts
git commit -m "refactor(runtime): finish architecture tail cleanup"
```

---

## Self-check before execution

1. `DefinitionSet.policies` 必须被真实消费，而不是继续只存在于 compiler 输出里。
2. preview wiring 必须同时满足：`persistFacts=false`、`writeDedupe=false`、`allowExternalSideEffects=false`。
3. `src/composition/*` 完成后不得再 import `src/interfaces/*`。
4. `ProductionRuntime` 必须暴露 `queryRunsUseCase` 与 `pruneFactsUseCase`，且不改 `src/main.ts` / `web/routes/**`。
5. 最终必须有 scoped `test/check/lint/fmt` 证据，以及 fresh `deno task test` 全绿证据。
