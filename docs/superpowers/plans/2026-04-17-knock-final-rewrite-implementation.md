# Knock Final Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Knock 从当前半收口 v2 过渡态收成 `DefinitionSet + 单执行内核 + composition root` 架构，并在同一条实现线上冻结 preview 安全边界、收口调度真相、正式化 facts/query layer、删除过渡装配层。

**Architecture:** 先冻结 preview/web/query/definition 的外部可观察契约，并立即切断 preview 路径上的真实副作用；再引入 `DefinitionSet` compiler、显式 `CollectSource / ExecuteRun / PreviewRun / RunDueSources / QueryRuns / PruneFacts` use cases，以及新的 `src/composition/` 装配层。最后把 daemon / web / playground / CLI 全部改为通过同一 application 内核工作，完成 facts schema/repository cutover，并删除 `src/interfaces/*runtime*` 与 `src/core/app.ts` 里的过渡编排。

**Tech Stack:** Deno、TypeScript、Zod、Fresh、SQLite/Drizzle、现有 HTTP/byparr/source parser、现有 file/push/email delivery adapters、LogTape。

---

## File Structure

### New files

- `src/infrastructure/deliveries/capture_delivery_executor.ts` — preview/playground 专用 capture sink，记录 attempt，不触发外部副作用。
- `src/infrastructure/deliveries/capture_delivery_executor_test.ts` — capture sink 合同测试。
- `src/definitions/definition_set.ts` — `DefinitionSet`、`EffectPolicy`、compiler 输出类型。
- `src/definitions/compile_definitions.ts` — 从已解析 config 编译内部 `DefinitionSet`。
- `src/definitions/compile_definitions_test.ts` — compiler 合同测试。
- `src/application/collect_source_use_case.ts` — 显式 collect-only 入口。
- `src/application/collect_source_use_case_test.ts` — collect-only 合同测试。
- `src/application/execute_run_use_case.ts` — 显式 full-execute 入口。
- `src/application/execute_run_use_case_test.ts` — execute 合同测试。
- `src/application/preview_run_use_case.ts` — preview-effect 执行入口。
- `src/application/preview_run_use_case_test.ts` — preview execute 合同测试。
- `src/application/query_runs_use_case.ts` — query layer 入口，先锁 `getRun(runId)` 最小合同。
- `src/application/query_runs_use_case_test.ts` — `QueryRuns` 合同测试。
- `src/application/prune_facts_use_case.ts` — retention/prune 入口。
- `src/application/prune_facts_use_case_test.ts` — `PruneFacts` 合同测试。
- `src/application/ports/source_run_query_service.ts` — query service 应用层端口。
- `src/application/ports/prune_facts_repository.ts` — prune repository 应用层端口。
- `src/infrastructure/sqlite/prune_facts_repository.ts` — SQLite prune 实现。
- `src/infrastructure/sqlite/prune_facts_repository_test.ts` — SQLite prune 合同测试。
- `src/composition/create_runtime_kernel.ts` — 从 `DefinitionSet` 装配 shared kernel。
- `src/composition/create_runtime_kernel_test.ts` — shared kernel 合同测试。
- `src/composition/create_preview_runtime.ts` — preview composition，注入 capture sink。
- `src/composition/create_preview_runtime_test.ts` — preview composition 合同测试。
- `src/composition/create_production_runtime.ts` — production/daemon composition。
- `src/composition/create_production_runtime_test.ts` — production composition 合同测试。
- `src/interfaces/cli/parse_cli_command.ts` — CLI command object 解析层。
- `src/interfaces/cli/parse_cli_command_test.ts` — CLI command 合同测试。

### Existing files to modify

- `src/application/run_source_use_case.ts` — 删除 execute 隐式 collect-only 退化路径。
- `src/application/run_source_use_case_test.ts` — 将退化成功测试改为 fail-fast 合同测试。
- `src/application/preview_source_use_case.ts` — 改为薄包装，不再把“execute 可降级”当成 preview 语义。
- `src/application/run_due_sources_use_case.ts` — 扩成 due-source 唯一执行入口，支持显式 command。
- `src/interfaces/config/load_definitions.ts` — 变成 bridge，转调新的 compiler。
- `src/interfaces/config/load_definitions_test.ts` — 冻结旧 definitions 外部行为基线，并补 `trigger` 不混入 binding 断言。
- `src/interfaces/create_source_execution_core.ts` — 逐步迁移到 `src/composition/create_runtime_kernel.ts`，最终删除。
- `src/interfaces/create_source_execution_core_test.ts` — 将 preview collect-only 合同改成显式 `CollectSourceUseCase` 合同。
- `src/interfaces/daemon/create_daemon_runtime.ts` — 降为薄接口，委托给 `src/composition/create_production_runtime.ts`。
- `src/interfaces/daemon/start_daemon_test.ts` — 增加 daemon 只调用 `RunDueSourcesUseCase` 的合同测试。
- `src/interfaces/web/preview_runtime.ts` — 降为薄接口，委托给 `src/composition/create_preview_runtime.ts`。
- `src/interfaces/web/preview_runtime_test.ts` — 锁 preview profile/effectDomain 与响应收口后的 contract。
- `src/infrastructure/sqlite/source_run_query_service.ts` — 实现应用层 query port。
- `src/infrastructure/sqlite/source_run_query_service_test.ts` — 锁 `getRun(runId)` 最小 query 合同。
- `src/infrastructure/sqlite/schema.ts` / `src/infrastructure/sqlite/schema_test.ts` — facts schema cutover；保留 `deduplications` 作为辅助运行表。
- `src/infrastructure/sqlite/recovery.ts` / `src/infrastructure/sqlite/recovery_test.ts` — recovery 只依赖 facts 表。
- `src/main.ts` — 改为 command dispatcher，不再自己持有解析与业务编排。
- `src/main_test.ts` — 改为 command object 分发测试。
- `web/routes/api/xquery/evaluate.ts` / `web/routes/api/xquery/evaluate_test.ts` — 锁定并保持当前 JSON response schema。
- `web/routes/api/syndication/evaluate.ts` / `web/routes/api/syndication/evaluate_test.ts` — 同上。
- `src/web/xquery_playground.ts` / `src/web/syndication_playground.ts` — 继续通过 preview composition 运行，不再自己决定副作用。
- `src/config/types.ts` — 增加 `ConfigDocument`，切断“resolved config 即内部运行时真相”的语义。
- `README.md` / `config.example.yml` — 只在 CLI/config 外部行为真的变化时同步。
- `deno.json` — 如果 CLI 启动面变化，更新 task 命令；若外部命令保持不变，则只做路径同步检查。

### Transitional files to delete at cutover

- `src/interfaces/create_source_execution_core.ts`
- `src/core/app.ts`
- 任何仅为 preview execute 降级、旧 definitions bridge、旧 composition 过渡层服务的 helper

---

### Task 1: Freeze preview safety and playground response contracts

**Files:**

- Create: `src/infrastructure/deliveries/capture_delivery_executor.ts`
- Test: `src/infrastructure/deliveries/capture_delivery_executor_test.ts`
- Create: `src/composition/create_preview_runtime.ts`
- Test: `src/composition/create_preview_runtime_test.ts`
- Modify: `src/interfaces/web/preview_runtime.ts`
- Test: `src/interfaces/web/preview_runtime_test.ts`
- Modify: `web/routes/api/xquery/evaluate_test.ts`
- Modify: `web/routes/api/syndication/evaluate_test.ts`
- Modify: `src/web/xquery_playground.ts`
- Modify: `src/web/syndication_playground.ts`

- [ ] **Step 1: Write the failing tests for capture sink and frozen response schema**

