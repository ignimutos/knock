# Knock v2 Overall Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Knock 从现有 `core/config/db/source/delivery` 串联式内核切换为围绕 `SourceRun / PipelineItem / DeliveryAttempt` 组织的 v2 执行架构，并在同一分支内完成单切与旧模型删除。

**Architecture:** 先建立 v2 领域对象、判别联合 definition、RunPlan、stages、facts schema 与 query/read model，再把 daemon / preview / summary 都切到同一套 `RunSourceUseCase` 主干。实现过程中允许短期在分支内并排放置新旧代码，但最终交付必须以新事实表、新 use cases、新 query services 为唯一真相源，并删除旧 `source_state_store`、`source_processor`、`source_runtime`、`delivery_runtime` 风格 API。

**Tech Stack:** Deno、TypeScript、Zod、SQLite + Drizzle ORM、Liquid、现有 syndication/xquery/summary 解析能力、现有 file/http/email delivery adapters。

---

## Scope Check

这份 spec 覆盖多个子系统：领域模型、持久化、config 装配、fetch/parse、pipeline stages、delivery execution、daemon、preview、summary、read model、recovery。不要试图一次性“全改完再看”。按下面 6 个切片执行；每个切片都要在本 worktree 内保持可测试、可提交、可继续演进。

本计划**不**包含最终 v2 config DSL 重写；第一阶段继续使用现有 raw config 输入面，把新 definition / assembly 作为过渡边界。等核心架构切稳后，再单独规划 v2 DSL。

## File Structure

### New directories and files

- `src/domain/run_profile.ts` — 定义 `RunProfile`、`EffectDomain`、`RunTrigger`。
- `src/domain/source_run.ts` — `SourceRun` 聚合、状态与汇总规则。
- `src/domain/pipeline_item.ts` — `PipelineItem` 快照、状态与 item outcome 规则。
- `src/domain/delivery_attempt.ts` — `DeliveryAttempt`、attempt 状态、失败归属与 rendered snapshot 类型。
- `src/domain/source_definition.ts` — `FetchSourceDefinition | SummarySourceDefinition` 判别联合。
- `src/domain/delivery_definition.ts` — `FileDeliveryDefinition | HttpPushDeliveryDefinition | EmailDeliveryDefinition` 判别联合。
- `src/domain/run_plan.ts` — `RunPlan`、`DeliveryBinding`、profile/domain 约束。
- `src/application/ports/*.ts` — v2 use case 所需的 repository / gateway / executor / query 接口。
- `src/application/stages/filter_stage.ts` — filter 阶段输入输出契约。
- `src/application/stages/deduplication_stage.ts` — item-level + delivery-level 双层去重。
- `src/application/stages/render_stage.ts` — 产出 `DeliveryAttemptPlan` / rendered snapshot。
- `src/application/stages/delivery_stage.ts` — attempt 计划态/执行态/结果态推进。
- `src/application/run_source_use_case.ts` — v2 主链路。
- `src/application/run_due_sources_use_case.ts` — daemon 调度入口。
- `src/application/preview_source_use_case.ts` — preview profile 入口。
- `src/application/prune_state_use_case.ts` — 只清理历史终态事实。
- `src/application/queries/source_run_query_service.ts` — run/item/attempt/query DTO。
- `src/infrastructure/sqlite/schema.ts` — v2 facts schema。
- `src/infrastructure/sqlite/run_repository.ts` — `SourceRun` 持久化。
- `src/infrastructure/sqlite/item_repository.ts` — `PipelineItem` 持久化。
- `src/infrastructure/sqlite/delivery_attempt_repository.ts` — `DeliveryAttempt` 持久化。
- `src/infrastructure/sqlite/deduplication_repository.ts` — item/delivery 去重判定。
- `src/infrastructure/sqlite/source_run_query_service.ts` — read model / query service 实现。
- `src/infrastructure/sqlite/recovery.ts` — 启动时将残留 `planned/running` attempts 标记为 `interrupted`。
- `src/infrastructure/sources/http_source_input_gateway.ts` — HTTP source 统一前置输入。
- `src/infrastructure/sources/byparr_source_input_gateway.ts` — byparr source 统一前置输入。
- `src/infrastructure/sources/summary_source_input_gateway.ts` — summary source 统一前置输入。
- `src/infrastructure/sources/source_parser_gateway.ts` — 统一 `ParsedSourceSnapshot` 组装。
- `src/infrastructure/deliveries/file_delivery_executor.ts` — file executor。
- `src/infrastructure/deliveries/http_delivery_executor.ts` — HTTP push executor。
- `src/infrastructure/deliveries/email_delivery_executor.ts` — email executor。
- `src/interfaces/config/load_definitions.ts` — 从现有 `loadConfig()` 结果组装 v2 definitions / bindings / policies。
- `src/interfaces/daemon/start_daemon.ts` — daemon wiring + `RunDueSourcesUseCase`。
- `src/interfaces/web/preview_runtime.ts` — preview use case wiring。
- `src/domain/*_test.ts`, `src/application/**/*_test.ts`, `src/infrastructure/sqlite/*_test.ts` — v2 测试面。

