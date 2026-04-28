# Bun Architecture Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate startup/runtime orchestration, unify Web action orchestration, and trim shallow Bun-era adapters without changing CLI or config contracts.

**Architecture:** Introduce a deep startup orchestrator seam for process boot, a shared Web action executor plus runtime session seam for route actions, and a smaller `src/platform/*` surface that keeps only real runtime boundaries. Execute in three independently shippable phases so work can stop cleanly after any phase.

**Tech Stack:** Bun, TypeScript, Zod, Preact, SQLite, LiquidJS, Croner

---

## File Structure

### New files

- Create: `src/interfaces/startup/startup_orchestrator.ts`
  - Own `daemon` / `web` / `all` startup dispatch, child-process policy, and shared env propagation.
- Create: `src/interfaces/startup/start_daemon_process.ts`
  - Own the existing daemon startup flow so the orchestrator can call it without importing `main.ts`.
- Create: `src/interfaces/startup/startup_orchestrator_test.ts`
  - Contract tests for startup orchestration independent of `main.ts`.
- Create: `src/interfaces/web/web_action_executor.ts`
  - Shared request executor for JSON parse, same-origin gate, error classification, and response shaping.
- Create: `src/interfaces/web/web_action_executor_test.ts`
  - Contract tests for executor behavior.
- Create: `src/interfaces/web/runtime_session.ts`
  - Shared runtime config context loader + overview rebuild helpers.
- Create: `src/interfaces/web/runtime_session_test.ts`
  - Contract tests for session-level helpers.

### Phase 1 modified files

- Modify: `src/main.ts`
  - Reduce to entry adapter; delegate command dispatch to startup orchestrator.
- Modify: `src/main_test.ts`
  - Keep entry-level coverage after extraction.
- Modify: `src/container_entrypoint.ts`
  - Keep raw argv normalization and container defaults only; delegate startup policy.
- Modify: `src/container_entrypoint_test.ts`
  - Keep container defaults contract stable.
- Modify: `src/interfaces/cli/parse_cli_command.ts`
  - Keep command modeling stable; no flag drift.
- Modify: `src/composition/create_production_runtime.ts`
  - Remain daemon runtime adapter; do not re-spread startup logic.

### Phase 2 modified files

- Modify: `src/interfaces/web/create_config_action_handler.ts`
- Modify: `src/interfaces/web/create_source_action_handler.ts`
- Modify: `src/interfaces/web/create_playground_evaluate_handler.ts`
  - Convert into thin adapters over the shared executor.
- Modify: `src/interfaces/web/config_management.ts`
- Modify: `src/interfaces/web/source_management.ts`
- Modify: `src/interfaces/web/source_management_context.ts`
- Modify: `src/config/runtime_config_context.ts`
- Modify: `src/web/config_workbench_overview.ts`
- Modify: `src/web/reader_overview.ts`
  - Reuse runtime session seam where it reduces duplicated orchestration.
- Modify: `web/routes/api/config/*.ts`
- Modify: `web/routes/api/sources/*.ts`
- Modify: `web/routes/api/syndication/evaluate.ts`
- Modify: `web/routes/api/xquery/evaluate.ts`
  - Route handlers remain contract-stable.

### Phase 3 modified files

- Modify: `src/core/logger_support.ts`
- Modify: `src/sources/feed_shared.ts`
- Modify: `web/client.tsx`
- Modify: `web/main.tsx`
- Modify: `web/islands/config_workbench.tsx`
- Modify: `web/components/layout/app_shell.tsx`
- Modify: `web/routes/_app.tsx`
- Modify: `web/routes/config_test.ts`
  - Inline `luxon` / `preact*` imports and delete pass-through wrappers.
- Modify: `src/config/load_compiled_config.ts`
- Modify: `src/config/raw_config_document.ts`
- Modify: `src/testing/risk_mapping.ts`
- Modify: `src/config/config_example_test.ts`
- Modify: `src/interfaces/web/config_management_test.ts`
- Modify: `src/interfaces/web/source_management_test.ts`
  - If `yaml` direct import is clean under Bun, inline it here.
- Modify: `src/core/http_client.ts`
- Modify: `src/composition/create_production_runtime.ts`
- Modify: `src/composition/create_runtime_kernel.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/core/liquid_runtime.ts`
- Modify: `src/core/liquid_validation.ts`
  - Direct-import spike candidates for `ky` / `croner` / `liquidjs`.

### Files expected to stay untouched

- `config.example.yml`
- `README.md`
- `src/definitions/**`
- `src/db/**`
- `src/application/**` except existing imports touched transitively by compiler feedback

No docs update is expected unless implementation changes user-visible behavior, which this plan explicitly avoids.

## Task 1: Add startup orchestrator contract tests

**Files:**

- Create: `src/interfaces/startup/startup_orchestrator_test.ts`
- Modify: `src/main_test.ts`
- Test: `src/interfaces/startup/startup_orchestrator_test.ts`
- Test: `src/main_test.ts`

