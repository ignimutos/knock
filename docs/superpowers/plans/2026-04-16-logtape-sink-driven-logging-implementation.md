# LogTape Sink-Driven Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild knock logging around LogTape-managed sinks/formatters/rotation/redaction while keeping the repository’s OTel-style JSON contract and introducing explicit per-sink logging configuration.

**Architecture:** Replace the current global `logging.format` + implicit console behavior with explicit `logging.sinks.*` configuration and a LogTape-backed runtime bootstrap. Shrink `src/core/logger.ts` into a contract-focused adapter that normalizes fields and emits LogTape records, then let LogTape dispatch to console/file sinks using a repository JSONL formatter and a custom high-density pretty formatter.

**Tech Stack:** Deno, TypeScript, zod, Fresh, `@logtape/logtape`, `@logtape/redaction`, `@logtape/file`, Luxon

---

## File Map

### Config contract and docs

- Modify: `deno.json` — add `@logtape/file` import.
- Modify: `src/config/schema.ts` — replace top-level `logging.format` with explicit console/file sink schemas and rotation union types.
- Modify: `src/config/types.ts` — update logging resolved/input types for per-sink format and file rotation.
- Modify: `src/config/resolve_config.ts` — resolve the new sink-driven logging shape.
- Modify: `src/config/validate_config_test.ts` — lock new validation defaults, allowed formats, and breaking-change rejection of `logging.format`.
- Modify: `src/config/resolve_config_test.ts` — lock resolved logging defaults and explicit-sink semantics.
- Modify: `src/config/load_config_test.ts` — ensure YAML loading resolves the new logging shape from file configs.
- Modify: `config.example.yml` — publish the new sink contract.
- Modify: `README.md` — document per-sink logging, jsonl naming, and file rotation.

### Logging runtime/bootstrap

- Modify: `src/core/logger.ts` — convert logger internals from hand-written sink routing to LogTape-backed dispatch while preserving normalized repository record semantics.
- Modify: `src/core/logger_test.ts` — lock jsonl/pretty/readaction/high-density rendering against the new implementation.
- Create: `src/core/logging_runtime.ts` — centralize sink creation, formatter selection, redaction wrapping, and shutdown/flush handling.
- Create: `src/core/logging_runtime_test.ts` — lock explicit sink creation, file/jsonl emission, size rotation wiring, time rotation wiring, and no-sink behavior.

### Entry wiring and preview/playground consistency

- Modify: `src/core/app.ts` — configure and dispose the shared logging runtime around daemon startup.
- Modify: `src/interfaces/daemon/create_daemon_runtime.ts` — assume sink bootstrap has already happened and stop carrying legacy format assumptions.
- Modify: `src/interfaces/daemon/start_daemon_test.ts` — verify daemon runtime honors explicit sinks and keeps JSON contract stable.
- Modify: `src/main.ts` — stop hardcoding web startup `format: 'json'`; configure shared logging bootstrap before importing web app.
- Modify: `src/main_test.ts` — lock web startup logging against the new sink-driven configuration.
- Modify: `web/main.ts` — stop constructing a hardcoded legacy logger; use the shared logging bootstrap/logger factory.
- Modify: `web/main_test.ts` — update request logging assertions for jsonl/pretty behavior and shared bootstrap usage.
- Modify: `src/interfaces/web/preview_runtime.ts` — ensure preview runtime consumes the new resolved logging shape.
- Modify: `src/web/xquery_playground.ts` — replace legacy logging config stub with sink-driven config.
- Modify: `src/web/xquery_playground_test.ts` — update preview config assertions.
- Modify: `src/web/syndication_playground.ts` — replace legacy logging config stub with sink-driven config.
- Modify: `src/web/syndication_playground_test.ts` — update preview config assertions.

### Rules/docs sync

- Modify: `.claude/rules/logging-console.md` — reflect high-density pretty + per-sink behavior.
- Modify: `.claude/rules/logging-otel.md` — clarify LogTape-managed sink infrastructure vs repository JSON contract.
- Modify: `.claude/skills/otel-logging-design/SKILL.md` — align skill guidance with the new sink-driven model.

---

### Task 1: Add the new logging config contract and break old `logging.format`

**Files:**

- Modify: `deno.json`
- Modify: `src/config/schema.ts`
- Modify: `src/config/types.ts`
- Modify: `src/config/validate_config_test.ts`
- Test: `src/config/validate_config_test.ts`

- [ ] **Step 1: Add failing validation tests for the new sink-driven shape**

In `src/config/validate_config_test.ts`, replace the legacy default assertion and add explicit coverage for console/file sinks:

```ts
Deno.test(
  '[contract] validateConfig: schema 静态默认值应在校验阶段生效',
  () => {
    const validated = validateConfig({
      runtimeDir: '/tmp/runtime',
      sqlite: {},
      logging: {},
    })

    assertEquals(validated.timestampFormat, 'yyyy-MM-dd HH:mm:ss')
    assertEquals(validated.logging, {
      level: 'info',
      sinks: {},
    })
  },
)

Deno.test(
  '[contract] validateConfig: logging.sinks.console.format 支持 pretty 与 jsonl',
  () => {
    const prettyConfig = validateConfig({
      runtimeDir: '/tmp/runtime',
      logging: {
        sinks: {
          console: {
            type: 'console',
            format: 'pretty',
          },
        },
      },
    })
    assertEquals(prettyConfig.logging.sinks.console?.format, 'pretty')

    const jsonlConfig = validateConfig({
      runtimeDir: '/tmp/runtime',
      logging: {
        sinks: {
          console: {
            type: 'console',
            format: 'jsonl',
          },
        },
      },
    })
    assertEquals(jsonlConfig.logging.sinks.console?.format, 'jsonl')
  },
)

Deno.test(
  '[contract] validateConfig: file sink 支持 jsonl 与 size rotation',
  () => {
    const validated = validateConfig({
      runtimeDir: '/tmp/runtime',
      logging: {
        sinks: {
          file: {
            type: 'file',
            format: 'jsonl',
            path: 'runtime/logs/app.jsonl',
            rotation: {
              type: 'size',
              maxSize: '10m',
              maxFiles: 5,
            },
          },
        },
      },
    })

    assertEquals(validated.logging.sinks.file?.rotation, {
      type: 'size',
      maxSize: '10m',
      maxFiles: 5,
    })
  },
)

Deno.test('[contract] validateConfig: file sink 支持 time rotation', () => {
  const validated = validateConfig({
    runtimeDir: '/tmp/runtime',
    logging: {
      sinks: {
        file: {
          type: 'file',
          format: 'jsonl',
          path: 'runtime/logs/app.jsonl',
          rotation: {
            type: 'time',
            interval: 'daily',
            maxAge: '7d',
          },
        },
      },
    },
  })

  assertEquals(validated.logging.sinks.file?.rotation, {
    type: 'time',
    interval: 'daily',
    maxAge: '7d',
  })
})

Deno.test('[contract] validateConfig: logging.format 已删除', () => {
  assertThrows(
    () =>
      validateConfig({
        runtimeDir: '/tmp/runtime',
        logging: {
          format: 'pretty',
        } as never,
      }),
    Error,
    'logging.format',
  )
})
```

- [ ] **Step 2: Run the validation test file to verify it fails**

Run: `deno task test src/config/validate_config_test.ts`
Expected: FAIL because `src/config/schema.ts` still requires top-level `logging.format` and has no file sink schema.

- [ ] **Step 3: Add the new schema/types and import `@logtape/file`**

Update `deno.json` imports:

```json
"@logtape/file": "jsr:@logtape/file@^2.0.5"
```

In `src/config/schema.ts`, replace the old logging schema block with explicit sink schemas:

```ts
const logConsoleFormatSchema = createEnumSchema(['pretty', 'jsonl']).default(
  'pretty',
)
const logFileFormatSchema = createLiteralSchema('jsonl').default('jsonl')
const logTimeRotationIntervalSchema = createEnumSchema([
  'hourly',
  'daily',
  'weekly',
])

const loggingConsoleSchema = z
  .object({
    type: createLiteralSchema('console').default('console'),
    format: logConsoleFormatSchema,
  })
  .strict()

const loggingFileRotationSizeSchema = z
  .object({
    type: createLiteralSchema('size'),
    maxSize: requiredString(),
    maxFiles: z.number().int().min(1),
  })
  .strict()

const loggingFileRotationTimeSchema = z
  .object({
    type: createLiteralSchema('time'),
    interval: logTimeRotationIntervalSchema,
    maxAge: createDurationSchema('logging.sinks.file.rotation.maxAge', {
      allowDays: true,
    }),
  })
  .strict()

const loggingFileSchema = z
  .object({
    type: createLiteralSchema('file').default('file'),
    format: logFileFormatSchema,
    path: requiredString(),
    rotation: z
      .union([loggingFileRotationSizeSchema, loggingFileRotationTimeSchema])
      .optional(),
  })
  .strict()

export const loggingSchema = z
  .object({
    level: createEnumSchema([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]).default('info'),
    sinks: z
      .object({
        console: loggingConsoleSchema.optional(),
        file: loggingFileSchema.optional(),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .prefault({})
```

At the bottom of `src/config/schema.ts`, export the new types:

```ts
export type LogConsoleFormat = NonNullable<
  z.output<typeof loggingConsoleSchema>['format']
>
export type LogFileFormat = NonNullable<
  z.output<typeof loggingFileSchema>['format']
>
export type LogConsoleSinkConfig = z.output<typeof loggingConsoleSchema>
export type LogFileSinkConfig = z.output<typeof loggingFileSchema>
export type LogFileRotationConfig = NonNullable<
  z.output<typeof loggingFileSchema>['rotation']
>
export type LoggingConfigInput = z.output<typeof loggingSchema>
```

In `src/config/types.ts`, replace the old logging types:

```ts
import {
  type LogConsoleFormat as SchemaLogConsoleFormat,
  type LogConsoleSinkConfig as SchemaLogConsoleSinkConfig,
  type LogFileFormat as SchemaLogFileFormat,
  type LogFileRotationConfig as SchemaLogFileRotationConfig,
  type LogFileSinkConfig as SchemaLogFileSinkConfig,
  type LogLevel as SchemaLogLevel,
} from './schema.ts'

export type LogLevel = SchemaLogLevel
export type LogConsoleFormat = SchemaLogConsoleFormat
export type LogFileFormat = SchemaLogFileFormat
export type LogConsoleSinkConfig = SchemaLogConsoleSinkConfig
export type LogFileSinkConfig = SchemaLogFileSinkConfig
export type LogFileRotationConfig = SchemaLogFileRotationConfig

export interface LoggingConfigResolved {
  level: LogLevel
  sinks: {
    console?: LogConsoleSinkConfig
    file?: LogFileSinkConfig
  }
}
```

- [ ] **Step 4: Re-run the validation test file to verify it passes**

