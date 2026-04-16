# Logging OTel Refactor Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining 2026-04-11 logging contract sweep so daemon, application, infrastructure, web, docs, and rules all emit or describe the same owner-scoped OTel-aligned log shape.

**Architecture:** Keep the existing shared logger contract in `src/core/logger.ts` and the already-landed 2026-04-15 pretty/web-startup normalization work. Finish the remaining sweep at the real v2 boundaries visible in the current repo: application orchestration (`RunSourceUseCase` and stages), core bootstrap/scheduler, infrastructure source adapters/parsers, and final rule/doc sync. Add logging where the current architecture actually executes work instead of resurrecting deleted `source_runtime` / `delivery_runtime` helper layers from the older plan.

**Tech Stack:** Deno, TypeScript, Fresh, zod, node:sqlite, Drizzle ORM, `@logtape/pretty`, `@logtape/redaction`

---

## File Map

### Shared/core boundaries

- Modify: `src/core/scheduler.ts` — replace remaining bare `operation/outcome/reason` fields with `scheduler.*` namespaced fields.
- Modify: `src/core/scheduler_test.ts` — lock the new scheduler field shape.
- Modify: `src/interfaces/daemon/create_daemon_runtime.ts` — remove stray `app.runtime_dir` base field and keep wiring aligned with the final contract.
- Modify: `src/interfaces/daemon/start_daemon_test.ts` — add a daemon-runtime wiring regression test that proves no stray base field leaks into emitted logs.

### Application orchestration and stage-level observability

- Modify: `src/application/run_source_use_case.ts` — add owner-scoped lifecycle logs for filter/dedupe/delivery/finalize at the actual orchestration layer that exists now.
- Modify: `src/application/stages/delivery_stage.ts` — accept optional logger and emit attempt-level success/failure logs.
- Modify: `src/application/run_source_use_case_test.ts` — add contract coverage for namespaced source/pipeline/delivery/scheduler logs.
- Modify: `src/application/stages/delivery_stage_test.ts` — lock the new attempt-level log shape.

### Infrastructure adapters

- Modify: `src/infrastructure/sources/http_source_input_gateway.ts` — add payload-free fetch logs with `source.*` ownership.
- Modify: `src/infrastructure/sources/byparr_source_input_gateway.ts` — add payload-free fetch logs with `source.*` ownership.
- Modify: `src/infrastructure/sources/source_parser_gateway.ts` — add parse-complete / parse-failure logs with parser and counts under `source.*`.
- Create: `src/infrastructure/sources/http_source_input_gateway_test.ts` — lock HTTP source adapter log shape.
- Create: `src/infrastructure/sources/byparr_source_input_gateway_test.ts` — lock Byparr source adapter log shape.
- Modify: `src/infrastructure/sources/source_parser_gateway_test.ts` — lock parser log shape.
- Modify: `src/interfaces/daemon/create_daemon_runtime.ts` — wire the new source adapter/parser loggers.

### Existing producer/test cleanup

- Modify: `src/core/logger_test.ts` — keep generic logger invariants, but stop using bare producer-field examples where they now conflict with the repository contract.

### Rules and docs

- Modify: `.claude/rules/logging-otel.md` — update examples and wording to point at the current v2/application/infrastructure execution points instead of deleted runtime helpers.
- Modify: `.claude/rules/logging-console.md` — keep pretty-display examples aligned with the final namespaced examples.
- Modify: `.claude/skills/otel-logging-design/SKILL.md` — sync examples and guidance with the final contract.
- Modify: `README.md` — sync public logging guidance and examples with the completed contract.

---

### Task 1: Fix the remaining scheduler legacy fields

**Files:**

- Modify: `src/core/scheduler.ts`
- Modify: `src/core/scheduler_test.ts`
- Test: `src/core/scheduler_test.ts`

- [ ] **Step 1: Add the failing scheduler contract assertions**

```ts
assertEquals(attributes['scheduler.operation'], 'run_source')
assertEquals(attributes['scheduler.outcome'], 'skipped')
assertEquals(attributes['scheduler.reason'], 'reentry_inflight')
assertEquals(attributes['source.id'], 's1')
assertEquals('operation' in attributes, false)
assertEquals('outcome' in attributes, false)
assertEquals('reason' in attributes, false)
```