- [ ] **Step 1: Write the failing orchestrator tests**

```ts
import { assertEquals, assertRejects } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { dispatchStartupCommand } from './startup_orchestrator.ts'

function child(name: 'daemon' | 'web', success: boolean) {
  return {
    status: Promise.resolve({ success, code: success ? 0 : 1 }),
    kill: () => killed.push(name),
  }
}

let killed: Array<'daemon' | 'web'> = []

test('[contract] startup orchestrator: all 模式应启动 daemon 与 web 子进程', async () => {
  const spawned: string[][] = []
  killed = []
  const daemon = child('daemon', true)
  const web = child('web', true)

  await dispatchStartupCommand(
    {
      kind: 'all',
      configPath: '/tmp/config.yml',
      runtimeDir: '/tmp/runtime',
      immediate: false,
    },
    {
      env: { KNOCK_RUNTIME_DIR: '/tmp/runtime' },
      spawnChild: ({ args }) => {
        spawned.push(args)
        return args[1] === 'daemon' ? daemon : web
      },
      startDaemon: async () => {
        throw new Error('should not start inline')
      },
      startWeb: async () => {
        throw new Error('should not start inline')
      },
    },
  )

  assertEquals(spawned, [
    [
      '--mode',
      'daemon',
      '--config',
      '/tmp/config.yml',
      '--runtime_dir',
      '/tmp/runtime',
    ],
    ['--mode', 'web'],
  ])
  assertEquals(killed, [])
})

test('[contract] startup orchestrator: all 模式首个失败子进程应终止另一侧并抛错', async () => {
  const spawned: string[][] = []
  killed = []
  const daemon = child('daemon', false)
  const web = child('web', true)

  await assertRejects(
    () =>
      dispatchStartupCommand(
        {
          kind: 'all',
          configPath: '/tmp/config.yml',
          runtimeDir: '/tmp/runtime',
          immediate: false,
        },
        {
          env: { KNOCK_RUNTIME_DIR: '/tmp/runtime' },
          spawnChild: ({ args }) => {
            spawned.push(args)
            return args[1] === 'daemon' ? daemon : web
          },
        },
      ),
    Error,
    'daemon 子进程异常退出: 1',
  )

  assertEquals(spawned.length, 2)
  assertEquals(killed, ['web'])
})
```

- [ ] **Step 2: Extend `src/main_test.ts` with one entry-level delegation check**

```ts
test('[contract] dispatchCliCommand: daemon 命令应委托 startup orchestrator', async () => {
  const calls: string[] = []

  await dispatchCliCommand(
    {
      kind: 'daemon',
      configPath: '/tmp/config.yml',
      runtimeDir: '/tmp/runtime',
      immediate: true,
    },
    {
      dispatchStartupCommand: async () => {
        calls.push('startup')
      },
    },
  )

  assertEquals(calls, ['startup'])
})
```

- [ ] **Step 3: Run the new tests and confirm they fail**

Run:

```bash
bun run test:path -- src/interfaces/startup/startup_orchestrator_test.ts src/main_test.ts
```

Expected: FAIL with module-not-found or missing `dispatchStartupCommand` export.

- [ ] **Step 4: Commit the red state only if your workflow explicitly tracks red commits; otherwise skip commit and continue immediately**

```bash
git status --short
```

Expected: only the new/modified test files are dirty.

## Task 2: Implement the startup orchestrator and rewire `main.ts`

**Files:**

- Create: `src/interfaces/startup/startup_orchestrator.ts`
- Create: `src/interfaces/startup/start_daemon_process.ts`
- Modify: `src/main.ts`
- Modify: `src/interfaces/cli/parse_cli_command.ts`
- Test: `src/interfaces/startup/startup_orchestrator_test.ts`
- Test: `src/main_test.ts`

- [ ] **Step 1: Write the daemon startup seam and orchestrator implementation**

```ts
// src/interfaces/startup/start_daemon_process.ts
import type { CreateTransport } from '../../platform/nodemailer.ts'
import type { Fetcher, ProxyClientFactory } from '../../core/http_client.ts'
import { loadCompiledConfig } from '../../config/load_compiled_config.ts'
import {
  configureLoggingRuntime,
  shutdownLoggingRuntime,
} from '../../core/logging_runtime.ts'
import { createProductionRuntime } from '../../composition/create_production_runtime.ts'
import { startDaemon } from '../daemon/start_daemon.ts'

export interface StartDaemonProcessOptions {
  runtimeDir?: string
  configPath?: string
  httpFetcher?: Fetcher
  httpProxyClientFactory?: ProxyClientFactory
  emailTransportFactory?: CreateTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
  immediate?: boolean
}

export async function startDaemonProcess(
  options: StartDaemonProcessOptions = {},
) {
  const loaded = await loadCompiledConfig({
    runtimeDir: options.runtimeDir,
    configPath: options.configPath,
  })
  const { config, definitions } = loaded

  await configureLoggingRuntime({
    logging: config.logging,
    runtimeDir: config.runtimeDir,
    timezone: config.timezone,
    timestampFormat: config.timestampFormat,
  })

  const daemon = createProductionRuntime({
    config,
    definitions,
    httpFetcher: options.httpFetcher,
    httpProxyClientFactory: options.httpProxyClientFactory,
    emailTransportFactory: options.emailTransportFactory,
    keepAlive: options.keepAlive,
    keepAliveSignal: options.keepAliveSignal,
  })

  try {
    await daemon.recoverInterruptedAttempts()
    if (options.immediate) {
      await daemon.runImmediate()
      return { mode: 'daemon' as const }
    }
    await startDaemon({
      runDueSourcesUseCase: daemon.runDueSourcesUseCase,
      recoverInterruptedAttempts: async () => {},
    })
    await daemon.enterDaemon()
    return { mode: 'daemon' as const }
  } finally {
    daemon.stop()
    await shutdownLoggingRuntime()
  }
}
```