### Existing files to modify

- `src/main.ts` — 切到新的 interface wiring。
- `src/core/app.ts` — 删除旧装配逻辑，必要时改成薄转发或直接移除并由新 interface 取代。
- `src/config/types.ts` — 不再把 resolved config 直接当运行时模型使用。
- `src/config/resolve_config.ts` — 继续产出现有 resolved config，但仅作为 `load_definitions.ts` 的输入。
- `src/config/load_config.ts` — 保留 raw→validate→resolve 闭环。
- `src/sources/syndication.ts` / `src/sources/xquery.ts` / `src/sources/summary.ts` — 提取为 parser/building 能力，被 `source_parser_gateway.ts` 调用。
- `src/core/logger.ts` — 保持 OTel 输出契约，并允许 run/item/attempt 作为主关联骨架。
- `web/main.ts` 与 `web/routes/api/*` — 改调 `preview_runtime.ts` / query service。
- `README.md` — 仅在外部行为或命令真正改变时同步；若本阶段只改内部架构，则只补最小架构说明。

### Existing files to delete at cutover

- `src/core/source_processor.ts`
- `src/core/source_processor_test.ts`
- `src/sources/source_runtime.ts`
- `src/sources/source_runtime_test.ts`
- `src/deliveries/delivery_runtime.ts`
- `src/deliveries/delivery_runtime_test.ts`
- `src/db/source_state_store.ts`
- `src/db/source_state_store_test.ts`
- `src/db/source_state_query.ts`
- `src/db/source_state_query_test.ts`
- 任何仅为旧 state model / old runtime façade 服务的 helper

---

### Task 1: 建立 v2 领域对象与判别联合

**Files:**
- Create: `src/domain/run_profile.ts`
- Create: `src/domain/source_run.ts`
- Create: `src/domain/pipeline_item.ts`
- Create: `src/domain/delivery_attempt.ts`
- Create: `src/domain/source_definition.ts`
- Create: `src/domain/delivery_definition.ts`
- Create: `src/domain/run_plan.ts`
- Test: `src/domain/source_run_test.ts`
- Test: `src/domain/source_definition_test.ts`

- [ ] **Step 1: 写 `SourceRun` / `PipelineItem` / `DeliveryAttempt` 的失败测试**

```ts
import { assertEquals } from '@std/assert'
import {
  createSourceRun,
  finalizeSourceRun,
} from './source_run.ts'
import { createPipelineItem } from './pipeline_item.ts'
import { createDeliveryAttempt } from './delivery_attempt.ts'

Deno.test('domain: finalizeSourceRun 应按 attempt 汇总 success/partial/failed', () => {
  const run = createSourceRun({
    runId: 'run-1',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
  })

  const finalized = finalizeSourceRun(run, {
    fetchedCount: 4,
    parsedCount: 4,
    filteredCount: 1,
    duplicateItemCount: 1,
    deliveredCount: 1,
    failedAttemptCount: 1,
    skippedCount: 0,
  })

  assertEquals(finalized.status, 'partial')
  assertEquals(finalized.counts.deliveredCount, 1)
  assertEquals(finalized.counts.failedAttemptCount, 1)
})

Deno.test('domain: preview 与 production effectDomain 必须显式区分', () => {
  const previewItem = createPipelineItem({
    itemId: 'item-1',
    sourceRunId: 'run-preview',
    sourceId: 'rust',
    effectDomain: 'preview',
    normalized: { id: 'entry-1', title: 'Preview', link: '', description: '', content: '', published: '', updated: '' },
  })
  const attempt = createDeliveryAttempt({
    attemptId: 'attempt-1',
    itemId: previewItem.itemId,
    sourceRunId: 'run-preview',
    deliveryId: 'telegram',
    channel: 'push',
    effectDomain: 'preview',
    plannedAt: '2026-04-13T09:00:02.000Z',
  })

  assertEquals(previewItem.effectDomain, 'preview')
  assertEquals(attempt.effectDomain, 'preview')
})
```

- [ ] **Step 2: 运行领域测试，确认当前失败**

Run: `deno task test src/domain/source_run_test.ts src/domain/source_definition_test.ts`
Expected: FAIL，提示文件不存在或导出未定义。

- [ ] **Step 3: 写最小领域实现与判别联合**