```ts
// src/infrastructure/deliveries/capture_delivery_executor_test.ts
import { assertEquals } from '@std/assert'
import type { DeliveryAttemptPlan } from '../../application/ports/delivery_executor.ts'
import { createCaptureDeliveryExecutor } from './capture_delivery_executor.ts'

Deno.test(
  '[contract] captureDeliveryExecutor: 应记录 attempt 而不触发外部副作用',
  async () => {
    const captured: DeliveryAttemptPlan[] = []
    const executor = createCaptureDeliveryExecutor({
      onCaptured: (plan) => captured.push(plan),
    })

    await executor.execute({
      attemptId: 'attempt-1',
      sourceRunId: 'run-1',
      itemId: 'item-1',
      deliveryId: 'archive',
      channel: 'file',
      effectDomain: 'preview',
      plannedAt: '2026-04-17T12:00:00.000Z',
      renderedSnapshot: {
        channel: 'file',
        payload: {
          path: '/tmp/archive.md',
          content: 'Hello',
        },
      },
    })

    assertEquals(
      captured.map((plan) => plan.deliveryId),
      ['archive'],
    )
    assertEquals(captured[0]?.effectDomain, 'preview')
  },
)
```

```ts
// src/composition/create_preview_runtime_test.ts
import { assertEquals } from '@std/assert'
import { createPreviewComposition } from './create_preview_runtime.ts'

Deno.test(
  '[contract] preview composition: 应使用 capture executors 而不是真实 delivery executors',
  async () => {
    const captured: string[] = []
    const runtime = createPreviewComposition({
      config: {
        runtimeDir: '/tmp/runtime',
        language: 'zh-CN',
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        sqlite: {
          path: '/tmp/runtime/facts.db',
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
        logging: { level: 'info', sinks: {} },
      },
      fetcher: fetch,
      now: () => '2026-04-17T12:05:00.000Z',
      onCaptured: (plan) => captured.push(plan.deliveryId),
    })

    assertEquals(typeof runtime.previewSourceUseCase.execute, 'function')
    assertEquals(captured, [])
  },
)
```

```ts
// web/routes/api/xquery/evaluate_test.ts
const payload = await readJson(response)
assertEquals(
  Object.keys(payload).sort(),
  ['entries', 'feed', 'fetchMeta', 'parser', 'rawContent', 'warnings'].sort(),
)
assertEquals('plan' in payload, false)
```

```ts
// web/routes/api/syndication/evaluate_test.ts
const payload = await readJson(response)
assertEquals(
  Object.keys(payload).sort(),
  ['entries', 'feed', 'fetchMeta', 'parser', 'rawContent', 'warnings'].sort(),
)
assertEquals('plan' in payload, false)
```

- [ ] **Step 2: Run the preview/web tests and verify they fail**

Run:

```bash
deno task test src/infrastructure/deliveries/capture_delivery_executor_test.ts src/composition/create_preview_runtime_test.ts src/interfaces/web/preview_runtime_test.ts web/routes/api/xquery/evaluate_test.ts web/routes/api/syndication/evaluate_test.ts
```

Expected: FAIL with module-not-found errors for the new capture/composition files, plus route schema assertions failing because playground responses still include transitional fields.

- [ ] **Step 3: Implement the capture sink and preview composition**

```ts
// src/infrastructure/deliveries/capture_delivery_executor.ts
import type {
  DeliveryAttemptPlan,
  DeliveryExecutor,
} from '../../application/ports/delivery_executor.ts'

export interface CaptureDeliveryExecutorDeps {
  onCaptured?: (plan: DeliveryAttemptPlan) => void
}

export function createCaptureDeliveryExecutor(
  deps: CaptureDeliveryExecutorDeps = {},
): DeliveryExecutor {
  return {
    async execute(plan: DeliveryAttemptPlan): Promise<void> {
      deps.onCaptured?.(plan)
    },
  }
}
```

```ts
// src/composition/create_preview_runtime.ts
import { createInMemoryDb } from '../db/client.ts'
import { PreviewSourceUseCase } from '../application/preview_source_use_case.ts'
import {
  createRuntimePipeline,
  createRuntimeSourceInputGateway,
  createSourceRuntimeSharedDeps,
  createRunSourceUseCaseForRuntime,
} from '../interfaces/create_source_execution_core.ts'
import { buildLoadedDefinitionsFromResolvedConfig } from '../interfaces/config/load_definitions.ts'
import { createCaptureDeliveryExecutor } from '../infrastructure/deliveries/capture_delivery_executor.ts'
import type { AppConfigResolved } from '../config/types.ts'

export function createPreviewComposition(input: {
  config: AppConfigResolved
  fetcher?: typeof fetch
  now?: () => string
  onCaptured?: Parameters<typeof createCaptureDeliveryExecutor>[0]['onCaptured']
}) {
  const factsDb = createInMemoryDb()
  const definitions = buildLoadedDefinitionsFromResolvedConfig(input.config)
  const shared = createSourceRuntimeSharedDeps({
    config: input.config,
    factsDb,
    fetcher: input.fetcher ?? fetch,
    sourceConfigsById: definitions.sourceConfigsById,
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
      deliveryExecutors: {
        file: captureExecutor,
        push: captureExecutor,
        email: captureExecutor,
      },
    }),
    renderContent: (template, context) =>
      shared.contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) =>
      shared.contentRuntime.renderPayload(payload, context),
  })

  return {
    previewSourceUseCase: new PreviewSourceUseCase({ runSourceUseCase }),
  }
}
```

```ts
// src/interfaces/web/preview_runtime.ts
import { createPreviewComposition } from '../../composition/create_preview_runtime.ts'

export function createPreviewSourceUseCaseRuntime(input: {
  config: AppConfigResolved
  fetcher?: typeof fetch
  now?: () => string
}) {
  return createPreviewComposition(input).previewSourceUseCase
}

export function toPreviewExecutionResult(input: {
  warnings: string[]
  result: Awaited<ReturnType<PreviewSourceUseCase['execute']>>
}) {
  return {
    warnings: input.warnings,
    fetchMeta: {
      ok: true,
      payloadBytes: input.result.fetchedInput.rawText?.length,
      fetchDurationMs: undefined,
      parseDurationMs: undefined,
    },
    parser: input.result.parsed.parser,
    rawContent:
      input.result.fetchedInput.rawText ??
      JSON.stringify(input.result.fetchedInput.collectedJson ?? {}),
    feed: input.result.parsed.feed,
    entries: input.result.parsed.items.map((item) => ({ mapped: item })),
  }
}
```

- [ ] **Step 4: Route both playground helpers through the preview composition**

```ts
// src/web/xquery_playground.ts
const result = input.previewExecutor
  ? await input.previewExecutor({
      config,
      source: resolvedSource,
      fetcher: input.fetcher,
    })
  : toPreviewExecutionResult({
      warnings: parsed.warnings,
      result: await executePreviewSource({
        config,
        source: resolvedSource,
        fetcher: input.fetcher,
      }),
    })

return {
  ...result,
  warnings: parsed.warnings,
}
```

```ts
// src/web/syndication_playground.ts
const result = input.previewExecutor
  ? await input.previewExecutor({
      config,
      source: resolvedSource,
      fetcher: input.fetcher,
    })
  : toPreviewExecutionResult({
      warnings: parsed.warnings,
      result: await executePreviewSource({
        config,
        source: resolvedSource,
        fetcher: input.fetcher,
      }),
    })

return {
  ...result,
  warnings: parsed.warnings,
}
```

- [ ] **Step 5: Re-run the preview/web tests**

Run:

```bash
deno task test src/infrastructure/deliveries/capture_delivery_executor_test.ts src/composition/create_preview_runtime_test.ts src/interfaces/web/preview_runtime_test.ts web/routes/api/xquery/evaluate_test.ts web/routes/api/syndication/evaluate_test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the preview safety gate**

```bash
git add src/infrastructure/deliveries/capture_delivery_executor.ts src/infrastructure/deliveries/capture_delivery_executor_test.ts src/composition/create_preview_runtime.ts src/composition/create_preview_runtime_test.ts src/interfaces/web/preview_runtime.ts src/interfaces/web/preview_runtime_test.ts src/web/xquery_playground.ts src/web/syndication_playground.ts web/routes/api/xquery/evaluate_test.ts web/routes/api/syndication/evaluate_test.ts
git commit -m "test(preview): freeze preview capture contract"
```

---

### Task 2: Introduce `DefinitionSet` and compiler bridge

**Files:**

- Create: `src/definitions/definition_set.ts`
- Create: `src/definitions/compile_definitions.ts`
- Test: `src/definitions/compile_definitions_test.ts`
- Modify: `src/interfaces/config/load_definitions.ts`
- Test: `src/interfaces/config/load_definitions_test.ts`
- Test: `src/interfaces/runtime_definition_consistency_test.ts`

- [ ] **Step 1: Write the failing compiler tests**

```ts
// src/definitions/compile_definitions_test.ts
import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { withOwnedRuntime } from '../test_runtime.ts'
import { loadConfig } from '../config/load_config.ts'
import { compileDefinitionsFromResolvedConfig } from './compile_definitions.ts'

Deno.test(
  '[contract] compileDefinitions: 应从 resolved config 生成单一 DefinitionSet',
  async () => {
    await withOwnedRuntime(async ({ runtimeDir }) => {
      await Deno.writeTextFile(
        join(runtimeDir, 'config.yml'),
        `
deliveries:
  archive:
    file:
      path: outputs/archive.md
      content: '{{ entry.title }}'
  webhook:
    push:
      http:
        url: https://example.com/hook
      request:
        payload:
          text: '{{ entry.title }}'

sources:
  rust:
    http:
      url: https://example.com/feed.xml
    deliveries:
      archive: {}
      webhook: {}
`,
      )

      const config = await loadConfig({ runtimeDir })
      const definitions = compileDefinitionsFromResolvedConfig(config)

      assertEquals(definitions.sources.length, 1)
      assertEquals(definitions.deliveries.length, 2)
      assertEquals(definitions.bindings.length, 2)
      assertEquals(definitions.policies.preview.allowExternalSideEffects, false)
      assertEquals(
        definitions.policies.production.allowExternalSideEffects,
        true,
      )
      assertEquals('profile' in definitions.bindings[0]!, false)
      assertEquals('effectDomain' in definitions.bindings[0]!, false)
      assertEquals('trigger' in definitions.bindings[0]!, false)
    })
  },
)
```

```ts
// src/interfaces/config/load_definitions_test.ts
assertEquals('profile' in rustArchiveBinding, false)
assertEquals('effectDomain' in rustArchiveBinding, false)
assertEquals('trigger' in rustArchiveBinding, false)
```

- [ ] **Step 2: Run the compiler and bridge tests to verify failure**

Run:

```bash
deno task test src/definitions/compile_definitions_test.ts src/interfaces/config/load_definitions_test.ts src/interfaces/runtime_definition_consistency_test.ts
```

Expected: FAIL with module-not-found for `compile_definitions.ts` and missing `policies` assertions.

- [ ] **Step 3: Define `DefinitionSet` and compiler output types**

```ts
// src/definitions/definition_set.ts
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { DeliveryDefinition } from '../domain/delivery_definition.ts'
import type { SourceDefinition } from '../domain/source_definition.ts'
import type { ResolvedSourceConfig } from '../config/types.ts'

export interface EffectPolicy {
  persistFacts: boolean
  writeDedupe: boolean
  allowExternalSideEffects: boolean
  exposeToRecovery: boolean
  exposeToPrune: boolean
}

export interface DefinitionSet {
  sources: SourceDefinition[]
  deliveries: DeliveryDefinition[]
  bindings: DeliveryBinding[]
  sourceConfigsById: Record<string, ResolvedSourceConfig>
  policies: {
    preview: EffectPolicy
    production: EffectPolicy
  }
}
```

- [ ] **Step 4: Implement the compiler and bridge `load_definitions` to it**

```ts
// src/definitions/compile_definitions.ts
import type { AppConfigResolved } from '../config/types.ts'
import type { DefinitionSet } from './definition_set.ts'
import { toPushRequestType } from '../config/delivery_semantics.ts'

function toSourceDefinition(source: AppConfigResolved['sources'][number]) {
  if (source.summary) {
    return {
      kind: 'summary' as const,
      sourceId: source.id,
      upstreamSourceIds: [...source.summary.sources],
      ...(source.filter ? { filter: source.filter } : {}),
    }
  }

  return {
    kind: 'fetch' as const,
    sourceId: source.id,
    fetcher: source.byparr ? ('byparr' as const) : ('http' as const),
    parser: source.xquery ? ('xquery' as const) : ('syndication' as const),
    ...(source.filter ? { filter: source.filter } : {}),
  }
}

function toCanonicalDeliveryDefinition(
  delivery: AppConfigResolved['deliveries'][number],
) {
  if (delivery.file) {
    return {
      kind: 'file' as const,
      deliveryId: delivery.id,
      path: delivery.file.path,
      contentTemplate: delivery.file.content,
      rotation: delivery.file.rotation
        ? structuredClone(delivery.file.rotation)
        : undefined,
    }
  }

  if (delivery.push) {
    return {
      kind: 'push' as const,
      deliveryId: delivery.id,
      http: structuredClone(delivery.push.http),
      requestType: toPushRequestType(delivery.push.request.type),
      payloadTemplate: structuredClone(delivery.push.request.payload ?? {}),
      response: delivery.push.response
        ? structuredClone(delivery.push.response)
        : undefined,
    }
  }

  return {
    kind: 'email' as const,
    deliveryId: delivery.id,
    smtp: structuredClone(delivery.email!.smtp),
    messageTemplate: structuredClone(delivery.email!.message),
  }
}

export function compileDefinitionsFromResolvedConfig(
  config: AppConfigResolved,
): DefinitionSet {
  const deliveries = config.deliveries.map(toCanonicalDeliveryDefinition)
  const sources = config.sources.map(toSourceDefinition)
  const bindings = config.sources.flatMap((source) =>
    source.deliveries.map((delivery) => ({
      sourceId: source.id,
      deliveryId: delivery.deliveryId,
      definition: toCanonicalDeliveryDefinition(delivery),
    })),
  )

  return {
    sources,
    deliveries,
    bindings,
    sourceConfigsById: Object.fromEntries(
      config.sources.map((source) => [source.id, source]),
    ),
    policies: {
      preview: {
        persistFacts: false,
        writeDedupe: false,
        allowExternalSideEffects: false,
        exposeToRecovery: false,
        exposeToPrune: false,
      },
      production: {
        persistFacts: true,
        writeDedupe: true,
        allowExternalSideEffects: true,
        exposeToRecovery: true,
        exposeToPrune: true,
      },
    },
  }
}
```

```ts
// src/interfaces/config/load_definitions.ts
import { compileDefinitionsFromResolvedConfig } from '../../definitions/compile_definitions.ts'

export function buildLoadedDefinitionsFromResolvedConfig(
  config: AppConfigResolved,
): LoadedDefinitions {
  const definitionSet = compileDefinitionsFromResolvedConfig(config)
  return {
    sources: definitionSet.sources,
    deliveries: definitionSet.deliveries,
    bindings: definitionSet.bindings,
    sourceConfigsById: definitionSet.sourceConfigsById,
  }
}
```

- [ ] **Step 5: Re-run the compiler/bridge tests**

Run:

```bash
deno task test src/definitions/compile_definitions_test.ts src/interfaces/config/load_definitions_test.ts src/interfaces/runtime_definition_consistency_test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the compiler bridge**

```bash
git add src/definitions/definition_set.ts src/definitions/compile_definitions.ts src/definitions/compile_definitions_test.ts src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts src/interfaces/runtime_definition_consistency_test.ts
git commit -m "refactor(definitions): introduce definition set compiler"
```

---

### Task 3: Make collect/execute/preview explicit and remove execute degradation