- [ ] **Step 2: Run the scheduler test to verify it fails**

Run: `deno task test src/core/scheduler_test.ts`
Expected: FAIL because `src/core/scheduler.ts` still emits bare `operation/outcome/reason`.

- [ ] **Step 3: Replace the scheduler fields in `src/core/scheduler.ts`**

```ts
logger?.warn('跳过重入执行', {
  'scheduler.operation': 'run_source',
  'scheduler.outcome': 'skipped',
  'source.id': sourceId,
  'scheduler.reason': 'reentry_inflight',
})
```

- [ ] **Step 4: Run the scheduler test to verify it passes**

Run: `deno task test src/core/scheduler_test.ts`
Expected: PASS with only `scheduler.*` and `source.id` in the attributes.

- [ ] **Step 5: Commit the scheduler field cleanup**

```bash
git add src/core/scheduler.ts src/core/scheduler_test.ts
git commit -m "refactor(logging): namespace scheduler reentry logs"
```

---

### Task 2: Remove the stale daemon base field and lock the wiring with a focused test

**Files:**

- Modify: `src/interfaces/daemon/create_daemon_runtime.ts`
- Modify: `src/interfaces/daemon/start_daemon_test.ts`
- Test: `src/interfaces/daemon/start_daemon_test.ts`

- [ ] **Step 1: Add the failing daemon wiring regression test**

In `src/interfaces/daemon/start_daemon_test.ts`, add a focused logger-shape test that recreates the current daemon logger construction and proves no base field leaks into attributes:

```ts
Deno.test(
  '[contract] startDaemon: daemon logger 不应注入 app.runtime_dir 基础字段',
  () => {
    const logs: string[] = []
    const logger = createLogger({
      enabled: true,
      level: 'info',
      format: 'json',
      module: 'app.startup',
      component: 'daemon',
      timezone: 'UTC',
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
      baseFields: {
        'app.runtime_dir': '/tmp/runtime',
      },
      now: () => new Date('2026-03-24T21:45:12.345Z'),
      writeStdout: (line: string) => logs.push(line),
    })

    logger.info('daemon 启动测试', {
      'app.operation': 'startup',
      'app.outcome': 'success',
    })

    const record = JSON.parse(logs[0]) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>
    assertEquals(attributes['app.operation'], 'startup')
    assertEquals(attributes['app.outcome'], 'success')
    assertEquals('app.runtime_dir' in attributes, true)
  },
)
```

This intentionally locks the current bad behavior so the next step has a real failing test.

- [ ] **Step 2: Run the focused daemon wiring test to verify it fails for the desired contract**

Run: `deno task test src/interfaces/daemon/start_daemon_test.ts`
Expected: FAIL once you flip the final assertion to `assertEquals('app.runtime_dir' in attributes, false)` and before implementation is updated.

- [ ] **Step 3: Remove the stale base field from `create_daemon_runtime.ts` and update the test expectation**

In `src/interfaces/daemon/create_daemon_runtime.ts`, remove the base field block entirely:

```ts
const logger = createLogger({
  enabled: options.config.logging.sinks.console?.type === 'console',
  level: options.config.logging.level,
  format: options.config.logging.format,
  module: 'app.startup',
  component: 'daemon',
  timezone: options.config.timezone,
  timestampFormat: options.config.timestampFormat,
})
```

Then update the new test to assert the final contract:

```ts
assertEquals('app.runtime_dir' in attributes, false)
```

- [ ] **Step 4: Run the daemon wiring verification**

Run: `deno task test src/interfaces/daemon/start_daemon_test.ts`
Expected: PASS with no stray `app.runtime_dir` in daemon-emitted attributes.

- [ ] **Step 5: Commit the daemon wiring cleanup**

```bash
git add src/interfaces/daemon/create_daemon_runtime.ts src/interfaces/daemon/start_daemon_test.ts
git commit -m "refactor(logging): remove daemon runtime dir base field"
```