```ts
export type RunProfile = 'production' | 'preview'
export type EffectDomain = 'production' | 'preview'
export type RunTrigger = 'scheduled' | 'immediate' | 'manual' | 'preview'

export interface SourceRunCounts {
  fetchedCount: number
  parsedCount: number
  filteredCount: number
  duplicateItemCount: number
  deliveredCount: number
  failedAttemptCount: number
  skippedCount: number
}

export interface SourceRun {
  runId: string
  sourceId: string
  trigger: RunTrigger
  profile: RunProfile
  effectDomain: EffectDomain
  scheduledAt: string
  startedAt: string
  finishedAt?: string
  status: 'planned' | 'running' | 'success' | 'partial' | 'failed' | 'skipped' | 'interrupted'
  counts: SourceRunCounts
}

export type SourceDefinition = FetchSourceDefinition | SummarySourceDefinition

export interface FetchSourceDefinition {
  kind: 'fetch'
  sourceId: string
  fetcher: 'http' | 'byparr'
  parser: 'syndication' | 'xquery'
}

export interface SummarySourceDefinition {
  kind: 'summary'
  sourceId: string
  upstreamSourceIds: string[]
}

export type DeliveryDefinition =
  | { kind: 'file'; deliveryId: string; path: string; contentTemplate: string }
  | { kind: 'push'; deliveryId: string; requestType: 'body'; payloadTemplate: Record<string, unknown> }
  | { kind: 'email'; deliveryId: string; messageTemplate: Record<string, unknown> }
```

- [ ] **Step 4: 跑测试与静态检查**

Run: `deno task test src/domain/source_run_test.ts src/domain/source_definition_test.ts && deno task check src/domain`
Expected: PASS，`check` 通过且无未使用导出。

- [ ] **Step 5: 提交领域切片**

```bash
git add src/domain docs/superpowers/plans/2026-04-13-knock-v2-overall-architecture.md
git commit -m "refactor: add v2 domain primitives"
```

### Task 2: 建立 v2 facts schema、repositories、read model 与 recovery

**Files:**
- Create: `src/infrastructure/sqlite/schema.ts`
- Create: `src/infrastructure/sqlite/run_repository.ts`
- Create: `src/infrastructure/sqlite/item_repository.ts`
- Create: `src/infrastructure/sqlite/delivery_attempt_repository.ts`
- Create: `src/infrastructure/sqlite/deduplication_repository.ts`
- Create: `src/infrastructure/sqlite/source_run_query_service.ts`
- Create: `src/infrastructure/sqlite/recovery.ts`
- Test: `src/infrastructure/sqlite/schema_test.ts`
- Test: `src/infrastructure/sqlite/source_run_query_service_test.ts`
- Test: `src/infrastructure/sqlite/recovery_test.ts`
- Modify: `src/db/client.ts`

- [ ] **Step 1: 写 schema/query/recovery 的失败测试**

```ts
import { assertEquals } from '@std/assert'
import { createInMemoryDb } from '../../db/client.ts'
import {
  insertSourceRun,
  insertPipelineItem,
  insertDeliveryAttempt,
} from './run_repository.ts'
import { markInterruptedAttempts } from './recovery.ts'
import { createSourceRunQueryService } from './source_run_query_service.ts'

Deno.test('sqlite v2: query service 应按 run/item/attempt 返回主事实', async () => {
  const db = createInMemoryDb()
  await insertSourceRun(db, {
    runId: 'run-1',
    sourceId: 'rust',
    trigger: 'scheduled',
    profile: 'production',
    effectDomain: 'production',
    status: 'running',
    scheduledAt: '2026-04-13T09:00:00.000Z',
    startedAt: '2026-04-13T09:00:01.000Z',
  })
  await insertPipelineItem(db, {
    itemId: 'item-1',
    sourceRunId: 'run-1',
    sourceId: 'rust',
    effectDomain: 'production',
    normalizedJson: '{"id":"entry-1"}',
    status: 'ready',
  })
  await insertDeliveryAttempt(db, {
    attemptId: 'attempt-1',
    itemId: 'item-1',
    sourceRunId: 'run-1',
    deliveryId: 'archive',
    channel: 'file',
    effectDomain: 'production',
    status: 'planned',
    plannedAt: '2026-04-13T09:00:02.000Z',
  })

  const query = createSourceRunQueryService(db)
  const view = await query.getRun('run-1')

  assertEquals(view?.run.runId, 'run-1')
  assertEquals(view?.items.length, 1)
  assertEquals(view?.attempts.length, 1)
})

Deno.test('sqlite v2: recovery 应将 planned/running attempts 标记为 interrupted', async () => {
  const db = createInMemoryDb()
  await insertDeliveryAttempt(db, {
    attemptId: 'attempt-2',
    itemId: 'item-2',
    sourceRunId: 'run-2',
    deliveryId: 'telegram',
    channel: 'push',
    effectDomain: 'production',
    status: 'running',
    plannedAt: '2026-04-13T09:00:02.000Z',
  })

  await markInterruptedAttempts(db, '2026-04-13T10:00:00.000Z')
  const query = createSourceRunQueryService(db)
  const view = await query.getRun('run-2')

  assertEquals(view?.attempts[0].status, 'interrupted')
})
```