Run: `deno task test src/config/validate_config_test.ts`
Expected: PASS with no remaining `logging.format` references in validation behavior.

- [ ] **Step 5: Commit the config contract foundation**

```bash
git add deno.json src/config/schema.ts src/config/types.ts src/config/validate_config_test.ts
git commit -m "refactor(logging): add sink-driven config contract"
```

---

### Task 2: Resolve/load the new logging shape and update config docs/examples

**Files:**

- Modify: `src/config/resolve_config.ts`
- Modify: `src/config/resolve_config_test.ts`
- Modify: `src/config/load_config_test.ts`
- Modify: `config.example.yml`
- Modify: `README.md`
- Test: `src/config/resolve_config_test.ts`
- Test: `src/config/load_config_test.ts`

- [ ] **Step 1: Add failing resolve/load tests for explicit sinks and file rotation**

In `src/config/resolve_config_test.ts`, replace the old default logging assertion and add an explicit file case:

```ts
Deno.test(
  '[contract] resolveConfig: 缺省全局块时应收口为空数组、空 logging.sinks 与默认 sqlite 配置',
  () => {
    const resolved = resolveConfig(
      validateConfig({ runtimeDir: '/tmp/runtime' }),
    )

    assertEquals(resolved.logging, {
      level: 'info',
      sinks: {},
    })
  },
)

Deno.test('[contract] resolveConfig: 应保留 console/file sink 配置', () => {
  const resolved = resolveConfig(
    validateConfig({
      runtimeDir: '/tmp/runtime',
      logging: {
        level: 'debug',
        sinks: {
          console: {
            type: 'console',
            format: 'pretty',
          },
          file: {
            type: 'file',
            format: 'jsonl',
            path: 'runtime/logs/app.jsonl',
            rotation: {
              type: 'time',
              interval: 'daily',
              maxAge: '7d',
            },
          },
        },
      },
    }),
  )

  assertEquals(resolved.logging, {
    level: 'debug',
    sinks: {
      console: {
        type: 'console',
        format: 'pretty',
      },
      file: {
        type: 'file',
        format: 'jsonl',
        path: 'runtime/logs/app.jsonl',
        rotation: {
          type: 'time',
          interval: 'daily',
          maxAge: '7d',
        },
      },
    },
  })
})
```

In `src/config/load_config_test.ts`, add a YAML load case:

```ts
test('loadConfig: 应解析 logging file sink 与 time rotation', async () => {
  await Deno.writeTextFile(
    join(TEST_RUNTIME, 'config.yml'),
    `
logging:
  level: debug
  sinks:
    console:
      type: console
      format: pretty
    file:
      type: file
      format: jsonl
      path: logs/app.jsonl
      rotation:
        type: time
        interval: daily
        maxAge: 7d
`,
  )

  const config = await loadConfig({ runtimeDir: TEST_RUNTIME })
  assertEquals(config.logging, {
    level: 'debug',
    sinks: {
      console: {
        type: 'console',
        format: 'pretty',
      },
      file: {
        type: 'file',
        format: 'jsonl',
        path: 'logs/app.jsonl',
        rotation: {
          type: 'time',
          interval: 'daily',
          maxAge: '7d',
        },
      },
    },
  })
})
```

- [ ] **Step 2: Run the resolve/load config tests to verify they fail**

Run: `deno task test src/config/resolve_config_test.ts src/config/load_config_test.ts`
Expected: FAIL because `resolveLoggingConfig()` still returns `{ level, format, sinks.console }` and docs/examples still assume the old shape.

- [ ] **Step 3: Resolve the new logging contract and update public examples**

In `src/config/resolve_config.ts`, replace `resolveLoggingConfig()` with:

```ts
export function resolveLoggingConfig(
  input: LoggingConfigInput,
): LoggingConfigResolved {
  return {
    level: input.level,
    sinks: {
      ...(input.sinks.console ? { console: { ...input.sinks.console } } : {}),
      ...(input.sinks.file
        ? {
            file: {
              ...input.sinks.file,
              ...(input.sinks.file.rotation
                ? { rotation: { ...input.sinks.file.rotation } }
                : {}),
            },
          }
        : {}),
    },
  }
}
```

Update `config.example.yml` logging docs to:

```yml
logging:
  level: info
  sinks:
    console:
      type: console
      format: pretty
    file:
      type: file
      format: jsonl
      path: runtime/logs/app.jsonl
      rotation:
        type: time
        interval: daily
        maxAge: 7d
```

Update the `README.md` logging section bullets to:

```md
- `logging.level` 支持 `trace|debug|info|warn|error|fatal`，默认 `info`。
- `logging.sinks.console.format` 支持 `pretty|jsonl`。
- `logging.sinks.file.format` 第一版固定为 `jsonl`。
- sink 仅在显式配置后才创建；不再保留顶层 `logging.format`。
- `logging.sinks.file.rotation.type=size` 时使用 `maxSize` / `maxFiles`。
- `logging.sinks.file.rotation.type=time` 时使用 `interval` / `maxAge`。
```

- [ ] **Step 4: Re-run the resolve/load config tests to verify they pass**

Run: `deno task test src/config/resolve_config_test.ts src/config/load_config_test.ts`
Expected: PASS with resolved logging shape now sink-driven and docs/examples aligned.

- [ ] **Step 5: Commit the resolved logging config/doc sync**

```bash
git add src/config/resolve_config.ts src/config/resolve_config_test.ts src/config/load_config_test.ts config.example.yml README.md
git commit -m "docs(logging): publish sink-driven logging config"
```

---