---

### Task 3: Add source fetch and parse observability at the real adapter boundary

**Files:**

- Modify: `src/infrastructure/sources/http_source_input_gateway.ts`
- Modify: `src/infrastructure/sources/byparr_source_input_gateway.ts`
- Modify: `src/infrastructure/sources/source_parser_gateway.ts`
- Create: `src/infrastructure/sources/http_source_input_gateway_test.ts`
- Create: `src/infrastructure/sources/byparr_source_input_gateway_test.ts`
- Modify: `src/infrastructure/sources/source_parser_gateway_test.ts`
- Modify: `src/interfaces/daemon/create_daemon_runtime.ts`
- Test: `src/infrastructure/sources/http_source_input_gateway_test.ts`
- Test: `src/infrastructure/sources/byparr_source_input_gateway_test.ts`
- Test: `src/infrastructure/sources/source_parser_gateway_test.ts`

- [ ] **Step 1: Add failing source-adapter and parser contract tests**

Create `src/infrastructure/sources/http_source_input_gateway_test.ts` with a logger-backed fetch case:

```ts
Deno.test(
  '[contract] httpSourceInputGateway: 抓取成功应记录 payload-free source 日志',
  async () => {
    const logs: string[] = []
    const gateway = new HttpSourceInputGateway({
      httpClient: createHttpClient({
        fetcher: () => Promise.resolve(new Response('hello', { status: 200 })),
      }),
      resolveSourceConfig: () => ({
        id: 'rust',
        enabled: true,
        name: 'Rust',
        http: { url: 'https://example.com/feed.xml' },
        deliveries: [],
      }),
      logger: createLogger({
        enabled: true,
        level: 'info',
        module: 'source.fetch.http',
        now: () => new Date('2026-03-24T21:45:12.345Z'),
        writeStdout: (line: string) => logs.push(line),
        writeWarn: (line: string) => logs.push(line),
        writeStderr: (line: string) => logs.push(line),
      }),
    })

    await gateway.fetch({
      runId: 'run-1',
      source: {
        kind: 'fetch',
        sourceId: 'rust',
        fetcher: 'http',
        parser: 'syndication',
      },
      profile: 'production',
      effectDomain: 'production',
      trigger: 'scheduled',
      scheduledAt: '2026-04-13T10:00:00.000Z',
      bindings: [],
    })

    const record = JSON.parse(logs[0]) as Record<string, unknown>
    const attributes = (record.attributes ?? {}) as Record<string, unknown>
    assertEquals(attributes['source.operation'], 'fetch_payload')
    assertEquals(attributes['source.outcome'], 'success')
    assertEquals(attributes['source.id'], 'rust')
    assertEquals(typeof attributes['source.payload_bytes'], 'number')
    assertEquals(JSON.stringify(record).includes('hello'), false)
  },
)
```

Create `src/infrastructure/sources/byparr_source_input_gateway_test.ts` with the same assertions against the Byparr gateway.

Then extend `src/infrastructure/sources/source_parser_gateway_test.ts` with a parse log assertion:

```ts
assertEquals(attributes['source.operation'], 'parse_payload')
assertEquals(attributes['source.outcome'], 'success')
assertEquals(attributes['source.id'], 'rust')
assertEquals(attributes['source.parser'], 'rss')
assertEquals(attributes['source.item_count'], 2)
```

- [ ] **Step 2: Run the source adapter/parser tests to verify they fail**

Run: `deno task test src/infrastructure/sources/http_source_input_gateway_test.ts src/infrastructure/sources/byparr_source_input_gateway_test.ts src/infrastructure/sources/source_parser_gateway_test.ts`
Expected: FAIL because the gateways/parser currently have no logger deps and emit no direct fetch/parse logs.

- [ ] **Step 3: Add optional logger deps and payload-free source logs**

Update the gateway deps/interfaces:

```ts
export interface HttpSourceInputGatewayDeps {
  httpClient: HttpClient
  resolveSourceConfig(sourceId: string): ResolvedSourceConfig
  logger?: Logger
}
```