```ts
// src/interfaces/startup/startup_orchestrator.ts
import {
  buildChildArgs,
  resolveDaemonStartOptions,
  type CliCommand,
} from '../cli/parse_cli_command.ts'
import { getEnvObject } from '../../platform/env.ts'
import { spawnSelf, type SpawnedProcess } from '../../platform/process.ts'
import { startWeb } from '../web/start_web.ts'
import {
  startDaemonProcess,
  type StartDaemonProcessOptions,
} from './start_daemon_process.ts'

export interface StartupOrchestratorDeps {
  startDaemon?: (options: StartDaemonProcessOptions) => Promise<unknown>
  startWeb?: (options: { host: string; port: number }) => Promise<void>
  spawnChild?: (input: {
    args: string[]
    env: Record<string, string | undefined>
  }) => SpawnedProcess
  env?: Record<string, string | undefined>
}

function buildChildEnv(
  command: Extract<CliCommand, { kind: 'all' }>,
  env: Record<string, string | undefined>,
) {
  return {
    ...env,
    ...(command.configPath ? { KNOCK_CONFIG_PATH: command.configPath } : {}),
    ...(command.runtimeDir ? { KNOCK_RUNTIME_DIR: command.runtimeDir } : {}),
  }
}

export async function dispatchStartupCommand(
  command: CliCommand,
  deps: StartupOrchestratorDeps = {},
): Promise<void> {
  const env = deps.env ?? getEnvObject()
  const startDaemon = deps.startDaemon ?? startDaemonProcess
  const startWebServer = deps.startWeb ?? startWeb
  const spawnChild =
    deps.spawnChild ??
    ((input) =>
      spawnSelf({
        args: input.args,
        env: input.env as Record<string, string>,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      }))

  if (command.kind === 'daemon') {
    await startDaemon(resolveDaemonStartOptions(command, env))
    return
  }

  if (command.kind === 'web') {
    await startWebServer({ host: command.host, port: command.port })
    return
  }

  const childEnv = buildChildEnv(command, env)
  const daemonChild = spawnChild({
    args: buildChildArgs(command, 'daemon'),
    env: childEnv,
  })
  const webChild = spawnChild({
    args: buildChildArgs(command, 'web'),
    env: { ...childEnv, KNOCK_SKIP_WEB_RUNTIME_READY_CHECK: '1' },
  })

  const firstExit = await Promise.race([
    daemonChild.status.then((status) => ({ name: 'daemon' as const, status })),
    webChild.status.then((status) => ({ name: 'web' as const, status })),
  ])

  if (firstExit.name === 'daemon') webChild.kill('SIGTERM')
  else daemonChild.kill('SIGTERM')

  await Promise.allSettled([daemonChild.status, webChild.status])
  if (!firstExit.status.success) {
    throw new Error(
      `${firstExit.name} 子进程异常退出: ${firstExit.status.code}`,
    )
  }
}
```

- [ ] **Step 2: Thin `src/main.ts` down to startup entry wiring**

```ts
import { dispatchStartupCommand } from './interfaces/startup/startup_orchestrator.ts'
import {
  parseCliCommand,
  type CliCommand,
} from './interfaces/cli/parse_cli_command.ts'

export interface DispatchCliCommandDeps {
  dispatchStartupCommand?: (command: CliCommand) => Promise<void>
}

export async function dispatchCliCommand(
  command: CliCommand,
  deps: DispatchCliCommandDeps = {},
): Promise<void> {
  await (deps.dispatchStartupCommand ?? dispatchStartupCommand)(command)
}

export async function main(
  args: string[],
  deps: DispatchCliCommandDeps = {},
): Promise<void> {
  await dispatchCliCommand(parseCliCommand(args), deps)
}
```

- [ ] **Step 3: Run the focused startup tests and confirm green**

Run:

```bash
bun run test:path -- src/interfaces/startup/startup_orchestrator_test.ts src/main_test.ts src/interfaces/cli/parse_cli_command_test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck for the extracted seam**

Run:

```bash
bun run check
```

Expected: PASS.

- [ ] **Step 5: Commit Phase 1a**

```bash
git add src/interfaces/startup/startup_orchestrator.ts src/interfaces/startup/start_daemon_process.ts src/interfaces/startup/startup_orchestrator_test.ts src/main.ts src/main_test.ts src/interfaces/cli/parse_cli_command.ts
git commit -m "refactor(startup): extract startup orchestrator"
```

## Task 3: Thin `container_entrypoint.ts` and close Phase 1 verification

**Files:**

- Modify: `src/container_entrypoint.ts`
- Modify: `src/container_entrypoint_test.ts`
- Modify: `src/main_test.ts`
- Test: `src/container_entrypoint_test.ts`
- Test: `src/composition/create_production_runtime_test.ts`
- Test: `src/interfaces/daemon/start_daemon_test.ts`

- [ ] **Step 1: Add the failing container delegation test**

```ts
test('[contract] container entrypoint: 标准化参数后应委托 main', async () => {
  const calls: string[][] = []

  await runContainerEntrypoint(['bun', 'run', 'start', '--mode', 'daemon'], {
    main: async (args) => {
      calls.push(args)
    },
  })

  assertEquals(calls, [['--mode', 'daemon']])
})
```

- [ ] **Step 2: Refactor `src/container_entrypoint.ts` so it only normalizes argv/defaults and delegates**

```ts
import { main } from './main.ts'

export interface RunContainerEntrypointDeps {
  main?: (args: string[]) => Promise<void>
  runRawCommand?: (args: string[]) => Promise<void>
}

export async function runContainerEntrypoint(
  rawArgs: string[] = getArgs(),
  deps: RunContainerEntrypointDeps = {},
): Promise<void> {
  const appArgs = normalizeAppArgs(rawArgs)
  if (!appArgs) {
    await (deps.runRawCommand ?? runRawCommand)(rawArgs)
    return
  }

  await (deps.main ?? main)(applyContainerDefaults(appArgs))
}
```

- [ ] **Step 3: Run the Phase 1 test matrix**

Run:

```bash
bun run test:path -- src/container_entrypoint_test.ts src/composition/create_production_runtime_test.ts src/interfaces/daemon/start_daemon_test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the startup baseline command**

Run:

```bash
bun run test:startup
```

Expected: PASS.

- [ ] **Step 5: Because `src/main.ts` and `src/container_entrypoint.ts` are shared high-impact boundaries, run the full suite before closing Phase 1**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 6: Commit Phase 1b**

```bash
git add src/container_entrypoint.ts src/container_entrypoint_test.ts src/main_test.ts
git commit -m "refactor(startup): thin container entrypoint"
```

## Task 4: Add shared Web action executor tests

**Files:**

- Create: `src/interfaces/web/web_action_executor_test.ts`
- Modify: `web/routes/api/sources/run_test.ts`
- Modify: `web/routes/api/config/global_test.ts`
- Test: `src/interfaces/web/web_action_executor_test.ts`

- [ ] **Step 1: Write executor contract tests**

```ts
import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import { executeWebAction } from './web_action_executor.ts'

function sameOriginHeaders(origin: string = 'http://localhost') {
  return { 'content-type': 'application/json', origin }
}

test('[contract] web action executor: 跨源写请求应短路且不调用 run', async () => {
  let called = false
  const response = await executeWebAction(
    new Request('http://localhost/api/config/global', {
      method: 'POST',
      headers: sameOriginHeaders('http://evil.example'),
      body: JSON.stringify({ ok: true }),
    }),
    {
      requireSameOrigin: true,
      run: async () => {
        called = true
        return { ok: true }
      },
      classifyError: () => ({
        status: 500,
        code: 'boom',
        category: 'internal',
        message: 'boom',
      }),
      forbidden: {
        message: 'config 写请求必须来自同源页面',
        code: 'config_action_forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'config 请求非法',
        code: 'config_request_invalid',
        category: 'validation',
      },
    },
  )

  assertEquals(called, false)
  assertEquals(response.status, 403)
})

test('[contract] web action executor: internal 错误应映射为结构化错误体', async () => {
  const response = await executeWebAction(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
    {
      requireSameOrigin: true,
      run: async () => {
        throw new Error('db open failed')
      },
      classifyError: () => ({
        status: 500,
        code: 'source_action_failed',
        category: 'internal',
        message: 'source 操作失败，请查看服务端日志。',
      }),
      forbidden: {
        message: 'source 写请求必须来自同源页面',
        code: 'source_action_forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'source 请求非法',
        code: 'source_request_invalid',
        category: 'validation',
      },
    },
  )

  assertEquals(response.status, 500)
  assertEquals((await response.json()).code, 'source_action_failed')
})
```

- [ ] **Step 2: Add one route-level guard test proving current route contracts stay unchanged**