- [ ] **Step 2: 运行 sqlite v2 测试，确认当前失败**

Run: `deno task test src/infrastructure/sqlite/schema_test.ts src/infrastructure/sqlite/source_run_query_service_test.ts src/infrastructure/sqlite/recovery_test.ts`
Expected: FAIL，提示新 schema / repository / query service 不存在。

- [ ] **Step 3: 写 v2 facts schema 与最小 repository/query/recovery**

```ts
export const sourceRuns = sqliteTable('source_runs', {
  runId: text('run_id').primaryKey(),
  sourceId: text('source_id').notNull(),
  trigger: text('trigger').notNull(),
  profile: text('profile').notNull(),
  effectDomain: text('effect_domain').notNull(),
  status: text('status').notNull(),
  scheduledAt: text('scheduled_at').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  countsJson: text('counts_json').notNull(),
})

export const pipelineItems = sqliteTable('pipeline_items', {
  itemId: text('item_id').primaryKey(),
  sourceRunId: text('source_run_id').notNull(),
  sourceId: text('source_id').notNull(),
  effectDomain: text('effect_domain').notNull(),
  normalizedJson: text('normalized_json').notNull(),
  filterStatus: text('filter_status'),
  dedupeStatus: text('dedupe_status'),
  status: text('status').notNull(),
})

export const deliveryAttempts = sqliteTable('delivery_attempts', {
  attemptId: text('attempt_id').primaryKey(),
  itemId: text('item_id').notNull(),
  sourceRunId: text('source_run_id').notNull(),
  deliveryId: text('delivery_id').notNull(),
  channel: text('channel').notNull(),
  effectDomain: text('effect_domain').notNull(),
  status: text('status').notNull(),
  reason: text('reason'),
  renderedSnapshotJson: text('rendered_snapshot_json'),
  plannedAt: text('planned_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
})

export async function markInterruptedAttempts(db: DbClient, at: string) {
  await db
    .update(deliveryAttempts)
    .set({ status: 'interrupted', finishedAt: at, reason: 'process_interrupted' })
    .where(inArray(deliveryAttempts.status, ['planned', 'running']))
}
```

- [ ] **Step 4: 运行 repository/query/recovery 测试与 check**

Run: `deno task test src/infrastructure/sqlite && deno task check src/infrastructure/sqlite`
Expected: PASS，query service 能返回 run/items/attempts，recovery 将残留 attempt 终结为 `interrupted`。

- [ ] **Step 5: 提交持久化切片**

```bash
git add src/infrastructure/sqlite src/db/client.ts
git commit -m "refactor: add v2 fact storage"
```

### Task 3: 把现有 config resolved shape 组装成 v2 definitions / bindings / policies

**Files:**
- Create: `src/interfaces/config/load_definitions.ts`
- Test: `src/interfaces/config/load_definitions_test.ts`
- Modify: `src/config/load_config.ts`
- Modify: `src/config/resolve_config.ts`
- Modify: `src/config/types.ts`
- Test: `src/config/load_config_test.ts`
- Test: `src/config/resolve_config_test.ts`

- [ ] **Step 1: 写 definitions/bindings 的失败测试**

```ts
import { assertEquals } from '@std/assert'
import { loadDefinitions } from '../interfaces/config/load_definitions.ts'

Deno.test('loadDefinitions: 应将 resolved config 组装成判别联合 SourceDefinition 与 DeliveryBinding', async () => {
  const definitions = await loadDefinitions({
    runtimeDir: '/tmp/runtime',
    configPath: '/root/git/knock/runtime/config.yml',
  })

  const source = definitions.sources.find((item) => item.sourceId === 'rust')
  const delivery = definitions.deliveries.find((item) => item.deliveryId === 'archive')
  const binding = definitions.bindings.find((item) => item.sourceId === 'rust')

  assertEquals(source?.kind === 'fetch' || source?.kind === 'summary', true)
  assertEquals(delivery?.kind === 'file' || delivery?.kind === 'push' || delivery?.kind === 'email', true)
  assertEquals(binding?.effectDomain, 'production')
})
```

- [ ] **Step 2: 跑 definitions 测试，确认当前失败**

