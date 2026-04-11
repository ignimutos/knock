# Knock OTel Logging Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all daemon, web, source, pipeline, template, delivery, db, and config logs with the approved OTel-style repository rules using owner-scoped attributes and no legacy/high-leakage fields.

**Architecture:** Keep `src/core/logger.ts` as the single place that builds OTel-style records, validates trace fields, applies standard semantic remaps, and redacts output. Move business-field ownership to each log producer, re-keying emitted attributes into the existing nine namespaces, then fill observability gaps in source/delivery/db middle layers without introducing new sinks, SDKs, or compatibility shims.

**Tech Stack:** Deno, TypeScript, Fresh, zod, Drizzle ORM, `@logtape/pretty`, `@logtape/redaction`

---

## File Map

### Shared logging core

- Modify: `src/core/logger.ts` — omit missing values instead of serializing placeholder empty strings; keep standard key remap behavior.
- Test: `src/core/logger_test.ts` — lock logger invariants around omission, trace fields, semconv remap, and pretty/json boundaries.

### High-traffic producers

- Modify: `src/core/source_processor.ts` — re-key source/pipeline/delivery/scheduler fields and lift expected high-frequency non-success outcomes to `INFO`.
- Modify: `src/core/app.ts` — re-key app and scheduler startup fields.
- Modify: `src/config/load_config.ts` — re-key config load/validate/resolve fields.
- Modify: `web/main.ts` — re-key web request lifecycle fields while keeping current bootstrap model.
- Modify: `src/core/ai_runtime.ts` — replace top-level `ai.*` with `template.ai.*` and keep safe diagnostics.
- Modify: `src/core/liquid_runtime.ts` — move template filter/render metrics into `template.*`.
- Modify: `src/deliveries/http.ts` — delete `response_body` logging and re-key delivery fields.
- Modify: `src/deliveries/email.ts` — re-key delivery fields, preserve standard exception fields.
- Modify: `src/deliveries/file.ts` — re-key rotation/write fields and add explicit failure logging.
- Modify: `src/db/client.ts` — re-key db init/vacuum fields.

### Middle-layer observability

- Modify: `src/sources/source_runtime.ts` — add minimal fetch/parse runtime logs with safe payload-free fields.
- Modify: `src/deliveries/delivery_runtime.ts` — add dispatch/build/render runtime logs.
- Modify: `src/db/source_state_store.ts` — add persist/dedupe/prune runtime logs.
- Modify: `src/core/content_runtime.ts` — only if needed to pass logger/context through new middle-layer log points.

### Rules and docs

- Modify: `.claude/rules/logging-otel.md` — codify `<owner>.ai.*`, remove ambiguity around raw response bodies, keep 9-root rule explicit.
- Modify: `.claude/rules/logging-console.md` — sync pretty-display examples with new namespaced keys.
- Modify: `.claude/skills/otel-logging-design/SKILL.md` — replace stale flat-field and `ai.*` examples.
- Modify: `README.md` — sync public logging contract and examples.
- Modify: `config.example.yml` — sync comments/examples only if needed; do not add new logging config fields.

### Main test files

- `src/core/logger_test.ts`
- `src/core/source_processor_test.ts`
- `src/core/app_test.ts`
- `src/config/load_config_test.ts`
- `src/core/ai_runtime_test.ts`
- `src/core/content_runtime_test.ts`
- `src/core/liquid_runtime_test.ts`
- `src/deliveries/http_test.ts`
- `src/deliveries/email_test.ts`
- `src/deliveries/file_test.ts`
- `src/deliveries/delivery_runtime_test.ts`
- `src/db/client_test.ts`
- `src/db/source_state_store_test.ts`
- `src/sources/source_runtime_test.ts`
- `web/main_test.ts`

---

### Task 1: Lock shared logger invariants

**Files:**

- Modify: `src/core/logger.ts`
- Modify: `src/core/logger_test.ts`
- Test: `src/core/logger_test.ts`

- [ ] **Step 1: Write the failing logger omission test**