```ts
export interface ByparrSourceInputGatewayDeps {
  httpClient: HttpClient
  resolveSourceConfig(sourceId: string): ResolvedSourceConfig
  logger?: Logger
}
```

Add success logs after the fetch completes:

```ts
const startedAt = Date.now()
const rawText = await fetchHttpText(config, this.deps.httpClient)
const payloadBytes = new TextEncoder().encode(rawText).byteLength

this.deps.logger?.info('source payload 抓取完成', {
  module: 'source.fetch.http',
  'source.operation': 'fetch_payload',
  'source.outcome': 'success',
  'source.id': config.id,
  'source.fetch_duration_ms': Date.now() - startedAt,
  'source.payload_bytes': payloadBytes,
})
```

Apply the same pattern in `ByparrSourceInputGateway` with `module: 'source.fetch.byparr'`.

Extend `SourceParserGatewayDeps` and add parse logs:

```ts
export interface SourceParserGatewayDeps {
  resolveSourceConfig(sourceId: string): ResolvedSourceConfig
  timeOptions: {
    timezone: string
    timestampFormat: string
  }
  language: string
  aiRuntime?: AiRuntime
  summaryQueryService?: SummaryQueryService
  contentRuntime?: ContentRuntime
  logger?: Logger
}
```

```ts
this.deps.logger?.info('source 解析完成', {
  module: 'source.parse',
  'source.operation': 'parse_payload',
  'source.outcome': 'success',
  'source.id': config.id,
  'source.parser': parsed.format,
  'source.item_count': parsed.entries.length,
})
```

```ts
this.deps.logger?.error('source 解析失败', {
  module: 'source.parse',
  'source.operation': 'parse_payload',
  'source.outcome': 'failure',
  'source.id': config.id,
  error_name: error instanceof Error ? error.name : 'Error',
  error_message: error instanceof Error ? error.message : String(error),
})
```

Wire the new loggers from `src/interfaces/daemon/create_daemon_runtime.ts`:

```ts
const httpGateway = new HttpSourceInputGateway({
  httpClient,
  resolveSourceConfig: (sourceId) =>
    resolveSourceConfig(definitions.sourceConfigsById, sourceId),
  logger: logger.child({ module: 'source.fetch.http' }),
})
```

```ts
const byparrGateway = new ByparrSourceInputGateway({
  httpClient,
  resolveSourceConfig: (sourceId) =>
    resolveSourceConfig(definitions.sourceConfigsById, sourceId),
  logger: logger.child({ module: 'source.fetch.byparr' }),
})
```

```ts
const sourceParser = new SourceParserGateway({
  resolveSourceConfig: (sourceId) =>
    resolveSourceConfig(definitions.sourceConfigsById, sourceId),
  timeOptions: {
    timezone: options.config.timezone,
    timestampFormat: options.config.timestampFormat,
  },
  language: options.config.language,
  aiRuntime,
  summaryQueryService,
  contentRuntime,
  logger: logger.child({ module: 'source.parse' }),
})
```

- [ ] **Step 4: Run the source adapter/parser verification**

Run: `deno task test src/infrastructure/sources/http_source_input_gateway_test.ts src/infrastructure/sources/byparr_source_input_gateway_test.ts src/infrastructure/sources/source_parser_gateway_test.ts`
Expected: PASS with payload-free `source.fetch.*` and `source.parse` records.

- [ ] **Step 5: Commit the source adapter observability work**

```bash
git add src/infrastructure/sources/http_source_input_gateway.ts src/infrastructure/sources/byparr_source_input_gateway.ts src/infrastructure/sources/source_parser_gateway.ts src/infrastructure/sources/http_source_input_gateway_test.ts src/infrastructure/sources/byparr_source_input_gateway_test.ts src/infrastructure/sources/source_parser_gateway_test.ts src/interfaces/daemon/create_daemon_runtime.ts
git commit -m "feat(logging): add source fetch and parse checkpoints"
```

---

### Task 4: Add owner-scoped pipeline logs in `RunSourceUseCase`

**Files:**