### Task 3: Introduce a shared LogTape runtime bootstrap with explicit sinks

**Files:**

- Create: `src/core/logging_runtime.ts`
- Create: `src/core/logging_runtime_test.ts`
- Modify: `src/core/app.ts`
- Modify: `src/interfaces/daemon/create_daemon_runtime.ts`
- Test: `src/core/logging_runtime_test.ts`

- [ ] **Step 1: Write failing runtime bootstrap tests for explicit sink creation and no-sink behavior**

Create `src/core/logging_runtime_test.ts` with focused sink-creation tests:

```ts
import { assertEquals, assertStringIncludes } from '@std/assert'
import { ensureDir, exists } from '@std/fs'
import { dirname, join } from '@std/path'
import { withOwnedRuntime } from '../test_runtime.ts'
import {
  configureLoggingRuntime,
  shutdownLoggingRuntime,
} from './logging_runtime.ts'
import { createLogger } from './logger.ts'

Deno.test('[contract] logging_runtime: 不配置 sinks 时不应输出', async () => {
  const stdout: string[] = []
  await configureLoggingRuntime({
    logging: { level: 'info', sinks: {} },
    runtimeDir: '/tmp/runtime',
    timezone: 'UTC',
    timestampFormat: 'yyyy-MM-dd HH:mm:ss',
    consoleWriters: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stdout.push(line),
      warn: (line: string) => stdout.push(line),
    },
  })

  createLogger({ enabled: true, level: 'info', module: 'app.startup' }).info(
    'no sinks',
  )
  await shutdownLoggingRuntime()
  assertEquals(stdout, [])
})

Deno.test(
  '[contract] logging_runtime: 只配置 file sink 时应只写 jsonl 文件',
  async () => {
    await withOwnedRuntime(async ({ runtimeDir }) => {
      const logPath = join(runtimeDir, 'logs', 'app.jsonl')
      await ensureDir(dirname(logPath))
      const stdout: string[] = []

      await configureLoggingRuntime({
        logging: {
          level: 'info',
          sinks: {
            file: {
              type: 'file',
              format: 'jsonl',
              path: logPath,
            },
          },
        },
        runtimeDir,
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
        consoleWriters: {
          stdout: (line: string) => stdout.push(line),
          stderr: (line: string) => stdout.push(line),
          warn: (line: string) => stdout.push(line),
        },
      })

      createLogger({
        enabled: true,
        level: 'info',
        module: 'delivery.http',
      }).info('file only', {
        'delivery.id': 'archive',
      })
      await shutdownLoggingRuntime()

      assertEquals(stdout, [])
      assertEquals(await exists(logPath), true)
      const written = await Deno.readTextFile(logPath)
      assertStringIncludes(written, '"delivery.id":"archive"')
    })
  },
)
```

- [ ] **Step 2: Run the runtime bootstrap tests to verify they fail**

Run: `deno task test src/core/logging_runtime_test.ts`
Expected: FAIL because `src/core/logging_runtime.ts` does not exist yet.

- [ ] **Step 3: Add the LogTape bootstrap module and wire daemon runtime through it**

Create `src/core/logging_runtime.ts`:

```ts
import { dirname, extname, join, basename } from '@std/path'
import {
  getConsoleSink,
  getLogger as getLogTapeLogger,
  type Sink,
  configure,
  dispose,
} from '@logtape/logtape'
import {
  getFileSink,
  getRotatingFileSink,
  getTimeRotatingFileSink,
} from '@logtape/file'
import { redactByField, redactByPattern } from '@logtape/redaction'
import type { LoggingConfigResolved } from '../config/types.ts'
import {
  createPrettyFormatter,
  createRepositoryJsonlFormatter,
  SENSITIVE_FIELD_NAMES,
  SENSITIVE_PATTERNS,
} from './logger.ts'

let configured = false

function buildConsoleSink(/* ... */): Sink {
  // choose createPrettyFormatter() or createRepositoryJsonlFormatter()
}

function buildFileSink(/* ... */): Sink {
  // choose getFileSink / getRotatingFileSink / getTimeRotatingFileSink based on rotation
}

export async function configureLoggingRuntime(input: {
  logging: LoggingConfigResolved
  runtimeDir: string
  timezone: string
  timestampFormat: string
  consoleWriters?: {
    stdout: (line: string) => void
    warn: (line: string) => void
    stderr: (line: string) => void
  }
}) {
  const sinks: Record<string, Sink> = {}

  if (input.logging.sinks.console) {
    sinks.console = buildConsoleSink(input)
  }
  if (input.logging.sinks.file) {
    sinks.file = buildFileSink(input)
  }

  await configure({
    reset: true,
    sinks,
    loggers:
      Object.keys(sinks).length === 0
        ? []
        : [
            {
              category: ['knock'],
              sinks: Object.keys(sinks),
              lowestLevel: input.logging.level,
            },
          ],
  })
  configured = true
}

export function getKnockLogTapeLogger(category: string[]) {
  return getLogTapeLogger(['knock', ...category])
}

export async function shutdownLoggingRuntime() {
  if (!configured) return
  await dispose()
  configured = false
}
```

In `src/core/app.ts`, configure and dispose logging around daemon startup:

```ts
await configureLoggingRuntime({
  logging: config.logging,
  runtimeDir: config.runtimeDir,
  timezone: config.timezone,
  timestampFormat: config.timestampFormat,
})

const daemon = createDaemonRuntime({
  config,
  httpFetcher: input.httpFetcher,
  httpProxyClientFactory: input.httpProxyClientFactory,
  emailTransportFactory: input.emailTransportFactory,
  keepAlive: input.keepAlive,
  keepAliveSignal: input.keepAliveSignal,
  immediate: input.immediate,
})
```