```ts
Deno.test('logger: null 字段应直接省略而不是序列化为空字符串', () => {
  const stdout: string[] = []
  const logger = createLogger({
    enabled: true,
    level: 'info',
    module: 'app.startup',
    now: () => new Date('2026-03-24T21:45:12.345Z'),
    writeStdout: (line: string) => stdout.push(line),
  })

  logger.info('省略缺失字段', {
    'config.path': null,
    'delivery.reason': undefined,
    'source.id': 'rust',
  })

  const record = parseRecord(stdout[0])
  const attributes = getAttributes(record)

  assertEquals('config.path' in attributes, false)
  assertEquals('delivery.reason' in attributes, false)
  assertEquals(attributes['source.id'], 'rust')
})
```

- [ ] **Step 2: Run logger test to verify it fails**

Run: `deno task test src/core/logger_test.ts`
Expected: FAIL because `config.path` is currently serialized as an empty string.

- [ ] **Step 3: Implement omission semantics in `src/core/logger.ts`**

```ts
function normalizeValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  return value
}

function sanitizeValue(fieldKey: string, value: unknown): unknown {
  if (value === undefined || value === null) return undefined

  if (SENSITIVE_FIELD_KEYS.has(fieldKey)) return '****'

  if (typeof value === 'string') {
    const normalized = normalizeValue(value)
    if (typeof normalized !== 'string') return normalized
    if (URL_FIELD_KEYS.has(fieldKey)) return sanitizeUrl(normalized)
    return redactText(normalized)
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(fieldKey, item))
      .filter((item) => item !== undefined)
  }

  if (typeof value === 'object') {
    return sanitizeFields(value as Record<string, unknown>)
  }

  return value
}
```

- [ ] **Step 4: Run logger regression tests**

Run: `deno task test src/core/logger_test.ts`
Expected: PASS for the new omission test and existing JSON/pretty/trace/redaction assertions.

- [ ] **Step 5: Commit the logger invariant change**

```bash
git add src/core/logger.ts src/core/logger_test.ts
git commit -m "refactor(logging): omit missing structured fields"
```

---

### Task 2: Re-key source pipeline logs and fix level policy

**Files:**

- Modify: `src/core/source_processor.ts`
- Modify: `src/core/source_processor_test.ts`
- Test: `src/core/source_processor_test.ts`

- [ ] **Step 1: Write failing source pipeline assertions for namespaced keys and INFO-level filter/dedupe logs**

```ts
assertEquals(
  logs.some((line) => {
    const scope = (line.scope ?? {}) as Record<string, unknown>
    const attributes = (line.attributes ?? {}) as Record<string, unknown>
    return (
      line.severityText === 'INFO' &&
      line.body === 'filter 结果' &&
      scope.name === 'pipeline.filter' &&
      attributes['pipeline.operation'] === 'filter' &&
      attributes['pipeline.outcome'] === 'filtered' &&
      attributes['pipeline.item_id'] === 'filtered'
    )
  }),
  true,
)

assertEquals(
  logs.some((line) => {
    const scope = (line.scope ?? {}) as Record<string, unknown>
    const attributes = (line.attributes ?? {}) as Record<string, unknown>
    return (
      line.severityText === 'INFO' &&
      line.body === '命中去重' &&
      scope.name === 'delivery.store' &&
      attributes['delivery.operation'] === 'is_delivered' &&
      attributes['delivery.outcome'] === 'deduped' &&
      attributes['pipeline.item_id'] === 'deduped'
    )
  }),
  true,
)

assertEquals(
  logs.some((line) => {
    const attributes = (line.attributes ?? {}) as Record<string, unknown>
    return (
      line.body === 'source 执行完成' &&
      attributes['scheduler.operation'] === 'run_source' &&
      attributes['scheduler.outcome'] === 'success' &&
      attributes['source.item_count'] === 4 &&
      attributes['pipeline.passed_count'] === 2 &&
      attributes['delivery.deduped_count'] === 1 &&
      attributes['delivery.pushed_count'] === 1
    )
  }),
  true,
)
```

- [ ] **Step 2: Run source processor test to verify it fails**

Run: `deno task test src/core/source_processor_test.ts`
Expected: FAIL because current logs still emit bare `operation/outcome/*_count` and `DEBUG` filter/dedupe logs.