- Modify: `src/application/run_source_use_case.ts`
- Modify: `src/interfaces/daemon/create_daemon_runtime.ts`
- Modify: `src/application/run_source_use_case_test.ts`
- Test: `src/application/run_source_use_case_test.ts`

- [ ] **Step 1: Add the failing `RunSourceUseCase` log assertions**

Create a logger-backed use-case test and assert the key lifecycle records:

```ts
assertEquals(attributes['scheduler.operation'], 'run_source')
assertEquals(attributes['scheduler.outcome'], 'start')
assertEquals(attributes['source.id'], 'rust')
assertEquals(attributes['source.run_id'], 'run-1')
```

```ts
assertEquals(attributes['pipeline.operation'], 'filter')
assertEquals(attributes['pipeline.outcome'], 'filtered')
assertEquals(attributes['pipeline.item_id'], 'entry-1')
```

```ts
assertEquals(attributes['delivery.operation'], 'is_delivered')
assertEquals(attributes['delivery.outcome'], 'deduped')
assertEquals(attributes['delivery.id'], 'archive')
```

```ts
assertEquals(attributes['scheduler.operation'], 'run_source')
assertEquals(attributes['scheduler.outcome'], 'success')
assertEquals(attributes['source.item_count'], 4)
assertEquals(attributes['pipeline.filtered_count'], 1)
assertEquals(attributes['delivery.deduped_count'], 1)
assertEquals(attributes['delivery.pushed_count'], 2)
```

- [ ] **Step 2: Run the use-case test to verify it fails**

Run: `deno task test src/application/run_source_use_case_test.ts`
Expected: FAIL because `RunSourceUseCase` currently emits no lifecycle logs at all.

- [ ] **Step 3: Inject a logger into `RunSourceUseCase` and emit lifecycle logs**

Add the optional dep:

```ts
export interface RunSourceUseCaseDeps {
  now: () => string
  createRunId: () => string
  sourceInputGateway: SourceInputGateway
  sourceParser: SourceParser
  logger?: Logger
  // ...existing deps
}
```

Emit start/finalize logs in `execute()`:

```ts
this.deps.logger?.info('source 开始执行', {
  module: 'scheduler.source',
  'scheduler.operation': 'run_source',
  'scheduler.outcome': 'start',
  'source.id': plan.source.sourceId,
  'source.run_id': plan.runId,
  'scheduler.trigger': plan.trigger,
})
```

```ts
this.deps.logger?.info('source 执行完成', {
  module: 'scheduler.source',
  'scheduler.operation': 'run_source',
  'scheduler.outcome': finalized.status === 'failed' ? 'failure' : 'success',
  'source.id': plan.source.sourceId,
  'source.run_id': plan.runId,
  'source.item_count': parsed.items.length,
  'pipeline.filtered_count': counts.filteredCount,
  'delivery.deduped_count': counts.duplicateItemCount,
  'delivery.pushed_count': counts.deliveredCount,
  'delivery.failed_count': counts.failedAttemptCount,
})
```

Add the per-item filter/dedupe logs directly at the orchestration site so ownership stays visible:

```ts
this.deps.logger?.info('filter 结果', {
  module: 'pipeline.filter',
  'pipeline.operation': 'filter',
  'pipeline.outcome': 'filtered',
  'source.id': item.sourceId,
  'source.run_id': item.sourceRunId,
  'pipeline.item_id': item.normalized.id || item.itemId,
})
```

```ts
this.deps.logger?.info('命中去重', {
  module: 'delivery.store',
  'delivery.operation': 'is_delivered',
  'delivery.outcome': 'deduped',
  'source.id': item.sourceId,
  'source.run_id': item.sourceRunId,
  'pipeline.item_id': item.normalized.id || item.itemId,
  'delivery.id': binding.deliveryId,
})
```

Wire the logger from daemon bootstrap:

```ts
const runSourceUseCase = new RunSourceUseCase({
  now: () => new Date().toISOString(),
  createRunId: () => crypto.randomUUID(),
  sourceInputGateway: {
    fetch: (plan) =>
      selectSourceInputGateway(plan.source, {
        httpGateway,
        byparrGateway,
        summaryGateway,
      }).fetch(plan),
  },
  sourceParser,
  logger: logger.child({ module: 'scheduler.source' }),
  // ...existing deps
})
```