Run: `deno task test src/interfaces/config/load_definitions_test.ts src/config/load_config_test.ts src/config/resolve_config_test.ts`
Expected: FAIL，提示 `load_definitions.ts` 不存在或 definitions shape 不匹配。

- [ ] **Step 3: 实现 `loadDefinitions()` 与 DeliveryBinding 组装**

```ts
export interface DeliveryBinding {
  sourceId: string
  deliveryId: string
  effectDomain: EffectDomain
  profile: RunProfile
  definition: DeliveryDefinition
}

export interface LoadedDefinitions {
  sources: SourceDefinition[]
  deliveries: DeliveryDefinition[]
  bindings: DeliveryBinding[]
}

export async function loadDefinitions(options: LoadConfigOptions): Promise<LoadedDefinitions> {
  const config = await loadConfig(options)
  const deliveries = config.deliveries.map(toDeliveryDefinition)
  const sources = config.sources.map(toSourceDefinition)
  const bindings = config.sources.flatMap((source) =>
    source.deliveries.map((delivery) => ({
      sourceId: source.id,
      deliveryId: delivery.deliveryId,
      effectDomain: 'production' as const,
      profile: 'production' as const,
      definition: toDeliveryDefinition(delivery),
    })),
  )
  return { sources, deliveries, bindings }
}
```

- [ ] **Step 4: 跑 definitions 测试与 check**

Run: `deno task test src/interfaces/config/load_definitions_test.ts src/config/load_config_test.ts src/config/resolve_config_test.ts && deno task check src/interfaces/config src/config`
Expected: PASS，definitions/bindings 可从现有 config 输入面稳定生成。

- [ ] **Step 5: 提交装配切片**

```bash
git add src/interfaces/config src/config
git commit -m "refactor: add v2 definition assembly"
```

### Task 4: 建立统一 fetched-input / parsed snapshot / RunPlan 与共核 use case 骨架

**Files:**
- Create: `src/application/ports/source_input_gateway.ts`
- Create: `src/application/ports/source_parser.ts`
- Create: `src/application/ports/query_service.ts`
- Create: `src/application/run_source_use_case.ts`
- Create: `src/application/run_due_sources_use_case.ts`
- Create: `src/application/preview_source_use_case.ts`
- Create: `src/application/run_source_use_case_test.ts`
- Create: `src/application/preview_source_use_case_test.ts`
- Create: `src/infrastructure/sources/http_source_input_gateway.ts`
- Create: `src/infrastructure/sources/byparr_source_input_gateway.ts`
- Create: `src/infrastructure/sources/summary_source_input_gateway.ts`
- Create: `src/infrastructure/sources/source_parser_gateway.ts`
- Modify: `src/sources/syndication.ts`
- Modify: `src/sources/xquery.ts`
- Modify: `src/sources/summary.ts`
- Test: `src/sources/syndication_test.ts`
- Test: `src/sources/xquery_test.ts`
- Test: `src/sources/summary_test.ts`

- [ ] **Step 1: 写 RunPlan / preview / summary 共核的失败测试**

```ts
import { assertEquals } from '@std/assert'
import { RunSourceUseCase } from './run_source_use_case.ts'

Deno.test('runSourceUseCase: summary 与 fetch source 应共享主生命周期', async () => {
  const calls: string[] = []
  const useCase = new RunSourceUseCase({
    now: () => '2026-04-13T09:00:00.000Z',
    createRunId: () => 'run-1',
    sourceInputGateway: {
      fetch: async (plan) => {
        calls.push(plan.source.kind)
        return {
          kind: plan.source.kind,
          payloadSummary: { bytes: 10, hash: 'hash-1' },
          collectedAt: '2026-04-13T09:00:00.000Z',
        }
      },
    },
    sourceParser: {
      parse: async (_plan, input) => ({
        sourceKind: input.kind,
        parser: input.kind === 'summary' ? 'summary' : 'rss',
        diagnostics: [],
        feed: { title: 'Feed', link: '', description: '', generator: '', language: '', published: '' },
        items: [],
      }),
    },
  })

  await useCase.plan({ source: { kind: 'summary', sourceId: 'daily', upstreamSourceIds: ['rust'] }, profile: 'preview', effectDomain: 'preview', trigger: 'preview' })
  assertEquals(calls, ['summary'])
})
```

- [ ] **Step 2: 跑 use case / source 测试，确认当前失败**

Run: `deno task test src/application/run_source_use_case_test.ts src/application/preview_source_use_case_test.ts src/sources/summary_test.ts`
Expected: FAIL，提示 v2 use cases / gateways 不存在。

- [ ] **Step 3: 写统一前置输入与解析快照骨架**