```ts
test('[contract] sources run api: executor 提取后仍返回相同 403 结构', async () => {
  const response = await handler(
    new Request('http://localhost/api/sources/run', {
      method: 'POST',
      headers: sameOriginHeaders('http://evil.example'),
      body: JSON.stringify({ sourceId: 'rust' }),
    }),
  )

  assertEquals(response.status, 403)
  const payload = await readJson(response)
  assertEquals(payload, {
    message: 'source 写请求必须来自同源页面',
    code: 'source_action_forbidden',
    category: 'forbidden',
  })
})
```

- [ ] **Step 3: Run the executor tests and confirm they fail**

Run:

```bash
bun run test:path -- src/interfaces/web/web_action_executor_test.ts web/routes/api/sources/run_test.ts web/routes/api/config/global_test.ts
```

Expected: FAIL with missing executor module/export.

- [ ] **Step 4: Verify only Web test files changed before implementation**

Run:

```bash
git status --short
```

Expected: only the new executor test and touched route tests are dirty.

## Task 5: Implement `web_action_executor.ts` and thin the handler adapters

**Files:**

- Create: `src/interfaces/web/web_action_executor.ts`
- Modify: `src/interfaces/web/create_config_action_handler.ts`
- Modify: `src/interfaces/web/create_source_action_handler.ts`
- Modify: `src/interfaces/web/create_playground_evaluate_handler.ts`
- Modify: `web/routes/api/config/global.ts`
- Modify: `web/routes/api/sources/run.ts`
- Modify: `web/routes/api/syndication/evaluate.ts`
- Test: `src/interfaces/web/web_action_executor_test.ts`

- [ ] **Step 1: Implement the shared executor**

```ts
import { isSameOriginWriteRequest } from './same_origin_write.ts'

export interface WebActionErrorBody {
  message: string
  code: string
  category: string
}

export interface ExecuteWebActionOptions<TResult, TMeta = unknown> {
  requireSameOrigin: boolean
  run: (payload: unknown) => Promise<TResult>
  classifyError: (error: unknown) => {
    status: number
    message: string
    code: string
    category: string
  }
  forbidden: WebActionErrorBody
  invalidJson: WebActionErrorBody
  onSuccessMeta?: (payload: unknown, result: TResult) => TMeta
  onErrorMeta?: (
    payload: unknown | undefined,
    error: unknown,
    classified: {
      status: number
      message: string
      code: string
      category: string
    },
  ) => TMeta
  onLogMeta?: (meta: TMeta) => void
}

export async function executeWebAction<TResult, TMeta = unknown>(
  request: Request,
  options: ExecuteWebActionOptions<TResult, TMeta>,
): Promise<Response> {
  if (options.requireSameOrigin && !isSameOriginWriteRequest(request)) {
    return Response.json(options.forbidden, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json(options.invalidJson, { status: 400 })
  }

  try {
    const result = await options.run(payload)
    if (options.onSuccessMeta)
      options.onLogMeta?.(options.onSuccessMeta(payload, result))
    return Response.json(result)
  } catch (error) {
    const classified = options.classifyError(error)
    if (options.onErrorMeta)
      options.onLogMeta?.(options.onErrorMeta(payload, error, classified))
    return Response.json(
      {
        message: classified.message,
        code: classified.code,
        category: classified.category,
      },
      { status: classified.status },
    )
  }
}
```

- [ ] **Step 2: Rewrite the three handler factories as thin adapters**

```ts
export function createConfigActionHandler(
  options: CreateConfigActionHandlerOptions,
) {
  return async function handler(
    request: Request,
    deps: ConfigActionHandlerDeps = {},
  ): Promise<Response> {
    return executeWebAction(request, {
      requireSameOrigin: true,
      run: deps.runAction ?? options.runAction,
      classifyError: options.classifyError,
      forbidden: {
        message: 'config 写请求必须来自同源页面',
        code: 'config_action_forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'config 请求非法',
        code: 'config_request_invalid',
        category: 'validation',
      },
    })
  }
}
```

```ts
export function createPlaygroundEvaluateHandler(
  options: CreatePlaygroundEvaluateHandlerOptions,
) {
  return async function handler(
    request: Request,
    deps: EvaluateHandlerDeps = {},
  ): Promise<Response> {
    return executeWebAction(request, {
      requireSameOrigin: false,
      run: async (payload) =>
        (deps.evaluatePlayground ?? options.evaluatePlayground)({
          request: payload,
        }),
      classifyError: options.classifyError,
      forbidden: {
        message: 'forbidden',
        code: 'forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'Playground 请求非法',
        code: 'playground_request_invalid',
        category: 'validation',
      },
      onLogMeta: deps.onLogMeta,
      onSuccessMeta: (_payload, result) => ({
        parser: result.parser,
        warningCount: result.warnings.length,
        entryCount: result.entries.length,
        fetchDurationMs: result.fetchMeta.fetchDurationMs,
        parseDurationMs: result.fetchMeta.parseDurationMs,
      }),
      onErrorMeta: (payload, error, classified) => ({
        targetHost: readTargetHost(payload),
        errorCode: classified.code,
        errorCategory: classified.category,
        errorMessage:
          error instanceof Error ? error.message : classified.message,
      }),
    })
  }
}
```