**Files:**

- Create: `src/application/collect_source_use_case.ts`
- Create: `src/application/collect_source_use_case_test.ts`
- Create: `src/application/execute_run_use_case.ts`
- Create: `src/application/execute_run_use_case_test.ts`
- Create: `src/application/preview_run_use_case.ts`
- Create: `src/application/preview_run_use_case_test.ts`
- Modify: `src/application/run_source_use_case.ts`
- Test: `src/application/run_source_use_case_test.ts`
- Modify: `src/application/preview_source_use_case.ts`
- Modify: `src/interfaces/create_source_execution_core_test.ts`

- [ ] **Step 1: Replace the “execute degrades to collect” contract with explicit-use-case tests**

```ts
// src/application/run_source_use_case_test.ts
import { assertRejects } from '@std/assert'

Deno.test(
  '[contract] runSourceUseCase: 缺 pipeline deps 时 execute 应失败',
  async () => {
    const useCase = new RunSourceUseCase({
      now: () => '2026-04-17T12:10:00.000Z',
      createRunId: () => 'run-missing-pipeline',
      sourceInputGateway: {
        fetch: () =>
          Promise.resolve({
            kind: 'fetch',
            collectedAt: '2026-04-17T12:10:01.000Z',
            payloadSummary: { hash: 'hash-1' },
          }),
      },
      sourceParser: {
        parse: () =>
          Promise.resolve({
            sourceKind: 'fetch',
            parser: 'rss',
            diagnostics: [],
            feed: {
              title: '',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          }),
      },
    })

    await assertRejects(
      () =>
        useCase.execute({
          source: {
            kind: 'fetch',
            sourceId: 'rust',
            fetcher: 'http',
            parser: 'syndication',
          },
          profile: 'production',
          effectDomain: 'production',
          trigger: 'immediate',
        }),
      Error,
      'run source execute 缺少完整 pipeline 依赖',
    )
  },
)
```

```ts
// src/application/collect_source_use_case_test.ts
import { assertEquals } from '@std/assert'
import { CollectSourceUseCase } from './collect_source_use_case.ts'

Deno.test(
  '[contract] collectSourceUseCase: collect-only 应显式走 collect',
  async () => {
    const calls: string[] = []
    const useCase = new CollectSourceUseCase({
      runSourceUseCase: {
        collect: (input) => {
          calls.push(input.trigger)
          return Promise.resolve({
            plan: {
              runId: 'run-preview-collect',
              source: input.source,
              profile: input.profile,
              effectDomain: input.effectDomain,
              trigger: input.trigger,
              scheduledAt: '2026-04-17T12:15:00.000Z',
              bindings: input.bindings ?? [],
            },
            fetchedInput: {
              kind: input.source.kind,
              collectedAt: '2026-04-17T12:15:00.000Z',
              payloadSummary: { hash: 'hash-preview' },
            },
            parsed: {
              sourceKind: input.source.kind,
              parser: 'rss',
              diagnostics: [],
              feed: {
                title: '',
                link: '',
                description: '',
                generator: '',
                language: '',
                published: '',
              },
              items: [],
            },
          })
        },
      },
    })

    await useCase.execute({
      source: {
        kind: 'fetch',
        sourceId: 'playground',
        fetcher: 'http',
        parser: 'syndication',
      },
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
    })

    assertEquals(calls, ['preview'])
  },
)
```

```ts
// src/interfaces/create_source_execution_core_test.ts
import { assertRejects } from '@std/assert'

Deno.test(
  '[contract] createRunSourceUseCaseForRuntime: preview execute 缺少 pipeline deps 时也应失败',
  async () => {
    const useCase = createRunSourceUseCaseForRuntime({
      now: () => '2026-04-17T12:20:00.000Z',
      createRunId: () => 'run-preview-missing-pipeline',
      sourceInputGateway: {
        fetch: () =>
          Promise.resolve({
            kind: 'fetch',
            collectedAt: '2026-04-17T12:20:01.000Z',
            payloadSummary: { hash: 'hash-preview' },
          }),
      },
      sourceParser: {
        parse: () =>
          Promise.resolve({
            sourceKind: 'fetch',
            parser: 'rss',
            diagnostics: [],
            feed: {
              title: '',
              link: '',
              description: '',
              generator: '',
              language: '',
              published: '',
            },
            items: [],
          }),
      },
    })

    await assertRejects(
      () =>
        useCase.execute({
          source: {
            kind: 'fetch',
            sourceId: 'playground',
            fetcher: 'http',
            parser: 'syndication',
          },
          profile: 'preview',
          effectDomain: 'preview',
          trigger: 'preview',
        }),
      Error,
      'run source execute 缺少完整 pipeline 依赖',
    )
  },
)
```

- [ ] **Step 2: Run the explicit-boundary tests and verify they fail**

Run:

```bash
deno task test src/application/run_source_use_case_test.ts src/application/collect_source_use_case_test.ts src/interfaces/create_source_execution_core_test.ts
```

Expected: FAIL because `execute()` still returns collect-only success and the explicit use case files do not exist.

- [ ] **Step 3: Add explicit collect/execute/preview wrappers**

```ts
// src/application/collect_source_use_case.ts
import type {
  RunSourceRequest,
  RunSourceResult,
  RunSourceUseCase,
} from './run_source_use_case.ts'

export class CollectSourceUseCase {
  constructor(
    private readonly deps: {
      runSourceUseCase: Pick<RunSourceUseCase, 'collect'>
    },
  ) {}

  execute(input: RunSourceRequest): Promise<RunSourceResult> {
    return this.deps.runSourceUseCase.collect(input)
  }
}
```

```ts
// src/application/execute_run_use_case.ts
import type {
  RunSourceRequest,
  RunSourceResult,
  RunSourceUseCase,
} from './run_source_use_case.ts'

export class ExecuteRunUseCase {
  constructor(
    private readonly deps: {
      runSourceUseCase: Pick<RunSourceUseCase, 'execute'>
    },
  ) {}

  execute(input: RunSourceRequest): Promise<RunSourceResult> {
    return this.deps.runSourceUseCase.execute(input)
  }
}
```

```ts
// src/application/preview_run_use_case.ts
import type { PreviewSourceRequest } from './preview_source_use_case.ts'
import type {
  RunSourceResult,
  RunSourceUseCase,
} from './run_source_use_case.ts'

export class PreviewRunUseCase {
  constructor(
    private readonly deps: {
      runSourceUseCase: Pick<RunSourceUseCase, 'execute'>
    },
  ) {}

  execute(input: PreviewSourceRequest): Promise<RunSourceResult> {
    return this.deps.runSourceUseCase.execute({
      source: input.source,
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
      bindings: input.bindings,
      scheduledAt: input.scheduledAt,
    })
  }
}
```

- [ ] **Step 4: Remove implicit execute degradation**

```ts
// src/application/run_source_use_case.ts
async execute(input: RunSourceRequest): Promise<RunSourceResult> {
  const plan = await this.plan(input)
  const lifecycleCounts = {
    sourceItemCount: 0,
    filteredCount: 0,
    dedupedCount: 0,
    pushedCount: 0,
    failedCount: 0,
  }

  this.logRunStart(plan)

  try {
    const collected = await this.collectPlanned(plan)
    lifecycleCounts.sourceItemCount = collected.parsed.items.length

    const pipelineDeps = this.getPipelineDeps()
    if (!pipelineDeps) {
      throw new Error('run source execute 缺少完整 pipeline 依赖')
    }

    await this.applyCollected(collected, pipelineDeps, lifecycleCounts)
    this.logRunFinalize(plan, 'success', lifecycleCounts)
    return collected
  } catch (error) {
    this.logRunFinalize(plan, 'failure', lifecycleCounts)
    throw error
  }
}
```