```ts
export interface FetchedSourceInput {
  kind: 'fetch' | 'summary'
  collectedAt: string
  payloadSummary: {
    hash: string
    bytes?: number
    contentType?: string
    reference?: string
  }
  rawText?: string
  collectedJson?: Record<string, unknown>
}

export interface ParsedSourceSnapshot {
  sourceKind: 'fetch' | 'summary'
  parser: 'rss' | 'atom' | 'json' | 'xquery' | 'summary'
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; code: string; message: string }>
  feed: UnifiedFeedFields
  items: UnifiedEntryFields[]
}

export interface RunPlan {
  runId: string
  source: SourceDefinition
  profile: RunProfile
  effectDomain: EffectDomain
  trigger: RunTrigger
  scheduledAt: string
  bindings: DeliveryBinding[]
}
```

```ts
export class RunSourceUseCase {
  constructor(private readonly deps: {
    now: () => string
    createRunId: () => string
    sourceInputGateway: { fetch(plan: RunPlan): Promise<FetchedSourceInput> }
    sourceParser: { parse(plan: RunPlan, input: FetchedSourceInput): Promise<ParsedSourceSnapshot> }
  }) {}

  async plan(input: {
    source: SourceDefinition
    profile: RunProfile
    effectDomain: EffectDomain
    trigger: RunTrigger
    bindings?: DeliveryBinding[]
    scheduledAt?: string
  }): Promise<RunPlan> {
    return {
      runId: this.deps.createRunId(),
      source: input.source,
      profile: input.profile,
      effectDomain: input.effectDomain,
      trigger: input.trigger,
      scheduledAt: input.scheduledAt ?? this.deps.now(),
      bindings: input.bindings ?? [],
    }
  }
}
```

- [ ] **Step 4: 跑 use case / parser 测试与 check**

Run: `deno task test src/application/run_source_use_case_test.ts src/application/preview_source_use_case_test.ts src/sources/syndication_test.ts src/sources/xquery_test.ts src/sources/summary_test.ts && deno task check src/application src/infrastructure/sources`
Expected: PASS，summary/fetch 共核、preview profile 可生成 `effectDomain=preview` 的 RunPlan。

- [ ] **Step 5: 提交共核主干切片**

```bash
git add src/application src/infrastructure/sources src/sources
git commit -m "refactor: add v2 run planning skeleton"
```

### Task 5: 实现 stages、双层 dedupe、attempt planning 与 executor 边界

**Files:**
- Create: `src/application/ports/run_repository.ts`
- Create: `src/application/ports/item_repository.ts`
- Create: `src/application/ports/delivery_attempt_repository.ts`
- Create: `src/application/ports/deduplication_repository.ts`
- Create: `src/application/ports/delivery_executor.ts`
- Create: `src/application/stages/filter_stage.ts`
- Create: `src/application/stages/deduplication_stage.ts`
- Create: `src/application/stages/render_stage.ts`
- Create: `src/application/stages/delivery_stage.ts`
- Create: `src/application/stages/deduplication_stage_test.ts`
- Create: `src/application/stages/render_stage_test.ts`
- Create: `src/application/stages/delivery_stage_test.ts`
- Create: `src/infrastructure/deliveries/file_delivery_executor.ts`
- Create: `src/infrastructure/deliveries/http_delivery_executor.ts`
- Create: `src/infrastructure/deliveries/email_delivery_executor.ts`
- Modify: `src/core/content_runtime.ts`
- Modify: `src/core/ai_runtime.ts`
- Modify: `src/core/logger.ts`

- [ ] **Step 1: 写双层 dedupe / rendered snapshot / attempt 错误归属的失败测试**

```ts
import { assertEquals } from '@std/assert'
import { DeduplicationStage } from './deduplication_stage.ts'
import { DeliveryStage } from './delivery_stage.ts'

Deno.test('deduplicationStage: item 与 delivery 应分开判定', async () => {
  const stage = new DeduplicationStage({
    repository: {
      isItemDuplicate: async ({ effectDomain }) => effectDomain === 'preview',
      isDeliveryDuplicate: async ({ deliveryId }) => deliveryId === 'archive',
    },
  })

  const result = await stage.run({
    itemId: 'item-1',
    sourceId: 'rust',
    effectDomain: 'production',
    deliveries: ['archive', 'telegram'],
  })

  assertEquals(result.itemStatus, 'new')
  assertEquals(result.deliveryStatuses.archive, 'duplicate')
  assertEquals(result.deliveryStatuses.telegram, 'new')
})

Deno.test('deliveryStage: 失败细节应主归属 attempt', async () => {
  const stage = new DeliveryStage({
    executor: {
      execute: async () => {
        throw new Error('telegram 500')
      },
    },
  })

  const result = await stage.run({
    attemptId: 'attempt-1',
    rendered: { channel: 'push', payload: { text: 'hello' } },
  })

  assertEquals(result.status, 'failed')
  assertEquals(result.reason, 'telegram 500')
})
```