and in the `finally` block:

```ts
} finally {
  daemon.stop()
  await shutdownLoggingRuntime()
}
```

In `src/interfaces/daemon/create_daemon_runtime.ts`, remove any bootstrap/dispose responsibility from `stop()` so it only stops cron jobs and closes the DB client.

- [ ] **Step 4: Re-run the runtime bootstrap tests to verify they pass**

Run: `deno task test src/core/logging_runtime_test.ts`
Expected: PASS with explicit sink creation working and no-sink mode silent.

- [ ] **Step 5: Commit the logging bootstrap foundation**

```bash
git add src/core/logging_runtime.ts src/core/logging_runtime_test.ts src/core/app.ts src/interfaces/daemon/create_daemon_runtime.ts
git commit -m "feat(logging): bootstrap LogTape sinks explicitly"
```

---

### Task 4: Rebuild `src/core/logger.ts` as a LogTape-backed adapter with repository JSONL formatter

**Files:**

- Modify: `src/core/logger.ts`
- Modify: `src/core/logger_test.ts`
- Test: `src/core/logger_test.ts`

- [ ] **Step 1: Add failing tests for jsonl naming, high-density pretty, and LogTape-backed output**

In `src/core/logger_test.ts`, replace the legacy format assertions with the new contract:

```ts
Deno.test(
  '[contract] R11 logger: console format=jsonl 应输出仓库 OTel JSONL',
  async () => {
    const stdout: string[] = []
    await configureLoggingRuntime({
      logging: {
        level: 'info',
        sinks: {
          console: {
            type: 'console',
            format: 'jsonl',
          },
        },
      },
      runtimeDir: '/tmp/runtime',
      timezone: 'UTC',
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
      consoleWriters: {
        stdout: (line: string) => stdout.push(line),
        warn: (line: string) => stdout.push(line),
        stderr: (line: string) => stdout.push(line),
      },
    })

    const logger = createLogger({
      enabled: true,
      level: 'info',
      module: 'delivery.http',
    })
    logger.info('推送完成', { 'delivery.id': 'telegram' })
    await shutdownLoggingRuntime()

    const record = parseRecord(stdout[0])
    assertEquals(record.severityText, 'INFO')
    assertEquals(getScopeName(record), 'delivery.http')
    assertEquals(getAttributes(record)['delivery.id'], 'telegram')
  },
)

Deno.test(
  '[contract] R11 logger: pretty 应输出高密度单行并隐藏块状 resource/attributes',
  async () => {
    const stdout: string[] = []
    await configureLoggingRuntime({
      logging: {
        level: 'info',
        sinks: {
          console: {
            type: 'console',
            format: 'pretty',
          },
        },
      },
      runtimeDir: '/tmp/runtime',
      timezone: 'UTC',
      timestampFormat: 'yyyy-MM-dd HH:mm:ss',
      consoleWriters: {
        stdout: (line: string) => stdout.push(line),
        warn: (line: string) => stdout.push(line),
        stderr: (line: string) => stdout.push(line),
      },
    })

    createLogger({
      enabled: true,
      level: 'info',
      module: 'pipeline.filter',
      component: 'daemon',
    }).info('pipeline item filtered', {
      'source.id': 'smzdm',
      'source.run_id': 'a81ce6e0-4906-485b-a41d-3bf3075af785',
    })
    await shutdownLoggingRuntime()

    assertStringIncludes(stdout[0], '2026-03-24 21:45:12')
    assertStringIncludes(stdout[0], 'info')
    assertStringIncludes(stdout[0], 'filter')
    assertStringIncludes(stdout[0], 'component=daemon')
    assertStringIncludes(stdout[0], 'source.id=smzdm')
    assertEquals(stdout[0].includes('resource:'), false)
    assertEquals(stdout[0].includes('attributes:'), false)
  },
)
```

- [ ] **Step 2: Run the logger test file to verify it fails**

Run: `deno task test src/core/logger_test.ts`
Expected: FAIL because the current logger still uses legacy `format` routing and block-style pretty output.

- [ ] **Step 3: Rewrite the logger adapter around LogTape records and repository formatters**

In `src/core/logger.ts`:

1. Replace `CreateLoggerOptions` with LogTape-driven options:

```ts
export interface CreateLoggerOptions {
  enabled: boolean
  level: LogLevel
  module: string
  component?: string
  service?: string
  env?: string
  timezone?: string
  timestampFormat?: string
  now?: () => Date
  baseFields?: LogFields
}
```

2. Export reusable redaction/formatter helpers from the old internals:

```ts
export const SENSITIVE_FIELD_NAMES = [...SENSITIVE_FIELD_KEYS]
export const SENSITIVE_PATTERNS = [
  /(https:\/\/api\.telegram\.org\/bot)([^\/\s]+)(\/)/gi,
  /(https?:\/\/)(?:[^\/@\s:]+(?::[^\/@\s]*)?@)/gi,
  /([?&](?:token|secret|password|authorization|api_key|apikey|auth|sig|signature|access_token)=)([^&\s"]+)/gi,
]
```

3. Add a repository JSONL formatter:

```ts
export function createRepositoryJsonlFormatter() {
  return (record: LogRecord): string => {
    const otelRecord = toOtelLogRecord(record)
    return JSON.stringify(otelRecord)
  }
}
```

4. Add a high-density pretty formatter:

```ts
export function createPrettyFormatter(options: {
  timezone: string
  timestampFormat: string
}) {
  return (record: LogRecord): string => {
    const otelRecord = toOtelLogRecord(record)
    const scope =
      otelRecord.scope.name.split('.').at(-1) ?? otelRecord.scope.name
    const component = otelRecord.resource.attributes['knock.component']
    const attributes = selectInlinePrettyFields(otelRecord)
    const inline = Object.entries(attributes)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ')
    return `${formatTime(new Date(Number(otelRecord.timeUnixNano) / 1_000_000), options.timezone, options.timestampFormat)} ${otelRecord.severityText.toLowerCase()} ${scope} ${otelRecord.body}${component ? ` component=${component}` : ''}${inline ? ` ${inline}` : ''}`
  }
}
```

5. Replace the old `emitLog()` path with LogTape logger emission:

```ts
const category = options.module.split('.')
const logTapeLogger = getKnockLogTapeLogger(category)

const emitLog = (level: LogLevel, message: string, fields: LogFields = {}) => {
  if (!options.enabled) return
  const mergedFields = { ...baseFields, ...fields }
  const record = buildLogTapeRecord({
    level,
    message,
    module:
      typeof mergedFields.module === 'string'
        ? mergedFields.module
        : options.module,
    timestamp: now(),
    resourceAttributes,
    attributes: mergedFields,
    traceContext: normalizeTraceContext(mergedFields),
  })
  logTapeLogger[level === 'warn' ? 'warning' : level](
    message,
    record.properties,
  )
}
```

- [ ] **Step 4: Re-run the logger test file to verify it passes**

Run: `deno task test src/core/logger_test.ts`
Expected: PASS with console jsonl and pretty both coming from LogTape-managed sinks and repository formatters.

- [ ] **Step 5: Commit the LogTape-backed logger adapter**

```bash
git add src/core/logger.ts src/core/logger_test.ts
 git commit -m "refactor(logging): back logger with LogTape formatters"
```

---

### Task 5: Wire web/daemon/playground entrypoints to the new sink-driven bootstrap

**Files:**

- Modify: `src/main.ts`
- Modify: `src/main_test.ts`
- Modify: `web/main.ts`
- Modify: `web/main_test.ts`
- Modify: `src/interfaces/daemon/start_daemon_test.ts`
- Modify: `src/interfaces/web/preview_runtime.ts`
- Modify: `src/web/xquery_playground.ts`
- Modify: `src/web/xquery_playground_test.ts`
- Modify: `src/web/syndication_playground.ts`
- Modify: `src/web/syndication_playground_test.ts`
- Test: `src/main_test.ts`
- Test: `web/main_test.ts`
- Test: `src/interfaces/daemon/start_daemon_test.ts`
- Test: `src/web/xquery_playground_test.ts`
- Test: `src/web/syndication_playground_test.ts`

- [ ] **Step 1: Add failing entrypoint tests for the new sink shape and no hardcoded format**

In `src/web/xquery_playground_test.ts`, replace the logging assertion with:

```ts
assertEquals(config.logging, {
  level: 'info',
  sinks: {
    console: {
      type: 'console',
      format: 'jsonl',
    },
  },
})
```

In `src/web/syndication_playground_test.ts`, replace the same assertion with the same shape.

In `src/main_test.ts`, add a startup config test:

```ts
Deno.test(
  '[contract] startWeb: web startup logger 应走共享 sink 配置而非硬编码 format',
  async () => {
    const source = await Deno.readTextFile(
      new URL('./main.ts', import.meta.url),
    )
    assertEquals(source.includes("format: 'json'"), false)
  },
)
```

In `src/interfaces/daemon/start_daemon_test.ts`, update the runtime config fixture to:

```ts
logging: {
  level: 'info',
  sinks: {
    console: {
      type: 'console',
      format: 'jsonl',
    },
  },
}
```

- [ ] **Step 2: Run the entrypoint-focused tests to verify they fail**

Run: `deno task test src/main_test.ts web/main_test.ts src/interfaces/daemon/start_daemon_test.ts src/web/xquery_playground_test.ts src/web/syndication_playground_test.ts`
Expected: FAIL because entrypoints and preview/playground still construct legacy `logging.format` objects and hardcode web startup format.

- [ ] **Step 3: Update entrypoints and preview/playground config stubs**

In `src/main.ts`, replace the startup logger construction with:

```ts
const logger = createLogger({
  enabled: true,
  level: 'info',
  module: 'web.startup',
  component: 'web',
  timezone: 'UTC',
  timestampFormat: 'yyyy-MM-dd HH:mm:ss',
})
```

In `web/main.ts`, replace the module-level logger with:

```ts
const webLogger = createLogger({
  enabled: true,
  level: 'info',
  module: 'web.api',
  component: 'web',
  timezone: 'UTC',
  timestampFormat: 'yyyy-MM-dd HH:mm:ss',
})
```

In `src/web/xquery_playground.ts`, replace the old config stub with:

```ts
    logging: {
      level: 'info',
      sinks: {
        console: {
          type: 'console',
          format: 'jsonl',
        },
      },
    },
```

Apply the same change to `src/web/syndication_playground.ts` and any preview-runtime fixtures that still build `{ format: 'json', sinks.console }`.

- [ ] **Step 4: Re-run the entrypoint-focused tests to verify they pass**

Run: `deno task test src/main_test.ts web/main_test.ts src/interfaces/daemon/start_daemon_test.ts src/web/xquery_playground_test.ts src/web/syndication_playground_test.ts`
Expected: PASS with all entrypoints and playgrounds now aligned to sink-driven logging config.