```ts
// src/application/preview_source_use_case.ts
export class PreviewSourceUseCase {
  constructor(private readonly deps: PreviewSourceUseCaseDeps) {}

  async plan(input: PreviewSourceRequest) {
    return await this.deps.runSourceUseCase.plan({
      source: input.source,
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
      bindings: input.bindings,
      scheduledAt: input.scheduledAt,
    })
  }

  async collect(input: PreviewSourceRequest): Promise<RunSourceResult> {
    return await this.deps.runSourceUseCase.collect({
      source: input.source,
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
      bindings: input.bindings,
      scheduledAt: input.scheduledAt,
    })
  }

  async execute(input: PreviewSourceRequest): Promise<RunSourceResult> {
    return await this.deps.runSourceUseCase.execute({
      source: input.source,
      profile: 'preview',
      effectDomain: 'preview',
      trigger: 'preview',
      bindings: input.bindings,
      scheduledAt: input.scheduledAt,
    })
  }
}
```

- [ ] **Step 5: Re-run the explicit-boundary tests**

Run:

```bash
deno task test src/application/run_source_use_case_test.ts src/application/collect_source_use_case_test.ts src/interfaces/create_source_execution_core_test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the explicit execution boundary**

```bash
git add src/application/collect_source_use_case.ts src/application/collect_source_use_case_test.ts src/application/execute_run_use_case.ts src/application/execute_run_use_case_test.ts src/application/preview_run_use_case.ts src/application/preview_run_use_case_test.ts src/application/run_source_use_case.ts src/application/run_source_use_case_test.ts src/application/preview_source_use_case.ts src/interfaces/create_source_execution_core_test.ts
git commit -m "refactor(application): make collect and execute explicit"
```

---

### Task 4: Extract `composition/` and make `RunDueSourcesUseCase` the single due-source truth

**Files:**

- Create: `src/composition/create_runtime_kernel.ts`
- Test: `src/composition/create_runtime_kernel_test.ts`
- Create: `src/composition/create_production_runtime.ts`
- Test: `src/composition/create_production_runtime_test.ts`
- Modify: `src/application/run_due_sources_use_case.ts`
- Modify: `src/interfaces/daemon/create_daemon_runtime.ts`
- Test: `src/interfaces/daemon/start_daemon_test.ts`
- Test: `src/interfaces/runtime_definition_consistency_test.ts`

- [ ] **Step 1: Write the failing kernel/delegation tests**

```ts
// src/composition/create_production_runtime_test.ts
import { assertEquals } from '@std/assert'
import { createProductionRuntime } from './create_production_runtime.ts'

Deno.test(
  '[contract] production composition: runImmediate 应经由 RunDueSourcesUseCase',
  async () => {
    const calls: Array<Record<string, string>> = []
    const runtime = createProductionRuntime({
      runDueSourcesUseCase: {
        execute: (command) => {
          calls.push(command as Record<string, string>)
          return Promise.resolve([])
        },
      },
      now: () => '2026-04-17T12:30:00.000Z',
      keepAlive: false,
    })

    await runtime.runImmediate()

    assertEquals(calls, [
      { trigger: 'immediate', scheduledAt: '2026-04-17T12:30:00.000Z' },
    ])
  },
)
```

```ts
// src/interfaces/daemon/start_daemon_test.ts
Deno.test(
  '[flow] daemon runtime: cron tick 应只调用 RunDueSourcesUseCase',
  async () => {
    const calls: string[] = []

    const result = await startDaemon({
      runDueSourcesUseCase: {
        execute: () => {
          calls.push('run-due-sources')
          return Promise.resolve([])
        },
      },
    })

    assertEquals(result.mode, 'daemon')
    assertEquals(calls, ['run-due-sources'])
  },
)
```

- [ ] **Step 2: Run the kernel/delegation tests and verify failure**

Run:

```bash
deno task test src/composition/create_runtime_kernel_test.ts src/composition/create_production_runtime_test.ts src/interfaces/daemon/start_daemon_test.ts src/interfaces/runtime_definition_consistency_test.ts
```

Expected: FAIL because the composition files do not exist and daemon still holds due-source execution details.

- [ ] **Step 3: Extend `RunDueSourcesUseCase` to accept explicit execution commands**

```ts
// src/application/run_due_sources_use_case.ts
export interface RunDueSourcesCommand {
  trigger: 'scheduled' | 'immediate' | 'manual'
  scheduledAt?: string
  sourceId?: string
}

export class RunDueSourcesUseCase {
  constructor(private readonly deps: RunDueSourcesUseCaseDeps) {}

  async execute(
    command: RunDueSourcesCommand = { trigger: 'scheduled' },
  ): Promise<RunSourceResult[]> {
    const scheduledAt = command.scheduledAt ?? this.deps.now()
    const selected = command.sourceId
      ? await this.deps.sourceQueryService.getSource(command.sourceId)
      : undefined

    const dueSources = selected
      ? [
          {
            source: selected,
            bindings: await this.deps.sourceQueryService.getBindings(
              command.sourceId!,
            ),
          },
        ]
      : await this.deps.sourceQueryService.listDueSources(scheduledAt)

    const results: RunSourceResult[] = []
    for (const dueSource of dueSources) {
      results.push(
        await this.deps.runSourceUseCase.execute({
          source: dueSource.source,
          profile: 'production',
          effectDomain: 'production',
          trigger: command.trigger,
          scheduledAt,
          bindings: dueSource.bindings,
        }),
      )
    }
    return results
  }
}
```

- [ ] **Step 4: Create the runtime kernel and make daemon a thin interface**

```ts
// src/composition/create_runtime_kernel.ts
import type nodemailer from 'nodemailer'
import type { AppConfigResolved } from '../config/types.ts'
import type { DefinitionSet } from '../definitions/definition_set.ts'
import type { FactsDbClient } from '../db/client.ts'
import { createFactsDbClient } from '../db/client.ts'
import {
  createSourceRuntimeSharedDeps,
  createRuntimePipeline,
  createRuntimeSourceInputGateway,
  createRunSourceUseCaseForRuntime,
} from '../interfaces/create_source_execution_core.ts'
import { createFileDeliveryExecutor } from '../infrastructure/deliveries/file_delivery_executor.ts'
import { createHttpDeliveryExecutor } from '../infrastructure/deliveries/http_delivery_executor.ts'
import { createEmailDeliveryExecutor } from '../infrastructure/deliveries/email_delivery_executor.ts'
import { createEmailDelivery } from '../deliveries/email.ts'

export function createRuntimeKernel(input: {
  config: AppConfigResolved
  definitions: DefinitionSet
  factsDb?: FactsDbClient
  fetcher?: typeof fetch
  proxyClientFactory?: typeof Deno.createHttpClient
  emailTransportFactory?: typeof nodemailer.createTransport
  now?: () => string
}) {
  const factsDb =
    input.factsDb ?? createFactsDbClient({ sqlite: input.config.sqlite })
  const shared = createSourceRuntimeSharedDeps({
    config: input.config,
    factsDb,
    sourceConfigsById: input.definitions.sourceConfigsById,
    fetcher: input.fetcher ?? fetch,
    proxyClientFactory: input.proxyClientFactory ?? Deno.createHttpClient,
  })
  const runSourceUseCase = createRunSourceUseCaseForRuntime({
    requireFullPipeline: true,
    now: input.now ?? (() => new Date().toISOString()),
    createRunId: () => crypto.randomUUID(),
    sourceInputGateway: createRuntimeSourceInputGateway(shared),
    sourceParser: shared.sourceParser,
    pipeline: createRuntimePipeline({
      factsDb,
      deliveryExecutors: {
        file: createFileDeliveryExecutor({
          runtimeDir: input.config.runtimeDir,
        }),
        push: createHttpDeliveryExecutor({ httpClient: shared.httpClient }),
        email: createEmailDeliveryExecutor({
          delivery: createEmailDelivery({
            createTransport: input.emailTransportFactory,
          }),
        }),
      },
    }),
    renderContent: (template, context) =>
      shared.contentRuntime.renderContent(template, context),
    renderPayload: (payload, context) =>
      shared.contentRuntime.renderPayload(payload, context),
  })

  return {
    factsDb,
    shared,
    runSourceUseCase,
  }
}
```

```ts
// src/composition/create_production_runtime.ts
import type { RunDueSourcesUseCase } from '../application/run_due_sources_use_case.ts'