- [ ] **Step 3: Re-key source, pipeline, delivery, and scheduler fields in `src/core/source_processor.ts`**

```ts
sourceRunLogger.info('source 开始执行', {
  'scheduler.operation': 'run_source',
  'scheduler.outcome': 'start',
})

createFetchLogger(options.logger, source.id, runId).info('抓取成功', {
  'source.operation': 'fetch',
  'source.outcome': 'success',
  'source.fetch_duration_ms': parsed.timing.fetchDurationMs,
  'source.payload_bytes': parsed.payload.length,
})

options.logger.info('filter 结果', {
  module: 'pipeline.filter',
  'pipeline.operation': 'filter',
  'pipeline.outcome': passed ? 'passed' : 'filtered',
  ...itemLogFields,
  'pipeline.duration_ms': now() - filterStartedAt,
})

options.logger.info('命中去重', {
  module: 'delivery.store',
  'delivery.operation': 'is_delivered',
  'delivery.outcome': 'deduped',
  ...deliveryLogFields,
})

sourceRunLogger.info('source 执行完成', {
  'scheduler.operation': 'run_source',
  'scheduler.outcome': 'success',
  'source.item_count': parsed.entries.length,
  'pipeline.passed_count': passedCount,
  'delivery.deduped_count': dedupedCount,
  'delivery.pushed_count': pushedCount,
  'scheduler.duration_ms': now() - startedAt,
})
```

- [ ] **Step 4: Run source processor verification**

Run: `deno task test src/core/source_processor_test.ts`
Expected: PASS with INFO-level filter/dedupe logs and namespaced summary fields.

- [ ] **Step 5: Commit the source pipeline sweep**

```bash
git add src/core/source_processor.ts src/core/source_processor_test.ts
git commit -m "refactor(logging): namespace source pipeline fields"
```

---

### Task 3: Re-key app, config, and web request logs

**Files:**

- Modify: `src/core/app.ts`
- Modify: `src/config/load_config.ts`
- Modify: `web/main.ts`
- Modify: `src/config/load_config_test.ts`
- Modify: `src/core/app_test.ts`
- Modify: `web/main_test.ts`
- Test: `src/config/load_config_test.ts`
- Test: `src/core/app_test.ts`
- Test: `web/main_test.ts`

- [ ] **Step 1: Write failing config and web assertions for owner-scoped fields**

```ts
assertEquals(attributes['config.operation'], 'load_config')
assertEquals(attributes['config.outcome'], 'success')
assertEquals(attributes['config.path'], configPath)
assertEquals(attributes['config.runtime_dir'], runtimeDir)
```

```ts
assertEquals(startAttributes['web.operation'], 'request')
assertEquals(startAttributes['web.outcome'], 'start')
assertEquals(successAttributes['web.outcome'], 'success')
assertEquals(typeof successAttributes['web.duration_ms'], 'number')
assertEquals('outcome' in successAttributes, false)
```

- [ ] **Step 2: Run targeted app/config/web tests to verify they fail**

Run: `deno task test src/config/load_config_test.ts src/core/app_test.ts web/main_test.ts`
Expected: FAIL because these files still emit bare `operation/outcome/config_path/runtime_dir` keys.

- [ ] **Step 3: Re-key emitted fields in `src/core/app.ts`, `src/config/load_config.ts`, and `web/main.ts`**

```ts
logger.info('启动完成', {
  'app.operation': 'startup',
  'app.outcome': 'success',
  'source.count': config.sources.length,
  'source.enabled_count': enabledSources.length,
  'source.disabled_count': config.sources.length - enabledSources.length,
  'delivery.count': config.deliveries.length,
  'scheduler.scheduled_source_count': scheduledSources.length,
})
```

```ts
options.logger?.info('配置加载完成', {
  module: 'config.load',
  'config.operation': 'load_config',
  'config.outcome': 'success',
  'config.path': configPath,
  'config.runtime_dir': runtimeDir,
})
```