- [ ] **Step 5: Commit the entry wiring alignment**

```bash
git add src/main.ts src/main_test.ts web/main.ts web/main_test.ts src/interfaces/daemon/start_daemon_test.ts src/interfaces/web/preview_runtime.ts src/web/xquery_playground.ts src/web/xquery_playground_test.ts src/web/syndication_playground.ts src/web/syndication_playground_test.ts
git commit -m "refactor(logging): align entrypoints with sink config"
```

---

### Task 6: Finish file rotation wiring and shutdown/flush coverage

**Files:**

- Modify: `src/core/logging_runtime.ts`
- Modify: `src/core/logging_runtime_test.ts`
- Test: `src/core/logging_runtime_test.ts`

- [ ] **Step 1: Add failing rotation and shutdown tests**

Extend `src/core/logging_runtime_test.ts` with two cases:

```ts
Deno.test(
  '[contract] logging_runtime: size rotation 应委托 rotating file sink',
  async () => {
    await withOwnedRuntime(async ({ runtimeDir }) => {
      const logPath = join(runtimeDir, 'logs', 'rotating.jsonl')
      await configureLoggingRuntime({
        logging: {
          level: 'info',
          sinks: {
            file: {
              type: 'file',
              format: 'jsonl',
              path: logPath,
              rotation: {
                type: 'size',
                maxSize: '1k',
                maxFiles: 2,
              },
            },
          },
        },
        runtimeDir,
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
      })

      for (let i = 0; i < 50; i += 1) {
        createLogger({
          enabled: true,
          level: 'info',
          module: 'delivery.http',
        }).info('rotate', {
          'delivery.id': `d${i}`,
        })
      }
      await shutdownLoggingRuntime()

      const files = [...Deno.readDirSync(join(runtimeDir, 'logs'))].map(
        (entry) => entry.name,
      )
      assertEquals(
        files.some((name) => name.includes('rotating')),
        true,
      )
    })
  },
)

Deno.test(
  '[contract] logging_runtime: shutdown 应 flush file sink 尾日志',
  async () => {
    await withOwnedRuntime(async ({ runtimeDir }) => {
      const logPath = join(runtimeDir, 'logs', 'flush.jsonl')
      await configureLoggingRuntime({
        logging: {
          level: 'info',
          sinks: {
            file: {
              type: 'file',
              format: 'jsonl',
              path: logPath,
            },
          },
        },
        runtimeDir,
        timezone: 'UTC',
        timestampFormat: 'yyyy-MM-dd HH:mm:ss',
      })

      createLogger({
        enabled: true,
        level: 'info',
        module: 'app.startup',
      }).info('tail record')
      await shutdownLoggingRuntime()

      const written = await Deno.readTextFile(logPath)
      assertStringIncludes(written, 'tail record')
    })
  },
)
```

- [ ] **Step 2: Run the runtime test file to verify it fails**

Run: `deno task test src/core/logging_runtime_test.ts`
Expected: FAIL until size/time rotation and shutdown handling are fully wired.

- [ ] **Step 3: Finish rotation selection and shutdown handling**

In `src/core/logging_runtime.ts`, complete the file sink builder:

```ts
function buildFileSink(input: ConfigureLoggingRuntimeInput): Sink {
  const sink = input.logging.sinks.file
  if (!sink) throw new Error('file sink 未配置')

  if (!sink.rotation) {
    return getFileSink(sink.path, {
      formatter: createRepositoryJsonlFormatter(),
    })
  }

  if (sink.rotation.type === 'size') {
    return getRotatingFileSink(sink.path, {
      maxSize: parseByteSize(sink.rotation.maxSize),
      maxFiles: sink.rotation.maxFiles,
      formatter: createRepositoryJsonlFormatter(),
    })
  }

  return getTimeRotatingFileSink({
    directory: dirname(sink.path),
    interval: sink.rotation.interval,
    maxAgeMs: parseDurationMs(sink.rotation.maxAge),
    filename: (date) =>
      `${basename(sink.path, extname(sink.path))}-${formatRotationDate(date, sink.rotation.interval)}${extname(sink.path)}`,
    formatter: createRepositoryJsonlFormatter(),
  })
}
```

and keep `shutdownLoggingRuntime()` calling LogTape shutdown exactly once.

- [ ] **Step 4: Re-run the runtime test file to verify it passes**

Run: `deno task test src/core/logging_runtime_test.ts`
Expected: PASS with size/time rotation wired and shutdown flushing the tail record.

- [ ] **Step 5: Commit the rotation/shutdown completion**

```bash
git add src/core/logging_runtime.ts src/core/logging_runtime_test.ts
git commit -m "feat(logging): add file rotation and shutdown flush"
```

---

### Task 7: Sync logging rules/skill guidance with the new LogTape-first model

**Files:**

- Modify: `.claude/rules/logging-console.md`
- Modify: `.claude/rules/logging-otel.md`
- Modify: `.claude/skills/otel-logging-design/SKILL.md`

- [ ] **Step 1: Update rule text to describe per-sink logging and high-density pretty**

In `.claude/rules/logging-console.md`, replace/add the key bullets:

```md
- 控制台 sink 仅在 `logging.sinks.console` 显式配置时创建。
- `logging.sinks.console.format` 支持 `pretty` 与 `jsonl`；`pretty` 为高密度单行优先展示，不再默认整块展开 `resource` / `attributes`。
- 文件 sink 仅在 `logging.sinks.file` 显式配置时创建，第一版仅支持 `jsonl`。
- `pretty` 只改变展示；最终 JSONL 契约仍由仓库 formatter 保持为 OTel 风格结构。
```