export function createProductionRuntime(input: {
  runDueSourcesUseCase: Pick<RunDueSourcesUseCase, 'execute'>
  now?: () => string
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
}) {
  const now = input.now ?? (() => new Date().toISOString())

  return {
    async runImmediate() {
      await input.runDueSourcesUseCase.execute({
        trigger: 'immediate',
        scheduledAt: now(),
      })
    },
    async enterDaemon() {
      await input.runDueSourcesUseCase.execute({
        trigger: 'scheduled',
        scheduledAt: now(),
      })
      if (input.keepAlive ?? true) {
        await (input.keepAliveSignal ?? new Promise(() => {}))
      }
    },
  }
}
```

```ts
// src/interfaces/daemon/create_daemon_runtime.ts
import { compileDefinitionsFromResolvedConfig } from '../../definitions/compile_definitions.ts'
import { createRuntimeKernel } from '../../composition/create_runtime_kernel.ts'
import { createProductionRuntime } from '../../composition/create_production_runtime.ts'

export function createDaemonRuntime(
  options: CreateDaemonRuntimeOptions,
): DaemonRuntime {
  const definitions = compileDefinitionsFromResolvedConfig(options.config)
  const kernel = createRuntimeKernel({
    config: options.config,
    definitions,
    fetcher: options.httpFetcher,
    proxyClientFactory: options.httpProxyClientFactory,
    emailTransportFactory: options.emailTransportFactory,
  })
  const sourceQueryService = createSourceQueryService(options.config)
  const runDueSourcesUseCase = new RunDueSourcesUseCase({
    now: () => new Date().toISOString(),
    sourceQueryService,
    runSourceUseCase: kernel.runSourceUseCase,
  })
  const production = createProductionRuntime({
    runDueSourcesUseCase,
    keepAlive: options.keepAlive,
    keepAliveSignal: options.keepAliveSignal,
  })

  return {
    runDueSourcesUseCase,
    recoverInterruptedAttempts: () =>
      markInterruptedAttempts(kernel.factsDb, new Date().toISOString()),
    runImmediate: production.runImmediate,
    enterDaemon: production.enterDaemon,
    stop() {
      kernel.factsDb.$client.close()
    },
  }
}
```

- [ ] **Step 5: Re-run the kernel/delegation tests**

Run:

```bash
deno task test src/composition/create_runtime_kernel_test.ts src/composition/create_production_runtime_test.ts src/interfaces/daemon/start_daemon_test.ts src/interfaces/runtime_definition_consistency_test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the new production composition**

```bash
git add src/composition/create_runtime_kernel.ts src/composition/create_runtime_kernel_test.ts src/composition/create_production_runtime.ts src/composition/create_production_runtime_test.ts src/application/run_due_sources_use_case.ts src/interfaces/daemon/create_daemon_runtime.ts src/interfaces/daemon/start_daemon_test.ts src/interfaces/runtime_definition_consistency_test.ts
git commit -m "refactor(composition): centralize production runtime"
```

---

### Task 5: Formalize `QueryRuns` over SQLite facts

**Files:**

- Create: `src/application/ports/source_run_query_service.ts`
- Create: `src/application/query_runs_use_case.ts`
- Test: `src/application/query_runs_use_case_test.ts`
- Modify: `src/infrastructure/sqlite/source_run_query_service.ts`
- Test: `src/infrastructure/sqlite/source_run_query_service_test.ts`

- [ ] **Step 1: Write the failing query use case test**

```ts
// src/application/query_runs_use_case_test.ts
import { assertEquals } from '@std/assert'
import { QueryRunsUseCase } from './query_runs_use_case.ts'

Deno.test(
  '[contract] queryRunsUseCase: 应返回 run + items + attempts 的最小视图',
  async () => {
    const useCase = new QueryRunsUseCase({
      sourceRunQueryService: {
        getRun: () =>
          Promise.resolve({
            run: {
              runId: 'run-1',
              sourceId: 'rust',
              trigger: 'scheduled',
              profile: 'production',
              effectDomain: 'production',
              status: 'success',
              scheduledAt: '2026-04-17T12:40:00.000Z',
              startedAt: '2026-04-17T12:40:01.000Z',
              finishedAt: '2026-04-17T12:40:02.000Z',
              counts: {
                fetchedCount: 1,
                parsedCount: 1,
                filteredCount: 0,
                duplicateItemCount: 0,
                deliveredCount: 1,
                failedAttemptCount: 0,
                skippedCount: 0,
              },
            },
            items: [],
            attempts: [],
          }),
      },
    })

    const view = await useCase.getRun('run-1')
    assertEquals(view?.run.runId, 'run-1')
    assertEquals(view?.run.status, 'success')
  },
)
```

- [ ] **Step 2: Run the query tests and verify failure**

Run:

```bash
deno task test src/application/query_runs_use_case_test.ts src/infrastructure/sqlite/source_run_query_service_test.ts
```

Expected: FAIL because the port and use case files do not exist.

- [ ] **Step 3: Add the query port and use case**

```ts
// src/application/ports/source_run_query_service.ts
import type { SourceRunView } from '../query_runs_use_case.ts'

export interface SourceRunQueryService {
  getRun(runId: string): Promise<SourceRunView | undefined>
}
```

```ts
// src/application/query_runs_use_case.ts
import type { SourceRun } from '../domain/source_run.ts'
import type { PipelineItem } from '../domain/pipeline_item.ts'
import type { DeliveryAttempt } from '../domain/delivery_attempt.ts'
import type { SourceRunQueryService } from './ports/source_run_query_service.ts'

export interface SourceRunView {
  run: SourceRun
  items: PipelineItem[]
  attempts: DeliveryAttempt[]
}

export class QueryRunsUseCase {
  constructor(
    private readonly deps: { sourceRunQueryService: SourceRunQueryService },
  ) {}

  getRun(runId: string): Promise<SourceRunView | undefined> {
    return this.deps.sourceRunQueryService.getRun(runId)
  }
}
```

- [ ] **Step 4: Type the SQLite query service against the new port**

```ts
// src/infrastructure/sqlite/source_run_query_service.ts
import type { SourceRunQueryService } from '../../application/ports/source_run_query_service.ts'

export function createSourceRunQueryService(
  db: FactsDbClient,
): SourceRunQueryService {
  return {
    getRun(runId: string): Promise<SourceRunView | undefined> {
      try {
        const runRow = db
          .select()
          .from(sourceRuns)
          .where(eq(sourceRuns.runId, runId))
          .get()
        if (!runRow) return Promise.resolve(undefined)

        const itemRows = db
          .select()
          .from(pipelineItems)
          .where(eq(pipelineItems.sourceRunId, runId))
          .orderBy(asc(pipelineItems.itemId))
          .all()
        const attemptRows = db
          .select()
          .from(deliveryAttempts)
          .where(eq(deliveryAttempts.sourceRunId, runId))
          .orderBy(
            asc(deliveryAttempts.plannedAt),
            asc(deliveryAttempts.attemptId),
          )
          .all()

        return Promise.resolve({
          run: toSourceRun(runRow),
          items: itemRows.map(toPipelineItem),
          attempts: attemptRows.map(toDeliveryAttempt),
        })
      } catch (error) {
        return Promise.reject(error)
      }
    },
  }
}
```

- [ ] **Step 5: Re-run the query tests**

Run:

```bash
deno task test src/application/query_runs_use_case_test.ts src/infrastructure/sqlite/source_run_query_service_test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the query layer**

```bash
git add src/application/ports/source_run_query_service.ts src/application/query_runs_use_case.ts src/application/query_runs_use_case_test.ts src/infrastructure/sqlite/source_run_query_service.ts src/infrastructure/sqlite/source_run_query_service_test.ts
git commit -m "feat(query): add query runs use case"
```

---

### Task 6: Add `PruneFacts` and cut over retention to facts + deduplications

**Files:**

- Create: `src/application/ports/prune_facts_repository.ts`
- Create: `src/application/prune_facts_use_case.ts`
- Test: `src/application/prune_facts_use_case_test.ts`
- Create: `src/infrastructure/sqlite/prune_facts_repository.ts`
- Test: `src/infrastructure/sqlite/prune_facts_repository_test.ts`
- Modify: `src/infrastructure/sqlite/schema_test.ts`
- Modify: `src/infrastructure/sqlite/recovery_test.ts`
- Modify: `src/infrastructure/sqlite/schema.ts`

- [ ] **Step 1: Write the failing prune/schema tests**

```ts
// src/application/prune_facts_use_case_test.ts
import { assertEquals } from '@std/assert'
import { PruneFactsUseCase } from './prune_facts_use_case.ts'

Deno.test(
  '[contract] pruneFactsUseCase: 应转发 retention 参数到 repository',
  async () => {
    const calls: Array<Record<string, unknown>> = []
    const useCase = new PruneFactsUseCase({
      now: () => '2026-04-17T12:45:00.000Z',
      pruneFactsRepository: {
        prune: (input) => {
          calls.push(input)
          return Promise.resolve({
            deletedRuns: 2,
            deletedItems: 4,
            deletedAttempts: 4,
            deletedDeduplications: 3,
          })
        },
      },
    })

    const result = await useCase.execute({
      maxAge: '30d',
      maxEntriesPerSource: 1000,
    })

    assertEquals(result.deletedRuns, 2)
    assertEquals(calls[0]?.maxAge, '30d')
  },
)
```

```ts
// src/infrastructure/sqlite/schema_test.ts
import { assertEquals } from '@std/assert'
import { createInMemoryDb } from '../../db/client.ts'

Deno.test(
  '[contract] sqlite schema: facts schema 应包含主事实表和 deduplications 辅助表',
  () => {
    const db = createInMemoryDb()
    const tables = db.$client
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      )
      .all()
      .map((row) => String((row as { name: string }).name))

    assertEquals(
      tables.filter((name) => !name.startsWith('sqlite_')).sort(),
      [
        'deduplications',
        'delivery_attempts',
        'pipeline_items',
        'source_runs',
      ].sort(),
    )
  },
)
```

- [ ] **Step 2: Run the prune/schema tests and verify failure**

Run:

```bash
deno task test src/application/prune_facts_use_case_test.ts src/infrastructure/sqlite/prune_facts_repository_test.ts src/infrastructure/sqlite/schema_test.ts src/infrastructure/sqlite/recovery_test.ts
```

Expected: FAIL because the prune port/repository files do not exist and the schema contract still only describes the current partial retention story.

- [ ] **Step 3: Add the prune port and use case**

```ts
// src/application/ports/prune_facts_repository.ts
export interface PruneFactsResult {
  deletedRuns: number
  deletedItems: number
  deletedAttempts: number
  deletedDeduplications: number
}

export interface PruneFactsRepository {
  prune(input: {
    now: string
    maxAge: string
    maxEntriesPerSource: number
  }): Promise<PruneFactsResult>
}
```

```ts
// src/application/prune_facts_use_case.ts
import type {
  PruneFactsRepository,
  PruneFactsResult,
} from './ports/prune_facts_repository.ts'

export class PruneFactsUseCase {
  constructor(
    private readonly deps: {
      now: () => string
      pruneFactsRepository: PruneFactsRepository
    },
  ) {}

  execute(input: {
    maxAge: string
    maxEntriesPerSource: number
  }): Promise<PruneFactsResult> {
    return this.deps.pruneFactsRepository.prune({
      now: this.deps.now(),
      maxAge: input.maxAge,
      maxEntriesPerSource: input.maxEntriesPerSource,
    })
  }
}
```

- [ ] **Step 4: Implement the SQLite prune repository over facts + deduplications**

```ts
// src/infrastructure/sqlite/prune_facts_repository.ts
import type { FactsDbClient } from '../../db/client.ts'
import { parseDurationMs } from '../../config/runtime_semantics.ts'
import type { PruneFactsRepository } from '../../application/ports/prune_facts_repository.ts'

function toRunIds(rows: unknown[]): string[] {
  return rows.map((row) => String((row as { runId: string }).runId))
}

export function createPruneFactsRepository(
  db: FactsDbClient,
): PruneFactsRepository {
  return {
    async prune(input) {
      const cutoff = new Date(
        Date.parse(input.now) -
          parseDurationMs(input.maxAge, 'sqlite.retention.maxAge'),
      ).toISOString()

      const agedRunIds = toRunIds(
        db.$client
          .prepare(
            `
            SELECT run_id AS runId
            FROM source_runs
            WHERE finished_at IS NOT NULL
              AND finished_at < ?
          `,
          )
          .all(cutoff),
      )

      const cappedRunIds = toRunIds(
        db.$client
          .prepare(
            `
            WITH ranked AS (
              SELECT
                run_id AS runId,
                ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY started_at DESC) AS rn
              FROM source_runs
              WHERE finished_at IS NOT NULL
            )
            SELECT runId
            FROM ranked
            WHERE rn > ?
          `,
          )
          .all(input.maxEntriesPerSource),
      )

      const runIds = [...new Set([...agedRunIds, ...cappedRunIds])]
      if (runIds.length === 0) {
        const deletedDeduplications = db.$client
          .prepare(`DELETE FROM deduplications WHERE recorded_at < ?`)
          .run(cutoff).changes
        return {
          deletedRuns: 0,
          deletedItems: 0,
          deletedAttempts: 0,
          deletedDeduplications,
        }
      }

      let deletedAttempts = 0
      let deletedItems = 0
      let deletedRuns = 0
      for (const runId of runIds) {
        deletedAttempts += db.$client
          .prepare(`DELETE FROM delivery_attempts WHERE source_run_id = ?`)
          .run(runId).changes
        deletedItems += db.$client
          .prepare(`DELETE FROM pipeline_items WHERE source_run_id = ?`)
          .run(runId).changes
        deletedRuns += db.$client
          .prepare(`DELETE FROM source_runs WHERE run_id = ?`)
          .run(runId).changes
      }
      const deletedDeduplications = db.$client
        .prepare(`DELETE FROM deduplications WHERE recorded_at < ?`)
        .run(cutoff).changes

      return {
        deletedRuns,
        deletedItems,
        deletedAttempts,
        deletedDeduplications,
      }
    },
  }
}
```

- [ ] **Step 5: Re-run the prune/schema tests**

Run:

```bash
deno task test src/application/prune_facts_use_case_test.ts src/infrastructure/sqlite/prune_facts_repository_test.ts src/infrastructure/sqlite/schema_test.ts src/infrastructure/sqlite/recovery_test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the prune/cutover repository work**

```bash
git add src/application/ports/prune_facts_repository.ts src/application/prune_facts_use_case.ts src/application/prune_facts_use_case_test.ts src/infrastructure/sqlite/prune_facts_repository.ts src/infrastructure/sqlite/prune_facts_repository_test.ts src/infrastructure/sqlite/schema.ts src/infrastructure/sqlite/schema_test.ts src/infrastructure/sqlite/recovery_test.ts
git commit -m "feat(facts): add prune facts use case"
```

---

### Task 7: Route startup through command objects and delete transitional layers

**Files:**