```ts
routeLogger.debug('API 请求开始', {
  'web.operation': 'request',
  'web.outcome': 'start',
  method: ctx.req.method,
  'web.request_id': requestId,
})

routeLogger[level](response.ok ? 'API 请求完成' : 'API 请求失败', {
  'web.operation': 'request',
  'web.outcome': response.ok ? 'success' : 'failure',
  method: ctx.req.method,
  'web.duration_ms': Date.now() - startedAt,
  http_status: response.ok ? undefined : response.status,
  'web.request_id': requestId,
})
```

- [ ] **Step 4: Run app/config/web verification**

Run: `deno task test src/config/load_config_test.ts src/core/app_test.ts web/main_test.ts`
Expected: PASS with namespaced `config.*`, `app.*`, `scheduler.*`, and `web.*` fields.

- [ ] **Step 5: Commit the app/config/web field migration**

```bash
git add src/core/app.ts src/config/load_config.ts web/main.ts src/config/load_config_test.ts src/core/app_test.ts web/main_test.ts
git commit -m "refactor(logging): align app config and web fields"
```

---

### Task 4: Migrate AI and template logs to `template.*`

**Files:**

- Modify: `src/core/ai_runtime.ts`
- Modify: `src/core/ai_runtime_test.ts`
- Modify: `src/core/liquid_runtime.ts`
- Modify: `src/core/content_runtime_test.ts`
- Modify: `src/core/liquid_runtime_test.ts`
- Test: `src/core/ai_runtime_test.ts`
- Test: `src/core/content_runtime_test.ts`
- Test: `src/core/liquid_runtime_test.ts`

- [ ] **Step 1: Write failing AI/template assertions for `template.ai.*` and `template.*` fields**

```ts
assertEquals(attributes['template.ai.operation'], 'generate')
assertEquals(attributes['template.ai.outcome'], 'success')
assertEquals(attributes['template.ai.provider'], 'openai')
assertEquals(attributes['template.ai.model_ref'], 'openai_main/default')
assertEquals('ai.provider' in attributes, false)
```

```ts
assertEquals(attributes['template.filter_name'], 'to_telegram_html')
assertEquals(attributes['template.operation'], 'sanitize_telegram_html')
assertEquals(attributes['template.reason'], 'semantic_loss')
assertEquals(attributes['template.changed'], true)
```

- [ ] **Step 2: Run targeted AI/template tests to verify they fail**

Run: `deno task test src/core/ai_runtime_test.ts src/core/content_runtime_test.ts src/core/liquid_runtime_test.ts`
Expected: FAIL because logs still use top-level `ai.*` and bare `filter_name/operation/reason/changed`.

- [ ] **Step 3: Re-key AI and template metrics in `src/core/ai_runtime.ts` and `src/core/liquid_runtime.ts`**

```ts
const baseLogFields = {
  'template.ai.operation': 'generate',
  'source.id': callOptions.entryRuntime.sourceId,
  'source.run_id': callOptions.entryRuntime.sourceRunId,
  'pipeline.item_id': callOptions.entryRuntime.entryId,
  'template.ai.input_length': callOptions.inputText.length,
  'template.ai.truncated': callOptions.truncated ?? false,
  'template.ai.provider': callOptions.invocation.provider.type,
  'template.ai.provider_id': callOptions.invocation.provider.id,
  'template.ai.model': callOptions.invocation.model.model,
  'template.ai.model_ref': callOptions.invocation.model.ref,
  'template.ai.prompt_id': callOptions.promptId,
  'template.ai.stage': callOptions.stage,
  'template.ai.cache': false,
  'template.ai.chunk': callOptions.chunkIndex !== undefined,
}
```

```ts
const fields = {
  'template.changed': result.metrics.changed,
  'template.filter_name': 'to_telegram_html',
  'template.normalized_tag_count': result.metrics.normalizedTagCount,
  'template.operation': 'sanitize_telegram_html',
  'template.reason': result.metrics.reason,
  'template.removed_attribute_count': result.metrics.removedAttributeCount,
  'template.removed_link_count': result.metrics.removedLinkCount,
  'template.semantic_loss_tag_count': result.metrics.semanticLossTagCount,
  'template.stripped_tag_count': result.metrics.strippedTagCount,
}
```

- [ ] **Step 4: Run AI/template verification**