- [ ] **Step 3: Run focused Web tests**

Run:

```bash
bun run test:path -- src/interfaces/web/web_action_executor_test.ts web/routes/api/config/global_test.ts web/routes/api/sources/run_test.ts web/routes/api/syndication/evaluate_test.ts web/routes/api/xquery/evaluate_test.ts
```

Expected: PASS.

- [ ] **Step 4: Run Web typecheck**

Run:

```bash
bun run check
```

Expected: PASS.

- [ ] **Step 5: Commit Phase 2a**

```bash
git add src/interfaces/web/web_action_executor.ts src/interfaces/web/web_action_executor_test.ts src/interfaces/web/create_config_action_handler.ts src/interfaces/web/create_source_action_handler.ts src/interfaces/web/create_playground_evaluate_handler.ts web/routes/api/config/global.ts web/routes/api/sources/run.ts web/routes/api/syndication/evaluate.ts web/routes/api/xquery/evaluate.ts
git commit -m "refactor(web): extract shared action executor"
```

## Task 6: Add `runtime_session.ts` and reuse it from config/source management

**Files:**

- Create: `src/interfaces/web/runtime_session.ts`
- Create: `src/interfaces/web/runtime_session_test.ts`
- Modify: `src/interfaces/web/config_management.ts`
- Modify: `src/interfaces/web/source_management.ts`
- Modify: `src/interfaces/web/source_management_context.ts`
- Modify: `src/web/config_workbench_overview.ts`
- Test: `src/interfaces/web/runtime_session_test.ts`
- Test: `src/interfaces/web/config_management_test.ts`
- Test: `src/interfaces/web/source_management_test.ts`

- [ ] **Step 1: Write the failing runtime-session contract test**

```ts
import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import {
  loadRuntimeSession,
  buildWorkbenchOverviewFromSession,
} from './runtime_session.ts'
import {
  withEnv,
  withRuntimeHarness,
  writeRuntimeFile,
} from '../../testing/test_helpers.ts'

test('[contract] runtime session: workbench overview 应复用同一 runtime context', async () => {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await writeRuntimeFile(
      runtimeDir,
      'config.yml',
      'logging:\n  level: info\nsources: {}\ndeliveries: {}\n',
    )
    await withEnv({ KNOCK_RUNTIME_DIR: runtimeDir }, async () => {
      const session = await loadRuntimeSession()
      const overview = await buildWorkbenchOverviewFromSession(session)
      assertEquals(overview.global.logging?.level, 'info')
      assertEquals(Array.isArray(overview.reader.sources), true)
    })
  })
})
```

- [ ] **Step 2: Implement the runtime session seam**

```ts
import {
  loadConfigRuntimeContext,
  type ConfigRuntimeContext,
} from '../../config/runtime_config_context.ts'
import {
  buildCurrentReaderOverview,
  type ReaderOverview,
} from '../../web/reader_overview.ts'
import {
  buildConfigWorkbenchOverview,
  type ConfigWorkbenchOverview,
} from '../../web/config_workbench_overview.ts'

export interface RuntimeSession {
  context: ConfigRuntimeContext
}

export async function loadRuntimeSession(): Promise<RuntimeSession> {
  return {
    context: await loadConfigRuntimeContext({ envMode: 'preserve_unknown' }),
  }
}

export async function buildReaderOverviewFromSession(
  session: RuntimeSession,
): Promise<ReaderOverview> {
  return buildCurrentReaderOverview({
    loaded: session.context.loaded,
    rawDocument: session.context.rawDocument.document,
  })
}

export async function buildWorkbenchOverviewFromSession(
  session: RuntimeSession,
): Promise<ConfigWorkbenchOverview> {
  return buildConfigWorkbenchOverview({
    rawDocument: session.context.rawDocument.document,
    reader: await buildReaderOverviewFromSession(session),
  })
}
```

- [ ] **Step 3: Refactor config/source management to consume the shared session seam**

```ts
const session = await loadRuntimeSession()
const currentSource = cloneRecord(
  cloneRecord(session.context.rawDocument.document.sources)[request.sourceId],
)

return {
  message: `source ${request.sourceId} 配置已保存`,
  overview: await buildReaderOverviewFromSession({
    context: updatedContext,
  }),
}
```

```ts
export async function loadSourceActionContext(
  input: unknown,
): Promise<SourceActionContext> {
  const request = parseSourceAction(input)
  const session = await loadRuntimeSession()
  const source = session.context.loaded.config.sources.find(
    (item) => item.id === request.sourceId,
  )
  if (!source)
    throw new SourceActionContextError(
      `source 未定义: ${request.sourceId}`,
      'not_found',
    )
  return {
    request,
    loaded: session.context.loaded,
    source,
  }
}
```

- [ ] **Step 4: Run the Web domain tests**

Run:

```bash
bun run test:path -- src/interfaces/web/runtime_session_test.ts src/interfaces/web/config_management_test.ts src/interfaces/web/source_management_test.ts src/web/config_workbench_overview_test.ts src/web/reader_overview_test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Phase 2b**

```bash
git add src/interfaces/web/runtime_session.ts src/interfaces/web/runtime_session_test.ts src/interfaces/web/config_management.ts src/interfaces/web/source_management.ts src/interfaces/web/source_management_context.ts src/web/config_workbench_overview.ts
git commit -m "refactor(web): extract runtime session seam"
```

## Task 7: Inline `luxon` and `preact*` pass-through adapters

**Files:**

- Delete: `src/platform/luxon.ts`
- Delete: `src/platform/preact.ts`
- Delete: `src/platform/preact_hooks.ts`
- Delete: `src/platform/preact_render_to_string.ts`
- Delete: `src/platform/preact_types.ts`
- Modify: `src/core/logger_support.ts`
- Modify: `src/sources/feed_shared.ts`
- Modify: `web/client.tsx`
- Modify: `web/main.tsx`
- Modify: `web/islands/config_workbench.tsx`
- Modify: `web/components/layout/app_shell.tsx`
- Modify: `web/routes/_app.tsx`
- Modify: `web/routes/config_test.ts`
- Test: `src/core/logger_test.ts`
- Test: `web/main_test.ts`

- [ ] **Step 1: Replace the wrapper imports with direct library imports**

```ts
// src/core/logger_support.ts
import { DateTime } from 'luxon'
```

```tsx
// web/main.tsx
/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact'
import renderToString from 'preact-render-to-string'
```

```tsx
// web/client.tsx
/** @jsxImportSource preact */
import { hydrate } from 'preact'
```

```tsx
// web/islands/config_workbench.tsx
import { useMemo, useState } from 'preact/hooks'
```

- [ ] **Step 2: Delete the pass-through files once all call sites compile**

```bash
rm src/platform/luxon.ts src/platform/preact.ts src/platform/preact_hooks.ts src/platform/preact_render_to_string.ts src/platform/preact_types.ts
```

- [ ] **Step 3: Run the focused platform/web checks**

Run:

```bash
bun run check && bun run build:web && bun run test:path -- web src/web src/core/logger_test.ts
```

Expected: PASS.

- [ ] **Step 4: Run one startup smoke test to catch accidental JSX/runtime fallout**

Run:

```bash
bun run test:startup
```

Expected: PASS.

- [ ] **Step 5: Commit Phase 3a**

```bash
git add src/core/logger_support.ts src/sources/feed_shared.ts web/client.tsx web/main.tsx web/islands/config_workbench.tsx web/components/layout/app_shell.tsx web/routes/_app.tsx web/routes/config_test.ts
git rm src/platform/luxon.ts src/platform/preact.ts src/platform/preact_hooks.ts src/platform/preact_render_to_string.ts src/platform/preact_types.ts
git commit -m "refactor(platform): inline preact and luxon adapters"
```

## Task 8: Inline `yaml` if Bun direct import stays clean

**Files:**

- Delete: `src/platform/yaml.ts`
- Modify: `src/config/load_compiled_config.ts`
- Modify: `src/config/raw_config_document.ts`
- Modify: `src/testing/risk_mapping.ts`
- Modify: `src/config/config_example_test.ts`
- Modify: `src/interfaces/web/config_management_test.ts`
- Modify: `src/interfaces/web/source_management_test.ts`
- Test: `src/config/load_config_test.ts`
- Test: `src/testing/risk_mapping_test.ts`

- [ ] **Step 1: Convert production call sites to direct `yaml` imports**

```ts
// src/config/load_compiled_config.ts
import { parse } from 'yaml'
```

```ts
// src/config/raw_config_document.ts
import { stringify } from 'yaml'
```

```ts
// src/testing/risk_mapping.ts
import { parse } from 'yaml'
```

- [ ] **Step 2: Convert tests that currently use `YAML.parse(...)`**

```ts
// src/interfaces/web/config_management_test.ts
import { parse as parseYaml } from 'yaml'

const nextConfig = parseYaml(
  await readTextFile(`${runtimeDir}/config.yml`),
) as {
  logging?: { level?: string }
}
```

```ts
// src/interfaces/web/source_management_test.ts
import { parse as parseYaml } from 'yaml'