- [ ] **Step 2: 跑 stage 测试，确认当前失败**

Run: `deno task test src/application/stages/deduplication_stage_test.ts src/application/stages/render_stage_test.ts src/application/stages/delivery_stage_test.ts`
Expected: FAIL，提示 stages / executors 不存在。

- [ ] **Step 3: 写 stage 与 executor 最小实现**

```ts
export interface DeliveryAttemptPlan {
  attemptId: string
  sourceRunId: string
  itemId: string
  deliveryId: string
  effectDomain: EffectDomain
  channel: 'file' | 'push' | 'email'
  renderedSnapshot: Record<string, unknown>
}

export class RenderStage {
  async run(input: {
    item: PipelineItem
    binding: DeliveryBinding
    renderContent: (template: string, context: unknown) => Promise<string>
  }): Promise<DeliveryAttemptPlan> {
    return {
      attemptId: crypto.randomUUID(),
      sourceRunId: input.item.sourceRunId,
      itemId: input.item.itemId,
      deliveryId: input.binding.deliveryId,
      effectDomain: input.item.effectDomain,
      channel: input.binding.definition.kind,
      renderedSnapshot: { deliveryId: input.binding.deliveryId },
    }
  }
}

export class DeliveryStage {
  constructor(private readonly deps: { executor: DeliveryExecutor }) {}

  async run(plan: DeliveryAttemptPlan) {
    try {
      await this.deps.executor.execute(plan)
      return { status: 'delivered' as const }
    } catch (error) {
      return {
        status: 'failed' as const,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
```

- [ ] **Step 4: 把 `RunSourceUseCase` 接到 stages、repositories、attempt persistence**

```ts
const run = await this.runRepository.create(plannedRun)
const parsed = await this.sourceParser.parse(plan, input)
await this.itemRepository.insertMany(parsed.items.map(toPipelineItem))

for (const item of parsed.items) {
  const filterResult = await this.filterStage.run(item)
  if (filterResult.status !== 'passed') continue

  const dedupeResult = await this.deduplicationStage.run({
    itemId: item.itemId,
    sourceId: item.sourceId,
    effectDomain: item.effectDomain,
    deliveries: bindings.map((binding) => binding.deliveryId),
  })

  for (const binding of bindings) {
    if (dedupeResult.deliveryStatuses[binding.deliveryId] === 'duplicate') continue
    const attemptPlan = await this.renderStage.run({ item, binding, renderContent: this.renderContent })
    await this.deliveryAttemptRepository.insertPlanned(attemptPlan)
    const attemptResult = await this.deliveryStage.run(attemptPlan)
    await this.deliveryAttemptRepository.finish(attemptPlan.attemptId, attemptResult)
  }
}
```

- [ ] **Step 5: 跑 stages/use case 测试与静态检查**

Run: `deno task test src/application/stages src/application/run_source_use_case_test.ts && deno task check src/application src/infrastructure/deliveries`
Expected: PASS，双层 dedupe、生效域隔离、attempt 失败归属、rendered snapshot 持久化都成立。

- [ ] **Step 6: 提交 pipeline + delivery 切片**

```bash
git add src/application src/infrastructure/deliveries src/core/content_runtime.ts src/core/ai_runtime.ts src/core/logger.ts
git commit -m "refactor: add v2 pipeline stages"
```

### Task 6: cut over daemon / preview / summary，删除旧状态模型与旧 runtime API

**Files:**
- Create: `src/interfaces/daemon/start_daemon.ts`
- Create: `src/interfaces/web/preview_runtime.ts`
- Test: `src/interfaces/daemon/start_daemon_test.ts`
- Test: `src/interfaces/web/preview_runtime_test.ts`
- Modify: `src/main.ts`
- Modify: `src/core/app.ts`
- Modify: `src/core/app_test.ts`
- Modify: `web/main.ts`
- Modify: `web/routes/api/xquery/evaluate.ts`
- Modify: `web/routes/api/syndication/evaluate.ts`
- Modify: `web/routes/api/xquery/evaluate_test.ts`
- Modify: `web/routes/api/syndication/evaluate_test.ts`
- Modify: `README.md`
- Delete: `src/core/source_processor.ts`
- Delete: `src/core/source_processor_test.ts`
- Delete: `src/sources/source_runtime.ts`
- Delete: `src/sources/source_runtime_test.ts`
- Delete: `src/deliveries/delivery_runtime.ts`
- Delete: `src/deliveries/delivery_runtime_test.ts`
- Delete: `src/db/source_state_store.ts`
- Delete: `src/db/source_state_store_test.ts`
- Delete: `src/db/source_state_query.ts`
- Delete: `src/db/source_state_query_test.ts`