Run: `deno task test src/core/ai_runtime_test.ts src/core/content_runtime_test.ts src/core/liquid_runtime_test.ts`
Expected: PASS with `template.ai.*` and `template.*` only.

- [ ] **Step 5: Commit the AI/template migration**

```bash
git add src/core/ai_runtime.ts src/core/ai_runtime_test.ts src/core/liquid_runtime.ts src/core/content_runtime_test.ts src/core/liquid_runtime_test.ts
git commit -m "refactor(logging): scope ai and template attributes"
```

---

### Task 5: Re-key delivery/db logs and remove raw response bodies

**Files:**

- Modify: `src/deliveries/http.ts`
- Modify: `src/deliveries/email.ts`
- Modify: `src/deliveries/file.ts`
- Modify: `src/db/client.ts`
- Modify: `src/deliveries/http_test.ts`
- Modify: `src/deliveries/email_test.ts`
- Modify: `src/deliveries/file_test.ts`
- Modify: `src/db/client_test.ts`
- Test: `src/deliveries/http_test.ts`
- Test: `src/deliveries/email_test.ts`
- Test: `src/deliveries/file_test.ts`
- Test: `src/db/client_test.ts`

- [ ] **Step 1: Write failing delivery/db assertions for namespaced keys and missing `response_body`**

```ts
assertEquals(attributes['delivery.operation'], 'push')
assertEquals(attributes['delivery.outcome'], 'failure')
assertEquals(attributes['http.response.status_code'], 502)
assertEquals('response_body' in attributes, false)
```

```ts
assertEquals(attributes['db.operation'], 'init_db')
assertEquals(attributes['db.outcome'], 'success')
assertEquals(attributes['db.path'], databasePath)
```

- [ ] **Step 2: Run delivery/db tests to verify they fail**

Run: `deno task test src/deliveries/http_test.ts src/deliveries/email_test.ts src/deliveries/file_test.ts src/db/client_test.ts`
Expected: FAIL because current logs still use bare `operation/outcome/path`, and HTTP failure logs still include `response_body`.

- [ ] **Step 3: Re-key delivery/db fields and add explicit file failure logging**

```ts
options.logger?.error('HTTP 推送失败', {
  'delivery.operation': 'push',
  'delivery.outcome': 'failure',
  ...logFields,
  http_status: response.status,
  error_name: 'HttpDeliveryError',
  error_message: message,
})
```

```ts
try {
  await Deno.writeTextFile(targetPath, `${req.content}\n`, { append: true })
  options.logger?.info('写入文件成功', {
    'delivery.operation': 'push',
    'delivery.outcome': 'success',
    ...logFields,
    'delivery.rotation_enabled': rotation?.enabled ?? false,
  })
} catch (error) {
  options.logger?.error('写入文件失败', {
    'delivery.operation': 'push',
    'delivery.outcome': 'failure',
    ...logFields,
    error_name: error instanceof Error ? error.name : 'Error',
    error_message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  throw error
}
```

```ts
logger?.info('sqlite 初始化完成', {
  module: 'db.sqlite',
  'db.operation': 'init_db',
  'db.outcome': 'success',
  'db.path': databasePath,
})
```

- [ ] **Step 4: Run delivery/db verification**

Run: `deno task test src/deliveries/http_test.ts src/deliveries/email_test.ts src/deliveries/file_test.ts src/db/client_test.ts`
Expected: PASS with `delivery.*` / `db.*` fields and no raw `response_body`.

- [ ] **Step 5: Commit the delivery/db sweep**

```bash
git add src/deliveries/http.ts src/deliveries/email.ts src/deliveries/file.ts src/db/client.ts src/deliveries/http_test.ts src/deliveries/email_test.ts src/deliveries/file_test.ts src/db/client_test.ts
git commit -m "refactor(logging): align delivery and db records"
```

---

### Task 6: Fill source/delivery/db middle-layer observability gaps

**Files:**

- Modify: `src/sources/source_runtime.ts`
- Modify: `src/deliveries/delivery_runtime.ts`
- Modify: `src/db/source_state_store.ts`
- Modify: `src/core/content_runtime.ts`
- Modify: `src/sources/source_runtime_test.ts`
- Modify: `src/deliveries/delivery_runtime_test.ts`
- Modify: `src/db/source_state_store_test.ts`
- Test: `src/sources/source_runtime_test.ts`
- Test: `src/deliveries/delivery_runtime_test.ts`
- Test: `src/db/source_state_store_test.ts`