In `.claude/rules/logging-otel.md`, add:

```md
- LogTape 负责 sink/dispatch/rotation/redaction 主机制；仓库 formatter 继续负责最终 OTel 风格 JSON 输出契约。
- MUST NOT 直接把 LogTape 原始 `LogRecord` 当作仓库对外 JSON 契约。
```

In `.claude/skills/otel-logging-design/SKILL.md`, add/update guidance:

```md
- 当任务涉及 logging sink、rotation、formatter、redaction 时，优先使用 LogTape 原生能力；仅把字段归一、命名约束与最终展示策略留在仓库层。
- 新的配置模型以 `logging.sinks.*` 为单一事实源，不再使用顶层 `logging.format`。
```

- [ ] **Step 2: Run docs path consistency checks**

Run: `deno task fmt:check .claude/rules/logging-console.md .claude/rules/logging-otel.md .claude/skills/otel-logging-design/SKILL.md README.md config.example.yml`
Expected: PASS if paths and markdown formatting are correct.

- [ ] **Step 3: Commit the rule/skill sync**

```bash
git add .claude/rules/logging-console.md .claude/rules/logging-otel.md .claude/skills/otel-logging-design/SKILL.md
 git commit -m "docs(logging): align rules with LogTape sinks"
```

---

### Task 8: Run focused verification and final full-suite audit

**Files:**

- Modify: none
- Test: `src/**`
- Test: `web/**`

- [ ] **Step 1: Run the focused logging verification set**

Run: `deno task test src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/load_config_test.ts src/core/logging_runtime_test.ts src/core/logger_test.ts src/main_test.ts web/main_test.ts src/interfaces/daemon/start_daemon_test.ts src/web/xquery_playground_test.ts src/web/syndication_playground_test.ts`
Expected: PASS across the sink contract, runtime bootstrap, logger formatters, entry wiring, and preview/playground coverage.

- [ ] **Step 2: Run scoped check/lint/fmt on touched code paths**

Run: `deno task check src/main.ts web/main.ts src/core/logger.ts src/core/logging_runtime.ts src/config/schema.ts src/config/types.ts src/config/resolve_config.ts src/interfaces/daemon/create_daemon_runtime.ts src/interfaces/web/preview_runtime.ts src/web/xquery_playground.ts src/web/syndication_playground.ts`
Expected: PASS.

Run: `deno task lint:check src/main.ts web/main.ts src/core/logger.ts src/core/logging_runtime.ts src/config/schema.ts src/config/types.ts src/config/resolve_config.ts src/interfaces/daemon/create_daemon_runtime.ts src/interfaces/web/preview_runtime.ts src/web/xquery_playground.ts src/web/syndication_playground.ts src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/load_config_test.ts src/core/logging_runtime_test.ts src/core/logger_test.ts src/main_test.ts web/main_test.ts src/interfaces/daemon/start_daemon_test.ts src/web/xquery_playground_test.ts src/web/syndication_playground_test.ts`
Expected: PASS.

Run: `deno task fmt:check src/main.ts web/main.ts src/core/logger.ts src/core/logging_runtime.ts src/config/schema.ts src/config/types.ts src/config/resolve_config.ts src/interfaces/daemon/create_daemon_runtime.ts src/interfaces/web/preview_runtime.ts src/web/xquery_playground.ts src/web/syndication_playground.ts src/config/validate_config_test.ts src/config/resolve_config_test.ts src/config/load_config_test.ts src/core/logging_runtime_test.ts src/core/logger_test.ts src/main_test.ts web/main_test.ts src/interfaces/daemon/start_daemon_test.ts src/web/xquery_playground_test.ts src/web/syndication_playground_test.ts README.md config.example.yml .claude/rules/logging-console.md .claude/rules/logging-otel.md .claude/skills/otel-logging-design/SKILL.md`
Expected: PASS.

- [ ] **Step 3: Run the full test suite because shared entrypoints/logging core changed**

Run: `deno task test`
Expected: PASS across `src` and `web` after the logging architecture migration.

- [ ] **Step 4: Audit for removed legacy config/model references**

Run: `rg -n "logging\.format|format: 'json'|format: 'pretty'|logging\.sinks\.console\?\.type" src web README.md config.example.yml`
Expected: remaining matches are limited to the new per-sink format fields, intentional spec/plan text, or non-logging delivery format values.

- [ ] **Step 5: Commit the verified migration state**

```bash
git add src web README.md config.example.yml .claude deno.json
git commit -m "refactor(logging): migrate to LogTape sink runtime"
```

---

## Self-Review Checklist

- Spec coverage mapped:
  - per-sink logging config / explicit sink creation / delete `logging.format` → Tasks 1-2
  - LogTape-managed sink bootstrap and file rotation → Tasks 3 and 6
  - repository JSONL contract + high-density pretty formatter → Task 4
  - daemon/web/playground shared wiring → Task 5
  - rules/docs sync → Task 7
  - final verification and legacy-reference audit → Task 8
- Placeholder scan: no `TODO` / `TBD` / “similar to Task N” shortcuts remain.
- Type consistency:
  - config types use `console.format` and `file.format=jsonl`
  - runtime bootstrap is the single sink creation path
  - logger adapter emits LogTape records but final jsonl stays repository-shaped
  - preview/playground fixtures no longer use top-level `logging.format`