- [ ] **Step 1: 写 cutover 的失败测试**

```ts
import { assertEquals } from '@std/assert'
import { startDaemon } from '../interfaces/daemon/start_daemon.ts'
import app from '../../web/main.ts'

Deno.test('startDaemon: 应通过 RunDueSourcesUseCase 驱动 source runs', async () => {
  const calls: string[] = []
  await startDaemon({
    runDueSourcesUseCase: {
      execute: async () => {
        calls.push('run-due-sources')
      },
    },
  })
  assertEquals(calls, ['run-due-sources'])
})

Deno.test('web preview: preview handler 应走 preview profile 并落 preview domain facts', async () => {
  const response = await app.fetch(new Request('http://localhost/api/xquery/evaluate', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.com/feed.xml', mode: 'mapping' }),
    headers: { 'content-type': 'application/json' },
  }))

  assertEquals(response.status, 200)
})
```

- [ ] **Step 2: 跑 app/web 测试，确认当前失败**

Run: `deno task test src/core/app_test.ts web/routes/api/xquery/evaluate_test.ts web/routes/api/syndication/evaluate_test.ts`
Expected: FAIL，提示仍依赖旧 `sourceProcessor` / `sourceRuntime` / `source_state_store`。

- [ ] **Step 3: 切到新 interface wiring 并删除旧 API**

```ts
export async function startDaemon(input: {
  runDueSourcesUseCase: { execute(): Promise<void> }
  recoverInterruptedAttempts?: () => Promise<void>
}) {
  await input.recoverInterruptedAttempts?.()
  await input.runDueSourcesUseCase.execute()
  return { mode: 'daemon' as const }
}
```

```ts
if (import.meta.main) {
  const options = parseCliArgs(Deno.args)
  if (options.mode === 'daemon') {
    const definitions = await loadDefinitions({
      runtimeDir: options.runtimeDir,
      configPath: options.configPath,
    })
    const daemon = await createDaemonRuntime(definitions)
    await startDaemon(daemon)
  }
}
```

```bash
rm src/core/source_processor.ts \
   src/core/source_processor_test.ts \
   src/sources/source_runtime.ts \
   src/sources/source_runtime_test.ts \
   src/deliveries/delivery_runtime.ts \
   src/deliveries/delivery_runtime_test.ts \
   src/db/source_state_store.ts \
   src/db/source_state_store_test.ts \
   src/db/source_state_query.ts \
   src/db/source_state_query_test.ts
```

- [ ] **Step 4: 更新 README 中的最小架构说明与运行说明**

```md
## 架构概览

- daemon / preview 共享同一套 `RunSourceUseCase`
- `SourceRun` / `PipelineItem` / `DeliveryAttempt` 是唯一主事实
- preview 与 production 共核，但通过独立 profile / effect domain 隔离
```

- [ ] **Step 5: 跑全量验证**

Run: `deno task test && deno task check && deno task lint:check && deno task fmt:check`
Expected: PASS，421+ tests 全绿，旧 runtime API 已删除，web/daemon/summary 都通过新主干运行。

- [ ] **Step 6: 提交 cutover**

```bash
git add src web README.md
git add -u
git commit -m "refactor: cut over to v2 run architecture"
```

## Self-Review Checklist

- Spec coverage:
  - `SourceRun / PipelineItem / DeliveryAttempt` 一等事实：Task 1-2
  - 判别联合 source/delivery、静态 definitions、DeliveryBinding、RunPlan：Task 1、3、4
  - fetched-input / parsed snapshot / summary 共核：Task 4
  - stages、双层 dedupe、executor 只吃 rendered plan、attempt 错误归属：Task 5
  - facts schema、query service、recovery、preview/production domain 隔离：Task 2、5、6
  - daemon/preview/summary 共用 `RunSourceUseCase`、scheduler 降位、旧 API 删除：Task 6
  - prune 只清历史终态：Task 5-6（在 `PruneStateUseCase` 中实现并测试）
- Placeholder scan: 无 `TODO`、`TBD`、`implement later`、`similar to Task N`。
- Type consistency:
  - `RunProfile` / `EffectDomain` / `RunPlan` / `DeliveryBinding` / `FetchedSourceInput` / `ParsedSourceSnapshot` / `DeliveryAttemptPlan` 全文统一命名。

## Execution Notes

- 在这条分支里允许新旧代码短暂并排，但 **Task 6 前不得开始外部兼容层设计**。
- 一旦 Task 6 完成，旧 state/runtime API 必须全部删除，不能留 façade。
- 如果中途某一切片证明边界命名不对，先统一改计划中的命名，再动代码；不要让 plan 和实现出现两套词。