- [ ] **Step 1: Write failing tests for new middle-layer log points**

```ts
assertEquals(attributes['source.operation'], 'fetch_payload')
assertEquals(attributes['source.outcome'], 'success')
assertEquals(attributes['source.fetch_duration_ms'], 12)
```

```ts
assertEquals(attributes['delivery.operation'], 'dispatch')
assertEquals(attributes['delivery.outcome'], 'success')
assertEquals(attributes['delivery.id'], 'webhook')
```

```ts
assertEquals(attributes['db.operation'], 'dedupe_check')
assertEquals(attributes['db.outcome'], 'deduped')
assertEquals(attributes['source.id'], 'rust')
assertEquals(attributes['pipeline.item_id'], 'entry-1')
```

- [ ] **Step 2: Run middle-layer tests to verify they fail**

Run: `deno task test src/sources/source_runtime_test.ts src/deliveries/delivery_runtime_test.ts src/db/source_state_store_test.ts`
Expected: FAIL because these runtime layers currently emit little or no direct logs.

- [ ] **Step 3: Add minimal runtime log points without logging payloads/bodies**

```ts
export interface FetchAndParseSourceInput {
  source: ResolvedSourceConfig
  httpClient: HttpClient
  logger?: Logger
  timeOptions: {
    timezone: string
    timestampFormat: string
  }
  aiRuntime?: AiRuntime
}
```

```ts
input.logger?.info('source payload 抓取完成', {
  module: 'source.runtime.fetch',
  'source.operation': 'fetch_payload',
  'source.outcome': 'success',
  'source.id': input.source.id,
  'source.fetch_duration_ms': fetchDurationMs,
})
```

```ts
dependencies.logger?.info('delivery 已分发', {
  module: 'delivery.runtime.dispatch',
  'delivery.operation': 'dispatch',
  'delivery.outcome': 'success',
  'delivery.id': delivery.id,
  ...(getLogFields(templateContext) ?? {}),
})
```

```ts
logger?.info('命中已投递记录', {
  module: 'db.state.store',
  'db.operation': 'dedupe_check',
  'db.outcome': 'deduped',
  'source.id': sourceId,
  'pipeline.item_id': itemId,
  'delivery.id': deliveryId,
})
```

- [ ] **Step 4: Run middle-layer verification**

Run: `deno task test src/sources/source_runtime_test.ts src/deliveries/delivery_runtime_test.ts src/db/source_state_store_test.ts`
Expected: PASS with payload-free runtime logs and stable scope/attribute ownership.

- [ ] **Step 5: Commit the middle-layer observability work**

```bash
git add src/sources/source_runtime.ts src/deliveries/delivery_runtime.ts src/db/source_state_store.ts src/core/content_runtime.ts src/sources/source_runtime_test.ts src/deliveries/delivery_runtime_test.ts src/db/source_state_store_test.ts
git commit -m "feat(logging): add runtime observability checkpoints"
```

---

### Task 7: Sync rules, docs, and design helpers

**Files:**

- Modify: `.claude/rules/logging-otel.md`
- Modify: `.claude/rules/logging-console.md`
- Modify: `.claude/skills/otel-logging-design/SKILL.md`
- Modify: `README.md`
- Modify: `config.example.yml`
- Test: `src/config/config_example_test.ts`

- [ ] **Step 1: Update docs and rules to match the implemented contract**

```md
- AI 相关字段 MUST 采用 `<owner>.ai.*`，例如 `template.ai.*`、`source.ai.*`、`delivery.ai.*`。
- MUST NOT 记录原始 `response_body`、请求体、模板渲染结果、消息正文或其他高泄漏原文。
- `filter hit`、`dedupe-hit`、`skip`、`empty-result` 这类预期内高频非成功结果 SHOULD 默认为 `info`。
```