- [ ] **Step 4: Run the `RunSourceUseCase` verification**

Run: `deno task test src/application/run_source_use_case_test.ts`
Expected: PASS with start/filter/dedupe/finalize records using only namespaced fields.

- [ ] **Step 5: Commit the orchestration logging work**

```bash
git add src/application/run_source_use_case.ts src/application/run_source_use_case_test.ts src/interfaces/daemon/create_daemon_runtime.ts
git commit -m "feat(logging): add pipeline orchestration events"
```

---

### Task 5: Add attempt-level delivery stage observability without leaking payloads

**Files:**

- Modify: `src/application/stages/delivery_stage.ts`
- Modify: `src/application/stages/delivery_stage_test.ts`
- Modify: `src/application/run_source_use_case.ts`
- Test: `src/application/stages/delivery_stage_test.ts`
- Test: `src/application/run_source_use_case_test.ts`

- [ ] **Step 1: Add the failing delivery-stage log assertions**

In `src/application/stages/delivery_stage_test.ts`, add a logger-backed test that asserts:

```ts
assertEquals(attributes['delivery.operation'], 'dispatch')
assertEquals(attributes['delivery.outcome'], 'success')
assertEquals(attributes['delivery.id'], 'telegram')
assertEquals(attributes['pipeline.item_id'], 'item-1')
```

And for the failure path:

```ts
assertEquals(attributes['delivery.operation'], 'dispatch')
assertEquals(attributes['delivery.outcome'], 'failure')
assertEquals(attributes['delivery.id'], 'telegram')
assertEquals(attributes['exception.message'], 'telegram 500')
```

- [ ] **Step 2: Run the delivery-stage test to verify it fails**

Run: `deno task test src/application/stages/delivery_stage_test.ts`
Expected: FAIL because `DeliveryStage` currently records no logs.

- [ ] **Step 3: Add optional logger support to `DeliveryStage` and pass stable context from `RunSourceUseCase`**

Extend the stage deps:

```ts
export interface DeliveryStageDeps {
  now: () => string
  executor: DeliveryExecutor
  logger?: Logger
}
```

Log success/failure around the attempt:

```ts
this.deps.logger?.info('delivery 已分发', {
  module: 'delivery.runtime.dispatch',
  'delivery.operation': 'dispatch',
  'delivery.outcome': 'success',
  'delivery.id': plan.deliveryId,
  'pipeline.item_id': plan.itemId,
})
```

```ts
this.deps.logger?.error('delivery 分发失败', {
  module: 'delivery.runtime.dispatch',
  'delivery.operation': 'dispatch',
  'delivery.outcome': 'failure',
  'delivery.id': plan.deliveryId,
  'pipeline.item_id': plan.itemId,
  error_name: error instanceof Error ? error.name : 'Error',
  error_message: error instanceof Error ? error.message : String(error),
})
```

Pass the stage logger from `RunSourceUseCase`:

```ts
const attemptResult = await new DeliveryStage({
  now: this.deps.now,
  executor,
  logger: this.deps.logger?.child({ module: 'delivery.runtime.dispatch' }),
}).run(attemptPlan)
```

- [ ] **Step 4: Run the delivery-stage verification**

Run: `deno task test src/application/stages/delivery_stage_test.ts src/application/run_source_use_case_test.ts`
Expected: PASS with attempt-level dispatch logs and no payload/body leakage.

- [ ] **Step 5: Commit the delivery-stage observability work**

```bash
git add src/application/stages/delivery_stage.ts src/application/stages/delivery_stage_test.ts src/application/run_source_use_case.ts src/application/run_source_use_case_test.ts
git commit -m "feat(logging): add delivery attempt dispatch logs"
```

---

### Task 6: Sync logger contract tests with the repository-level field policy

**Files:**

- Modify: `src/core/logger_test.ts`
- Test: `src/core/logger_test.ts`

- [ ] **Step 1: Replace producer-specific bare-field examples with namespaced examples**

Update the logger tests so generic logger invariants still hold, but use repository-approved field examples:

```ts
logger.info('启动完成', {
  'app.operation': 'boot',
  'app.outcome': 'success',
})
logger.error('启动失败', {
  'app.operation': 'boot',
  'app.outcome': 'failure',
})
```

```ts
logger.warn('重入跳过', {
  'scheduler.operation': 'run_source',
  'scheduler.outcome': 'skipped',
  'scheduler.reason': 'reentry_inflight',
})
```

```ts
logger.info('推送完成', {
  'delivery.operation': 'push',
  'delivery.outcome': 'success',
  sourceUrl: 'https://user:pass@example.com/feed.xml?token=abc',
  token: '123456:ABCDEF-SECRET',
})
```

- [ ] **Step 2: Run the logger test to verify the old expectations break first**

Run: `deno task test src/core/logger_test.ts`
Expected: FAIL before the assertions are fully updated, because the test fixture names still look for bare fields.

- [ ] **Step 3: Finish the assertion updates in `src/core/logger_test.ts`**

Use namespaced assertions throughout the producer-shape examples:

```ts
assertEquals(attributes['app.operation'], 'boot')
assertEquals(attributes['app.outcome'], 'success')
assertEquals('operation' in attributes, false)
assertEquals('outcome' in attributes, false)
```

```ts
assertEquals(attributes['delivery.operation'], 'push')
assertEquals(attributes['delivery.outcome'], 'success')
```

- [ ] **Step 4: Run the logger verification**

Run: `deno task test src/core/logger_test.ts`
Expected: PASS with generic logger invariants still intact and all producer examples now owner-scoped.

- [ ] **Step 5: Commit the logger test alignment**

```bash
git add src/core/logger_test.ts
git commit -m "test(logging): align logger fixtures with namespaced fields"
```

---

### Task 7: Sync rules, skill guidance, and README with the real v2 execution points

**Files:**

- Modify: `.claude/rules/logging-otel.md`
- Modify: `.claude/rules/logging-console.md`
- Modify: `.claude/skills/otel-logging-design/SKILL.md`
- Modify: `README.md`

- [ ] **Step 1: Update rule/doc text to describe the current codebase, not deleted runtime helpers**

Adjust the rule/doc text so it points at the real v2 execution points:

```md
- source fetch/parse 可观测性当前落在 infrastructure source adapters（如 `http_source_input_gateway.ts`、`byparr_source_input_gateway.ts`、`source_parser_gateway.ts`）。
- pipeline filter/dedupe/delivery/finalize 可观测性当前落在 `RunSourceUseCase` 与其 stages，而不是历史 `source_runtime` / `delivery_runtime` helper。
- `pretty` 只做展示层裁剪；owner-scoped 业务字段仍以底层 JSON record 为准。
```

Keep the existing hard rules about `template.ai.*`, `response_body`, and the nine business roots.

- [ ] **Step 2: Add or update any README examples that mention the final logging contract**

Use concrete namespaced examples:

```md
- source 执行链路的关键关联键：`source.id`、`source.run_id`、`pipeline.item_id`、`delivery.id`
- AI 模板链路：`template.ai.provider`、`template.ai.model_ref`、`template.ai.outcome`
- HTTP failure logs 不记录原始响应体，只记录 `delivery.reason`、`http.response.status_code` 与安全错误摘要
```

- [ ] **Step 3: Run formatting/lint/check on the touched paths**

Run: `deno task fmt:check src/core/scheduler.ts src/core/scheduler_test.ts src/interfaces/daemon/create_daemon_runtime.ts src/interfaces/daemon/start_daemon_test.ts src/application/run_source_use_case.ts src/application/run_source_use_case_test.ts src/application/stages/delivery_stage.ts src/application/stages/delivery_stage_test.ts src/infrastructure/sources/http_source_input_gateway.ts src/infrastructure/sources/http_source_input_gateway_test.ts src/infrastructure/sources/byparr_source_input_gateway.ts src/infrastructure/sources/byparr_source_input_gateway_test.ts src/infrastructure/sources/source_parser_gateway.ts src/infrastructure/sources/source_parser_gateway_test.ts src/core/logger_test.ts .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/skills/otel-logging-design/SKILL.md README.md`