const nextConfig = parseYaml(
  await readTextFile(`${runtimeDir}/config.yml`),
) as {
  sources?: Record<string, unknown>
}
```

- [ ] **Step 3: Delete the wrapper and run the scoped config/tests**

```bash
rm src/platform/yaml.ts
bun run check && bun run test:path -- src/config src/testing/risk_mapping_test.ts src/interfaces/web/config_management_test.ts src/interfaces/web/source_management_test.ts
```

Expected: PASS.

- [ ] **Step 4: Run startup baseline because config loading sits on a shared boundary**

Run:

```bash
bun run test:startup
```

Expected: PASS.

- [ ] **Step 5: Commit Phase 3b**

```bash
git add src/config/load_compiled_config.ts src/config/raw_config_document.ts src/testing/risk_mapping.ts src/config/config_example_test.ts src/interfaces/web/config_management_test.ts src/interfaces/web/source_management_test.ts
git rm src/platform/yaml.ts
git commit -m "refactor(platform): inline yaml adapter"
```

## Task 9: Run direct-import proofs for `ky`, `croner`, and `liquidjs`

**Files:**

- Modify: `src/core/http_client.ts`
- Modify: `src/composition/create_production_runtime.ts`
- Modify: `src/composition/create_runtime_kernel.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/core/liquid_runtime.ts`
- Modify: `src/core/liquid_validation.ts`
- Maybe Delete: `src/platform/ky.ts`
- Maybe Delete: `src/platform/croner.ts`
- Maybe Delete: `src/platform/liquidjs.ts`
- Test: `src/core/content_runtime_test.ts`
- Test: `src/core/liquid_runtime_test.ts`
- Test: `src/composition/create_runtime_kernel_test.ts`
- Test: `src/composition/create_production_runtime_test.ts`

- [ ] **Step 1: Replace wrapper imports in a temporary patch**

```ts
// src/core/http_client.ts
import ky, { type KyInput, type KyOptions } from 'ky'
```

```ts
// src/config/schema.ts
import { CronPattern } from 'croner'
```

```ts
// src/composition/create_runtime_kernel.ts
import { Cron } from 'croner'
```

```ts
// src/core/liquid_runtime.ts
import { Liquid, TokenKind } from 'liquidjs'
```

- [ ] **Step 2: Run the proof suite immediately after the import rewrite**

Run:

```bash
bun run check && bun run test:path -- src/core/liquid_runtime_test.ts src/core/content_runtime_test.ts src/composition/create_runtime_kernel_test.ts src/composition/create_production_runtime_test.ts src/main_test.ts
```

Expected: either PASS, or a concrete import/interop failure tied to one of the three libraries.

- [ ] **Step 3: If the proof suite passes, delete the wrappers and rerun the same suite**

```bash
rm src/platform/ky.ts src/platform/croner.ts src/platform/liquidjs.ts
bun run check && bun test src/core/liquid_runtime_test.ts src/core/content_runtime_test.ts src/composition/create_runtime_kernel_test.ts src/composition/create_production_runtime_test.ts src/main_test.ts
```

Expected: PASS.

- [ ] **Step 4: If the proof suite fails, revert only the failing library to its wrapper and keep that wrapper intentionally**

```bash
git checkout -- src/core/http_client.ts src/composition/create_production_runtime.ts src/composition/create_runtime_kernel.ts src/config/schema.ts src/core/liquid_runtime.ts src/core/liquid_validation.ts
```

Then re-apply only the imports that passed and rerun:

```bash
bun run check && bun run test:startup
```

Expected: PASS with only the wrappers that still earn their interop keep retained.

- [ ] **Step 5: Commit Phase 3c with the proven outcome**

If all three wrappers were removed:

```bash
git add src/core/http_client.ts src/composition/create_production_runtime.ts src/composition/create_runtime_kernel.ts src/config/schema.ts src/core/liquid_runtime.ts src/core/liquid_validation.ts
git rm src/platform/ky.ts src/platform/croner.ts src/platform/liquidjs.ts
git commit -m "refactor(platform): remove remaining shallow adapters"
```

If one or more wrappers stayed because the proof failed, commit the partial direct-import win instead:

```bash
git add src/core/http_client.ts src/composition/create_production_runtime.ts src/composition/create_runtime_kernel.ts src/config/schema.ts src/core/liquid_runtime.ts src/core/liquid_validation.ts src/platform/ky.ts src/platform/croner.ts src/platform/liquidjs.ts
git commit -m "refactor(platform): keep only proven interop adapters"
```

## Spec coverage checklist

- Phase 1 startup/runtime seam: covered by Tasks 1-3.
- Phase 2 Web action executor + runtime session seam: covered by Tasks 4-6.
- Phase 3 adapter deletion test, with real seam retention for `env.ts` / `process.ts` / `serve.ts`: covered by Tasks 7-9.
- Independent verification and clean stop after every phase: each phase ends with its own scoped test + commit boundary.
- CLI/config contract stability: enforced by Tasks 1-3 and retained throughout the route/config tests in Tasks 4-9.

## Execution notes

- Do **not** widen scope inside a phase. If a compiler or test failure points to an unrelated subsystem, stop and open a follow-up task instead of folding it into the current phase.
- Do **not** edit `README.md` or `config.example.yml` unless user-visible behavior changes; the intended outcome here is internal restructuring only.
- Keep tests at `unit` / `contract` / `flow` boundaries. For this refactor, prefer `contract` coverage; do not create new `flow` tests unless a risk-matrix-owned path truly changes.
- Any task that changes test files MUST also run `/test-architecture-guard` before commit, then run scoped `bun run fmt:check:path -- <path ...>` and `bun run lint:check:path -- <path ...>` for the touched files.