```md
- `pretty` 展示 MAY 拍平高频业务键（如 `source.id`、`source.run_id`、`pipeline.item_id`、`delivery.id`、`web.request_id`、`template.ai.model_ref`），但这些都 MUST 只发生在展示层。
```

- [ ] **Step 2: Run config example and docs-adjacent verification**

Run: `deno task test src/config/config_example_test.ts src/config/load_config_test.ts`
Expected: PASS with README/config example still matching current schema and behavior.

- [ ] **Step 3: Update public README examples and skill examples**

```md
- daemon 链路定位优先通过 `source.id`、`source.run_id`、`pipeline.item_id`、`delivery.id`、`web.request_id`
- AI 相关字段按 owner-scoped namespace 记录，例如 `template.ai.provider`、`template.ai.model_ref`
- HTTP failure logs 不再记录原始响应体，只保留状态码和安全错误摘要
```

- [ ] **Step 4: Run formatting/lint/check on touched docs and code**

Run: `deno task fmt:check src/core/logger.ts src/core/source_processor.ts src/core/app.ts src/config/load_config.ts src/core/ai_runtime.ts src/core/liquid_runtime.ts src/deliveries src/db src/sources web README.md config.example.yml .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/skills/otel-logging-design/SKILL.md`

Run: `deno task lint:check src/core/logger.ts src/core/source_processor.ts src/core/app.ts src/config/load_config.ts src/core/ai_runtime.ts src/core/liquid_runtime.ts src/deliveries src/db src/sources web`

Run: `deno task check src/core/logger.ts src/core/source_processor.ts src/core/app.ts src/config/load_config.ts src/core/ai_runtime.ts src/core/liquid_runtime.ts src/deliveries src/db src/sources web/main.ts`

Expected: PASS for all touched paths.

- [ ] **Step 5: Commit the rule/doc sync**

```bash
git add .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/skills/otel-logging-design/SKILL.md README.md config.example.yml
git commit -m "docs(logging): sync otel contract guidance"
```

---

### Task 8: Run full verification and final repo audit

**Files:**

- Modify: none
- Test: `src/**`
- Test: `web/**`

- [ ] **Step 1: Run the full test suite**

Run: `deno task test`
Expected: PASS across `src` and `web` after shared-runtime logging changes.

- [ ] **Step 2: Audit for forbidden legacy fields**

Run: `rg -n "response_body|\bai\.|\boperation:\s|'operation'|\boutcome:\s|'outcome'|\breason:\s|'reason'" src web .claude README.md config.example.yml`
Expected: matches only in intentional historical text or updated rules/spec, not in final runtime log payload code paths.

- [ ] **Step 3: Smoke-check runtime entrypoints if a local sandbox exists**

Run: `deno task daemon`
Expected: JSON logs parse, namespaced attributes present, no raw bodies leak.

Run: `deno task web`
Expected: `/api/xquery/evaluate` emits `web.request_id`, standard HTTP fields, and owner-scoped business keys.

- [ ] **Step 4: Record any skipped smoke checks in the final summary**

```md
- Ran: `deno task test`
- Ran: scoped `check` / `lint:check` / `fmt:check`
- Ran or skipped: daemon/web smoke, with reason
- Remaining risk: only if local runtime sandbox was unavailable
```

- [ ] **Step 5: Commit the final verified state**

```bash
git add src web .claude README.md config.example.yml
git commit -m "refactor(logging): complete otel contract sweep"
```

---

## Self-Review Checklist

- Spec coverage mapped:
  - OTel record invariants → Task 1
  - owner-scoped producer fields → Tasks 2-5
  - AI namespace migration → Task 4
  - raw response body removal → Task 5
  - middle-layer observability → Task 6
  - docs/rules/skill sync → Task 7
  - end-to-end verification → Task 8
- Placeholder scan: no `TODO` / `TBD` / “similar to” shortcuts remain.
- Type consistency:
  - `template.ai.*` is used consistently, never mixed with top-level `ai.*`
  - `delivery.*`, `db.*`, `pipeline.*`, `scheduler.*`, `config.*`, `web.*`, `source.*`, `app.*`, `template.*` are used consistently across tasks
  - standard remap keys remain `http.request.method`, `http.route`, `http.response.status_code`, `exception.*`