- Create: `src/interfaces/cli/parse_cli_command.ts`
- Test: `src/interfaces/cli/parse_cli_command_test.ts`
- Modify: `src/main.ts`
- Test: `src/main_test.ts`
- Modify: `src/config/types.ts`
- Modify: `src/interfaces/create_source_execution_core.ts`
- Delete: `src/interfaces/create_source_execution_core.ts`
- Modify: `src/core/app.ts`
- Delete: `src/core/app.ts`
- Modify: `README.md`
- Modify: `config.example.yml`
- Modify: `deno.json`

- [ ] **Step 1: Write the failing command-object tests**

```ts
// src/interfaces/cli/parse_cli_command_test.ts
import { assertEquals } from '@std/assert'
import { parseCliCommand } from './parse_cli_command.ts'

Deno.test(
  '[contract] parseCliCommand: 应把 flags 解析成显式 daemon 命令对象',
  () => {
    assertEquals(
      parseCliCommand([
        '--mode',
        'daemon',
        '--config',
        '/tmp/config.yml',
        '--runtime_dir',
        '/tmp/runtime',
      ]),
      {
        kind: 'daemon',
        configPath: '/tmp/config.yml',
        runtimeDir: '/tmp/runtime',
        immediate: false,
      },
    )
  },
)
```

```ts
// src/main_test.ts
import { assertEquals } from '@std/assert'
import { parseCliCommand } from './interfaces/cli/parse_cli_command.ts'

Deno.test('[contract] main: 应通过 command object 分发入口', () => {
  const command = parseCliCommand([
    '--mode',
    'web',
    '--web_host',
    '127.0.0.1',
    '--web_port',
    '8080',
  ])
  assertEquals(command.kind, 'web')
})
```

- [ ] **Step 2: Run the CLI/startup tests and verify failure**

Run:

```bash
deno task test src/interfaces/cli/parse_cli_command_test.ts src/main_test.ts
```

Expected: FAIL because `parse_cli_command.ts` does not exist.

- [ ] **Step 3: Introduce command objects and move parsing out of `src/main.ts`**

```ts
// src/interfaces/cli/parse_cli_command.ts
import { parseArgs } from 'node:util'

export type CliCommand =
  | {
      kind: 'daemon'
      configPath?: string
      runtimeDir?: string
      immediate: boolean
    }
  | { kind: 'web'; host: string; port: number }
  | {
      kind: 'all'
      configPath?: string
      runtimeDir?: string
      immediate: boolean
      host: string
      port: number
    }

function parseWebPort(value: string | undefined): number {
  return Number(value ?? '8000')
}

export function parseCliCommand(args: string[]): CliCommand {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      mode: { type: 'string' },
      config: { type: 'string' },
      runtime_dir: { type: 'string' },
      immediate: { type: 'boolean' },
      web_host: { type: 'string' },
      web_port: { type: 'string' },
    },
  })

  const mode = values.mode ?? 'all'
  if (mode === 'daemon') {
    return {
      kind: 'daemon',
      configPath: values.config,
      runtimeDir: values.runtime_dir,
      immediate: values.immediate ?? false,
    }
  }
  if (mode === 'web') {
    return {
      kind: 'web',
      host: values.web_host ?? '127.0.0.1',
      port: parseWebPort(values.web_port),
    }
  }
  return {
    kind: 'all',
    configPath: values.config,
    runtimeDir: values.runtime_dir,
    immediate: values.immediate ?? false,
    host: values.web_host ?? '127.0.0.1',
    port: parseWebPort(values.web_port),
  }
}
```

```ts
// src/main.ts
import { parseCliCommand } from './interfaces/cli/parse_cli_command.ts'

export async function main(args: string[]): Promise<void> {
  const command = parseCliCommand(args)

  if (command.kind === 'daemon') {
    const { startApp } = await import('./core/app.ts')
    await startApp({
      configPath: command.configPath,
      runtimeDir: command.runtimeDir,
      immediate: command.immediate,
    })
    return
  }

  if (command.kind === 'web') {
    await startWeb({
      host: command.host,
      port: command.port,
    })
    return
  }

  await runAllModes({
    mode: 'all',
    configPath: command.configPath,
    runtimeDir: command.runtimeDir,
    immediate: command.immediate,
    webHost: command.host,
    webPort: command.port,
  })
}

if (import.meta.main) {
  await main(Deno.args)
}
```

```ts
// src/config/types.ts
export interface ConfigDocument {
  language?: string
  timezone?: string
  timestampFormat?: string
  sqlite?: {
    path?: string
    busyTimeout?: string
    journalMode?: SqliteJournalMode
    retention?: {
      maxAge?: string
      maxEntriesPerSource?: number
      vacuum?: SqliteRetentionVacuumMode
    }
  }
  deliveries?: Record<string, DeliveryConfigInput>
  sources?: Record<string, SourceConfigInput>
}
```

- [ ] **Step 4: Delete the transitional startup helpers after callers are moved**

```ts
// src/core/app.ts
export { main as startApp } from '../main.ts'
```

```bash
rm src/interfaces/create_source_execution_core.ts
rm src/core/app.ts
```

- [ ] **Step 5: Run final verification**

Run:

```bash
deno task test src/infrastructure/deliveries/capture_delivery_executor_test.ts src/composition/create_preview_runtime_test.ts src/definitions/compile_definitions_test.ts src/application/run_source_use_case_test.ts src/application/collect_source_use_case_test.ts src/composition/create_runtime_kernel_test.ts src/composition/create_production_runtime_test.ts src/application/query_runs_use_case_test.ts src/application/prune_facts_use_case_test.ts src/infrastructure/sqlite/source_run_query_service_test.ts src/infrastructure/sqlite/prune_facts_repository_test.ts src/interfaces/runtime_definition_consistency_test.ts src/interfaces/daemon/start_daemon_test.ts src/interfaces/web/preview_runtime_test.ts src/interfaces/cli/parse_cli_command_test.ts src/main_test.ts web/routes/api/xquery/evaluate_test.ts web/routes/api/syndication/evaluate_test.ts && deno task check src main.ts web && deno task lint:check src web main.ts && deno task fmt:check src web main.ts docs/superpowers/specs/2026-04-17-knock-final-rewrite-design.md docs/superpowers/plans/2026-04-17-knock-final-rewrite-implementation.md && deno task test
```

Expected: PASS

- [ ] **Step 6: Commit the startup cutover and cleanup**

```bash
git add src/interfaces/cli/parse_cli_command.ts src/interfaces/cli/parse_cli_command_test.ts src/main.ts src/main_test.ts src/config/types.ts README.md config.example.yml deno.json
git add -u src/interfaces/create_source_execution_core.ts src/core/app.ts
git commit -m "refactor(startup): route cli through command objects"
```

---

## Self-check before execution

1. **Preview safety first:** Task 1 必须先完成，且 preview/playground 必须被 capture sink tests 锁住。
2. **Single compiler input:** Task 2 后，新的 `DefinitionSet` 成为所有 composition 的唯一输入。
3. **No implicit degrade:** Task 3 后，`execute()` 只能 full pipeline；collect-only 只能显式走 `CollectSourceUseCase`。
4. **Single due-source truth:** Task 4 后，daemon 只能经由 `RunDueSourcesUseCase` 执行 due sources。
5. **Query contract locked:** Task 5 后，CLI/web/debug 至少能稳定拿到 `getRun(runId)` 视图。
6. **Facts retention explicit:** Task 6 后，retention/prune 明确作用于 `source_runs` / `pipeline_items` / `delivery_attempts`，并单独处理 `deduplications` 辅助表。
7. **Cutover complete:** Task 7 后，不再保留 `src/interfaces/create_source_execution_core.ts` 与 `src/core/app.ts` 这类过渡装配层。

## Verification matrix

- Task 1: preview/capture/web response schema
- Task 2: compiler + definitions bridge
- Task 3: collect/execute explicit boundary
- Task 4: composition + daemon delegation
- Task 5: query use case + SQLite query contract
- Task 6: prune use case + schema/recovery retention contract
- Task 7: CLI/startup cutover + full suite