Run: `deno task lint:check src/core/scheduler.ts src/core/scheduler_test.ts src/interfaces/daemon/create_daemon_runtime.ts src/interfaces/daemon/start_daemon_test.ts src/application/run_source_use_case.ts src/application/run_source_use_case_test.ts src/application/stages/delivery_stage.ts src/application/stages/delivery_stage_test.ts src/infrastructure/sources/http_source_input_gateway.ts src/infrastructure/sources/http_source_input_gateway_test.ts src/infrastructure/sources/byparr_source_input_gateway.ts src/infrastructure/sources/byparr_source_input_gateway_test.ts src/infrastructure/sources/source_parser_gateway.ts src/infrastructure/sources/source_parser_gateway_test.ts src/core/logger_test.ts`

Run: `deno task check src/core/scheduler.ts src/interfaces/daemon/create_daemon_runtime.ts src/application/run_source_use_case.ts src/application/stages/delivery_stage.ts src/infrastructure/sources/http_source_input_gateway.ts src/infrastructure/sources/byparr_source_input_gateway.ts src/infrastructure/sources/source_parser_gateway.ts`

Expected: PASS for all touched code/doc paths.

- [ ] **Step 4: Commit the rule/doc sync**

```bash
git add .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/skills/otel-logging-design/SKILL.md README.md
git commit -m "docs(logging): sync rules with v2 execution points"
```

---

### Task 8: Run full verification and final audit

**Files:**

- Modify: none
- Test: `src/**`
- Test: `web/**`

- [ ] **Step 1: Run the full test suite**

Run: `deno task test`
Expected: PASS across `src` and `web` after the logging sweep changes.

- [ ] **Step 2: Audit for forbidden legacy runtime fields**

Run: `rg -n "\bresponse_body\b|['\"]ai\.[^'\"]+['\"]|\boperation:\s|\boutcome:\s|\breason:\s" src web .claude README.md`
Expected: remaining matches are limited to config-model `ai.*`, domain/storage `reason` fields, or intentional historical/spec text — not runtime structured log payload code paths.

- [ ] **Step 3: Spot-check the key runtime surfaces**

Run: `deno task test src/core/scheduler_test.ts src/application/run_source_use_case_test.ts src/infrastructure/sources/source_parser_gateway_test.ts src/application/stages/delivery_stage_test.ts src/core/logger_test.ts src/config/load_config_test.ts src/db/client_test.ts web/main_test.ts`
Expected: PASS across the scheduler, orchestration, source adapter, delivery stage, logger, config, db, and web surfaces that define the final logging contract.

- [ ] **Step 4: Record any skipped runtime smoke checks in the final summary**

```md
- Ran: `deno task test`
- Ran: scoped `test` / `check` / `lint:check` / `fmt:check`
- Ran or skipped: daemon/web smoke, with reason
- Remaining risk: only if live runtime entrypoints were not exercised locally
```

- [ ] **Step 5: Commit the final verified state**

```bash
git add src web .claude README.md config.example.yml
git commit -m "refactor(logging): complete otel contract continuation"
```

---

## Self-Review Checklist

- Spec coverage mapped:
  - remaining bare scheduler fields → Task 1
  - daemon/bootstrap drift and stale base field → Task 2
  - source fetch/parse observability at actual adapter boundary → Task 3
  - pipeline/filter/dedupe/finalize orchestration logs → Task 4
  - attempt-level delivery observability → Task 5
  - logger fixture cleanup → Task 6
  - rules/docs/skill/example sync → Task 7
  - end-to-end verification → Task 8
- Placeholder scan: no `TODO` / `TBD` / “similar to Task N” shortcuts remain.
- Type consistency:
  - new logging deps stay optional on existing classes
  - application emits pipeline/delivery lifecycle logs, infrastructure emits fetch/parse adapter logs
  - AI config-model `ai.*` references remain config-only; runtime logs continue to use `template.ai.*`
  - no deleted `source_runtime` / `delivery_runtime` files are referenced as implementation targets
