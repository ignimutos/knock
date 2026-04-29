# Bun Binary Release and Cold Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Linux x64 single-file Bun binary plus a binary-backed Docker image, while preserving `--mode all|web|daemon` behavior and cutting image size / cold start by at least 30%.

**Architecture:** Keep the existing CLI and supervisor model, but add a compiled-only release path under `scripts/release/` so production no longer depends on runtime `build:web`, `.web-dist` sidecars, or request-time dynamic imports. Share the Web request router between dev and compiled paths, compile a binary from a custom release entrypoint, then swap Docker and CI to use that binary.

**Tech Stack:** Bun, TypeScript, Preact, Vite, Docker, Bash

---

## File Structure

### New files

- Create: `web/create_web_request_handler.tsx`
  - Shared Web request router used by both the existing dev adapter and the compiled release adapter.
- Create: `web/create_web_request_handler_test.tsx`
  - Contract tests for route dispatch independent of disk-backed or embedded client assets.
- Create: `src/interfaces/web/web_startup_runtime.ts`
  - Shared Web startup helpers: logging runtime load, ready checks, ready probe, and server lifecycle glue.
- Create: `src/interfaces/cli/release_scripts_test.ts`
  - Contract test for new release-oriented package scripts.
- Create: `scripts/release/compiled_web_main.tsx`
  - Compiled-only Web adapter with static route imports and embedded client asset.
- Create: `scripts/release/start_compiled_web.ts`
  - Compiled-only Web startup entry that reuses shared startup helpers and imports `compiled_web_main.tsx` statically.
- Create: `scripts/release/compiled_main.ts`
  - Compiled-only CLI main that dispatches startup with `startCompiledWeb()`.
- Create: `scripts/release/compiled_container_main.ts`
  - Final `bun build --compile` entrypoint; reuses `runContainerEntrypoint()` with the compiled main.
- Create: `scripts/release/build_binary.ts`
  - Build orchestrator: ensure `build:web`, then compile `scripts/release/compiled_container_main.ts` into `dist/knock-linux-x64`.
- Create: `scripts/release/smoke_binary.sh`
  - Black-box smoke script for `web`, `daemon --immediate`, and `all` on the compiled binary.
- Create: `scripts/release/smoke_image.sh`
  - Docker smoke script that checks the image entrypoint and probes `/config` readiness.
- Create: `scripts/release/measure_cold_start.sh`
  - Compares baseline and candidate Docker images and fails if the candidate is not at least 30% faster.

### Modified files

- Modify: `web/main.tsx`
  - Reduce to the dev adapter over `createWebRequestHandler()`; keep dynamic imports and disk-backed asset serving only for the non-compiled path.
- Modify: `web/main_test.ts`
  - Keep existing contract coverage after the adapter extraction.
- Modify: `src/interfaces/web/start_web.ts`
  - Reuse shared startup helpers; keep runtime `build:web` fallback only for the non-compiled path.
- Modify: `package.json`
  - Add `build:binary`, `smoke:binary`, `smoke:image`, `measure:cold-start`; update `image:prepare` and `release:prepare`.
- Modify: `Dockerfile`
  - Build the compiled binary in the build stage and copy only the binary + runtime prerequisites into the final image.
- Modify: `.github/workflows/docker.yml`
  - Build/smoke the binary in CI, publish a binary artifact, and keep the image build path aligned with the compiled runtime.
- Modify: `README.md`
  - Document the new binary artifact, binary-backed image entrypoint, and verification flow.
- Modify: `docker/README.md`
  - Update the Docker Hub description source to match the new binary-backed image.

### Intentional non-goals inside the implementation

- Do not change `src/container_entrypoint.ts`, `src/main.ts`, or `src/interfaces/startup/startup_orchestrator.ts` unless compiler feedback forces it.
- Do not change config shape or runtime semantics.
- Do not touch `src/db/**` or `src/application/**` unless a compiled path failure proves it is necessary.

### Key decomposition decision

All compiled-only adapters live under `scripts/release/` on purpose. That keeps `.web-dist/assets/client.js` and Bun `with { type: "file" }` imports out of project-wide `tsc --project tsconfig.json`, so `bun run check` on a clean checkout does not start depending on compiled-only sources.

## Task 1: Extract a shared Web request router

**Files:**

- Create: `web/create_web_request_handler.tsx`
- Create: `web/create_web_request_handler_test.tsx`
- Modify: `web/main.tsx`
- Modify: `web/main_test.ts`
- Test: `web/create_web_request_handler_test.tsx`
- Test: `web/main_test.ts`

- [ ] **Step 1: Write the failing shared-router contract test**

```ts
// web/create_web_request_handler_test.tsx
import { assertEquals, assertStringIncludes } from '../src/testing/assert.ts'
import { test } from '../src/testing/test_api.ts'
import { createWebRequestHandler } from './create_web_request_handler.tsx'

const okJson = () => Promise.resolve(Response.json({ ok: true }))

test('[contract] createWebRequestHandler: 应将 /assets/client.js 委托给注入的 asset responder', async () => {
  const handler = createWebRequestHandler({
    serveClientAsset: async () =>
      new Response('console.log("embedded")', {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
      }),
    apiHandlers: {
      readerOverview: okJson,
      xqueryEvaluate: okJson,
      syndicationEvaluate: okJson,
      configGlobal: okJson,
      configDeliveries: okJson,
      configDeliveriesDelete: okJson,
      sourcesUpdate: okJson,
      sourcesRun: okJson,
      sourcesClear: okJson,
    },
  })

  const response = await handler(
    new Request('http://localhost/assets/client.js'),
  )
  assertEquals(response.status, 200)
  assertStringIncludes(
    response.headers.get('content-type') ?? '',
    'application/javascript',
  )
  assertStringIncludes(await response.text(), 'embedded')
})

test('[contract] createWebRequestHandler: 未知路由应返回 404', async () => {
  const handler = createWebRequestHandler({
    serveClientAsset: async () => new Response('asset'),
    apiHandlers: {
      readerOverview: okJson,
      xqueryEvaluate: okJson,
      syndicationEvaluate: okJson,
      configGlobal: okJson,
      configDeliveries: okJson,
      configDeliveriesDelete: okJson,
      sourcesUpdate: okJson,
      sourcesRun: okJson,
      sourcesClear: okJson,
    },
  })

  const response = await handler(new Request('http://localhost/missing'))
  assertEquals(response.status, 404)
})
```

- [ ] **Step 2: Run the router test to prove the new module is missing**

Run:

```bash
bun run test:path -- web/create_web_request_handler_test.tsx
```

Expected: FAIL with `Cannot find module './create_web_request_handler.tsx'`.

- [ ] **Step 3: Implement the shared router and reduce `web/main.tsx` to the dev adapter**

```tsx
// web/create_web_request_handler.tsx
/** @jsxImportSource preact */

import type { ComponentChildren } from 'preact'
import renderToString from 'preact-render-to-string'
import AppDocument from './routes/_app.tsx'
import IndexPage from './routes/index.tsx'
import ReaderPage from './routes/reader.tsx'
import ConfigPage from './routes/config.tsx'
import XqueryPage from './routes/xquery.tsx'
import SyndicationPage from './routes/syndication.tsx'
import { loadReaderOverview } from '../src/web/reader_overview.ts'
import { loadConfigWorkbenchOverview } from '../src/web/config_workbench_overview.ts'

export interface WebApiHandlers {
  readerOverview: (request: Request) => Promise<Response>
  xqueryEvaluate: (request: Request) => Promise<Response>
  syndicationEvaluate: (request: Request) => Promise<Response>
  configGlobal: (request: Request) => Promise<Response>
  configDeliveries: (request: Request) => Promise<Response>
  configDeliveriesDelete: (request: Request) => Promise<Response>
  sourcesUpdate: (request: Request) => Promise<Response>
  sourcesRun: (request: Request) => Promise<Response>
  sourcesClear: (request: Request) => Promise<Response>
}

export interface CreateWebRequestHandlerOptions {
  serveClientAsset: () => Promise<Response>
  apiHandlers: WebApiHandlers
}

function renderDocument(
  content: ComponentChildren,
  title: string = 'Knock Web',
): Response {
  const html =
    '<!DOCTYPE html>' +
    renderToString(<AppDocument title={title}>{content}</AppDocument>)
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export function createWebRequestHandler(
  options: CreateWebRequestHandlerOptions,
) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const routeKey = `${request.method} ${url.pathname}`

    switch (routeKey) {
      case 'GET /assets/client.js':
        return await options.serveClientAsset()
      case 'GET /':
        return renderDocument(<IndexPage />)
      case 'GET /reader': {
        const overview = await loadReaderOverview()
        return renderDocument(<ReaderPage overview={overview} />)
      }
      case 'GET /config': {
        const workbench = await loadConfigWorkbenchOverview()
        return renderDocument(<ConfigPage workbench={workbench} />)
      }
      case 'GET /xquery':
        return renderDocument(<XqueryPage />)
      case 'GET /syndication':
        return renderDocument(<SyndicationPage />)
      case 'GET /api/reader/overview':
        return await options.apiHandlers.readerOverview(request)
      case 'POST /api/xquery/evaluate':
        return await options.apiHandlers.xqueryEvaluate(request)
      case 'POST /api/syndication/evaluate':
        return await options.apiHandlers.syndicationEvaluate(request)
      case 'POST /api/config/global':
        return await options.apiHandlers.configGlobal(request)
      case 'POST /api/config/deliveries':
        return await options.apiHandlers.configDeliveries(request)
      case 'POST /api/config/deliveries/delete':
        return await options.apiHandlers.configDeliveriesDelete(request)
      case 'POST /api/sources/update':
        return await options.apiHandlers.sourcesUpdate(request)
      case 'POST /api/sources/run':
        return await options.apiHandlers.sourcesRun(request)
      case 'POST /api/sources/clear':
        return await options.apiHandlers.sourcesClear(request)
      default:
        return new Response('Not Found', { status: 404 })
    }
  }
}
```

```tsx
// web/main.tsx (adapter shape only)
import { join } from 'node:path'
import { cwd, isNotFoundError, readTextFile } from '../src/platform/fs.ts'
import { createWebRequestHandler } from './create_web_request_handler.tsx'

async function serveClientAssetFromDisk(): Promise<Response> {
  try {
    const source = await readTextFile(
      join(cwd(), '.web-dist', 'assets', 'client.js'),
    )
    return new Response(source, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  } catch (error) {
    if (isNotFoundError(error))
      return new Response('Not Found', { status: 404 })
    throw error
  }
}

export const handleWebRequest = createWebRequestHandler({
  serveClientAsset: serveClientAssetFromDisk,
  apiHandlers: {
    readerOverview: readerOverviewHandler,
    xqueryEvaluate: xqueryEvaluateHandler,
    syndicationEvaluate: syndicationEvaluateHandler,
    configGlobal: configGlobalHandler,
    configDeliveries: configDeliveriesHandler,
    configDeliveriesDelete: configDeliveriesDeleteHandler,
    sourcesUpdate: sourcesUpdateHandler,
    sourcesRun: sourcesRunHandler,
    sourcesClear: sourcesClearHandler,
  },
})
```

- [ ] **Step 4: Re-run the Web router tests**

Run:

```bash
bun run test:path -- web/create_web_request_handler_test.tsx web/main_test.ts
```

Expected: PASS.

- [ ] **Step 5: Run scoped formatting and lint checks for the extracted router**

Run:

```bash
bun run fmt:check:path -- web/create_web_request_handler.tsx web/create_web_request_handler_test.tsx web/main.tsx web/main_test.ts && bun run lint:check:path -- web/create_web_request_handler.tsx web/create_web_request_handler_test.tsx web/main.tsx web/main_test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the router extraction**

```bash
git add web/create_web_request_handler.tsx web/create_web_request_handler_test.tsx web/main.tsx web/main_test.ts
git commit -m "refactor(web): share request router for release adapters"
```

Expected: commit succeeds with only the router extraction files staged.

## Task 2: Add the compiled binary build path and binary smoke test

**Files:**

- Create: `src/interfaces/cli/release_scripts_test.ts`
- Create: `src/interfaces/web/web_startup_runtime.ts`
- Modify: `src/interfaces/web/start_web.ts`
- Create: `scripts/release/compiled_web_main.tsx`
- Create: `scripts/release/start_compiled_web.ts`
- Create: `scripts/release/compiled_main.ts`
- Create: `scripts/release/compiled_container_main.ts`
- Create: `scripts/release/build_binary.ts`
- Create: `scripts/release/smoke_binary.sh`
- Modify: `package.json`
- Test: `src/interfaces/cli/release_scripts_test.ts`

- [ ] **Step 1: Add the failing package-script contract test**

```ts
// src/interfaces/cli/release_scripts_test.ts
import { assertEquals } from '../../testing/assert.ts'
import { readFileSync } from 'node:fs'
import { test } from '../../testing/test_api.ts'

type PackageJson = { scripts?: Record<string, string> }

test('[contract] package.json scripts: release binary workflow 应暴露稳定入口', () => {
  const text = readFileSync(
    new URL('../../../package.json', import.meta.url),
    'utf8',
  )
  const parsed = JSON.parse(text) as PackageJson
  const scripts = parsed.scripts ?? {}

  assertEquals(
    scripts['build:binary'],
    'bun run scripts/release/build_binary.ts',
  )
  assertEquals(
    scripts['smoke:binary'],
    'bash ./scripts/release/smoke_binary.sh',
  )
})
```

- [ ] **Step 2: Run the contract test before adding the scripts**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_scripts_test.ts
```

Expected: FAIL because `build:binary` and `smoke:binary` are missing from `package.json`.

- [ ] **Step 3: Add the shared Web startup helpers and compiled-only release adapters**

```ts
// src/interfaces/web/web_startup_runtime.ts
import type { LoggingConfigResolved } from '../../config/types.ts'
import { createLogger } from '../../core/logger.ts'
import {
  configureLoggingRuntime,
  shutdownLoggingRuntime,
} from '../../core/logging_runtime.ts'
import { isAddrInUseError, serve } from '../../platform/serve.ts'

export interface StartWebLoggingRuntime {
  runtimeDir: string
  timezone: string
  timestampFormat: string
  logging: LoggingConfigResolved
}

export interface StartWebOptions {
  host: string
  port: number
}

export async function runReadyCheckedWebServer(
  options: StartWebOptions,
  runtime: StartWebLoggingRuntime | undefined,
  handleWebRequest: (request: Request) => Promise<Response>,
  deps: {
    assertReady: () => Promise<void>
    waitForReady: (host: string, port: number) => Promise<void>
  },
): Promise<void> {
  if (runtime) await configureLoggingRuntime(runtime)

  const logger = createLogger({
    enabled: true,
    level: runtime?.logging.level ?? 'info',
    module: 'web.startup',
    component: 'web',
    timezone: runtime?.timezone ?? 'UTC',
    timestampFormat: runtime?.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss',
  })

  const abortController = new AbortController()
  let server: ReturnType<typeof serve> | undefined

  try {
    await deps.assertReady()
    server = serve(
      {
        hostname: options.host,
        port: options.port,
        signal: abortController.signal,
      },
      (request) => handleWebRequest(request),
    )
    await deps.waitForReady(options.host, options.port)
    logger.info(`Web 服务开始监听 http://${options.host}:${options.port}/`)
    await server.finished
  } catch (error) {
    if (isAddrInUseError(error)) throw new Error('web 子进程异常退出: 1')
    throw error
  } finally {
    abortController.abort()
    if (server) await server.shutdown().catch(() => {})
    await shutdownLoggingRuntime()
  }
}
```

```ts
// src/interfaces/web/start_web.ts (relevant shape only)
import {
  runReadyCheckedWebServer,
  type StartWebOptions,
} from './web_startup_runtime.ts'
import { handleWebRequest } from '../../../web/main.tsx'

export { assertWebRuntimeReady, loadStartWebLoggingRuntime, waitForWebReady }

export async function startWeb(options: StartWebOptions) {
  const loggingRuntime = await loadStartWebLoggingRuntime()
  await ensureWebBuildExists()
  await runReadyCheckedWebServer(options, loggingRuntime, handleWebRequest, {
    assertReady: assertWebRuntimeReady,
    waitForReady: waitForWebReady,
  })
}
```

```tsx
// scripts/release/compiled_web_main.tsx
/** @jsxImportSource preact */

import clientAssetPath from '../../.web-dist/assets/client.js' with { type: 'file' }
import { file } from 'bun'
import { createWebRequestHandler } from '../../web/create_web_request_handler.tsx'
import { handler as readerOverview } from '../../web/routes/api/reader/overview.ts'
import { handler as xqueryEvaluate } from '../../web/routes/api/xquery/evaluate.ts'
import { handler as syndicationEvaluate } from '../../web/routes/api/syndication/evaluate.ts'
import { handler as configGlobal } from '../../web/routes/api/config/global.ts'
import { handler as configDeliveries } from '../../web/routes/api/config/deliveries.ts'
import { handler as configDeliveriesDelete } from '../../web/routes/api/config/deliveries_delete.ts'
import { handler as sourcesUpdate } from '../../web/routes/api/sources/update.ts'
import { handler as sourcesRun } from '../../web/routes/api/sources/run.ts'
import { handler as sourcesClear } from '../../web/routes/api/sources/clear.ts'

async function serveEmbeddedClientAsset(): Promise<Response> {
  return new Response(file(clientAssetPath), {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  })
}

export const handleCompiledWebRequest = createWebRequestHandler({
  serveClientAsset: serveEmbeddedClientAsset,
  apiHandlers: {
    readerOverview,
    xqueryEvaluate,
    syndicationEvaluate,
    configGlobal,
    configDeliveries,
    configDeliveriesDelete,
    sourcesUpdate,
    sourcesRun,
    sourcesClear,
  },
})
```

```ts
// scripts/release/start_compiled_web.ts
import { handleCompiledWebRequest } from './compiled_web_main.tsx'
import {
  assertWebRuntimeReady,
  loadStartWebLoggingRuntime,
  waitForWebReady,
} from '../../src/interfaces/web/start_web.ts'
import {
  runReadyCheckedWebServer,
  type StartWebOptions,
} from '../../src/interfaces/web/web_startup_runtime.ts'

export async function startCompiledWeb(
  options: StartWebOptions,
): Promise<void> {
  const loggingRuntime = await loadStartWebLoggingRuntime()
  await runReadyCheckedWebServer(
    options,
    loggingRuntime,
    handleCompiledWebRequest,
    {
      assertReady: assertWebRuntimeReady,
      waitForReady: waitForWebReady,
    },
  )
}
```

```ts
// scripts/release/compiled_main.ts
import { parseCliCommand } from '../../src/interfaces/cli/parse_cli_command.ts'
import { dispatchStartupCommand } from '../../src/interfaces/startup/startup_orchestrator.ts'
import { startCompiledWeb } from './start_compiled_web.ts'

export async function compiledMain(args: string[]): Promise<void> {
  await dispatchStartupCommand(parseCliCommand(args), {
    startWeb: startCompiledWeb,
  })
}
```

```ts
// scripts/release/compiled_container_main.ts
import { runContainerEntrypoint } from '../../src/container_entrypoint.ts'
import { compiledMain } from './compiled_main.ts'

await runContainerEntrypoint(undefined, {
  main: compiledMain,
})
```

```ts
// scripts/release/build_binary.ts
await Bun.$`mkdir -p dist`
const buildWeb = Bun.spawn(['bun', 'run', 'build:web'], {
  stdio: ['inherit', 'inherit', 'inherit'],
})
if ((await buildWeb.exited) !== 0) throw new Error('build:web failed')

await Bun.$`rm -f dist/knock-linux-x64`
const compile = Bun.spawn(
  [
    'bun',
    'build',
    './scripts/release/compiled_container_main.ts',
    '--compile',
    '--target=bun-linux-x64',
    '--minify',
    '--bytecode',
    '--outfile',
    './dist/knock-linux-x64',
  ],
  { stdio: ['inherit', 'inherit', 'inherit'] },
)
if ((await compile.exited) !== 0) throw new Error('binary compile failed')
```

```bash
# scripts/release/smoke_binary.sh
#!/usr/bin/env bash
set -euo pipefail

binary="${1:-./dist/knock-linux-x64}"
workdir="$(mktemp -d)"
port="18080"
web_pid=""
all_pid=""
trap '
  if [ -n "$web_pid" ]; then kill "$web_pid" >/dev/null 2>&1 || true; wait "$web_pid" || true; fi
  if [ -n "$all_pid" ]; then kill "$all_pid" >/dev/null 2>&1 || true; wait "$all_pid" || true; fi
  rm -rf "$workdir" /tmp/knock-client.js
' EXIT

cat >"$workdir/config.yml" <<'EOF'
sources: {}
EOF

"$binary" --mode daemon --runtime_dir "$workdir" --immediate
KNOCK_RUNTIME_DIR="$workdir" "$binary" --mode web --web_host 127.0.0.1 --web_port "$port" >/tmp/knock-web.log 2>&1 &
web_pid="$!"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/config" | grep -q 'Knock Config'; then
    break
  fi
  sleep 0.25
done
kill "$web_pid" >/dev/null 2>&1 || true
wait "$web_pid" || true
web_pid=""

KNOCK_RUNTIME_DIR="$workdir" "$binary" --mode all --web_host 127.0.0.1 --web_port "$port" >/tmp/knock-all.log 2>&1 &
all_pid="$!"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/config" | grep -q 'Knock Config'; then
    curl -fsS "http://127.0.0.1:${port}/assets/client.js" >/tmp/knock-client.js
    test -s /tmp/knock-client.js
    break
  fi
  sleep 0.25
done
```

```json
// package.json (script additions)
{
  "scripts": {
    "build:binary": "bun run scripts/release/build_binary.ts",
    "smoke:binary": "bash ./scripts/release/smoke_binary.sh"
  }
}
```

- [ ] **Step 4: Re-run the package-script test**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_scripts_test.ts
```

Expected: PASS.

- [ ] **Step 5: Build the binary and run the black-box smoke test**

Run:

```bash
bun run build:binary && bun run smoke:binary
```

Expected: PASS, with `dist/knock-linux-x64` created and the smoke script finishing without output from `curl`/`grep` failures.

- [ ] **Step 6: Run the scoped repo checks for the binary path**

Run:

```bash
bun run check && bun run fmt:check:path -- src/interfaces/cli/release_scripts_test.ts src/interfaces/web/web_startup_runtime.ts src/interfaces/web/start_web.ts scripts/release package.json && bun run lint:check:path -- src/interfaces/cli/release_scripts_test.ts src/interfaces/web/web_startup_runtime.ts src/interfaces/web/start_web.ts scripts/release package.json
```

Expected: PASS.

- [ ] **Step 7: Commit the binary build path**

```bash
git add src/interfaces/cli/release_scripts_test.ts src/interfaces/web/web_startup_runtime.ts src/interfaces/web/start_web.ts scripts/release package.json
git commit -m "feat(release): add compiled binary build and smoke path"
```

Expected: commit succeeds with the compiled binary release path only.

## Task 3: Switch Docker and CI to the compiled binary runtime

**Files:**

- Modify: `src/interfaces/cli/release_scripts_test.ts`
- Modify: `package.json`
- Create: `scripts/release/smoke_image.sh`
- Modify: `Dockerfile`
- Modify: `.github/workflows/docker.yml`
- Test: `src/interfaces/cli/release_scripts_test.ts`

- [ ] **Step 1: Extend the failing script contract for the image smoke path**

```ts
// src/interfaces/cli/release_scripts_test.ts (append)
assertEquals(scripts['smoke:image'], 'bash ./scripts/release/smoke_image.sh')
assertEquals(
  scripts['image:prepare'],
  'bun run docker:build && bun run smoke:image && bun run docker:size:check',
)
assertEquals(
  scripts['release:prepare'],
  'bun run verify:full && bun run build:binary && bun run smoke:binary && bun run image:prepare',
)
```

- [ ] **Step 2: Run the script contract test before wiring the image smoke**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_scripts_test.ts
```

Expected: FAIL because `smoke:image` and the new `image:prepare` shape are not present yet.

- [ ] **Step 3: Add the image smoke script and switch the Docker runtime to the binary**

```bash
# scripts/release/smoke_image.sh
#!/usr/bin/env bash
set -euo pipefail

image="${KNOCK_IMAGE_TAG:-knock:local}"
entrypoint="$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')"
[ "$entrypoint" = '["/app/knock-linux-x64"]' ]

runtime_dir="$(mktemp -d)"
port="18081"
trap 'docker rm -f knock-smoke >/dev/null 2>&1 || true; rm -rf "$runtime_dir"' EXIT
cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF

docker run -d --rm \
  --name knock-smoke \
  -p "${port}:${port}" \
  -v "$runtime_dir:/app/runtime" \
  -e KNOCK_WEB_HOST=0.0.0.0 \
  -e KNOCK_WEB_PORT="$port" \
  "$image" >/dev/null

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${port}/config" | grep -q 'Knock Config'; then
    exit 0
  fi
  sleep 0.25
done

echo "image did not become ready" >&2
exit 1
```

```dockerfile
# Dockerfile (runtime shape only)
FROM --platform=$BUILDPLATFORM oven/bun:1.3.13 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json vite.config.ts ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY web ./web
COPY scripts ./scripts
RUN bun run build:binary

FROM alpine:3.21 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
  && addgroup -S knock \
  && adduser -S -G knock knock \
  && mkdir -p /app/runtime
WORKDIR /app
ENV KNOCK_RUNTIME_DIR=/app/runtime
COPY --from=build /app/dist/knock-linux-x64 /app/knock-linux-x64
RUN chown -R knock:knock /app
USER knock
EXPOSE 8000
ENTRYPOINT ["/app/knock-linux-x64"]
CMD []
```

```yaml
# .github/workflows/docker.yml (relevant step shape)
- name: Verify release pipeline inputs
  run: bun run verify:full

- name: Build compiled binary
  run: bun run build:binary

- name: Smoke compiled binary
  run: bun run smoke:binary

- name: Upload compiled binary artifact
  uses: actions/upload-artifact@v4
  with:
    name: knock-linux-x64
    path: dist/knock-linux-x64
```

```json
// package.json (script updates)
{
  "scripts": {
    "smoke:image": "bash ./scripts/release/smoke_image.sh",
    "image:prepare": "bun run docker:build && bun run smoke:image && bun run docker:size:check",
    "release:prepare": "bun run verify:full && bun run build:binary && bun run smoke:binary && bun run image:prepare"
  }
}
```

- [ ] **Step 4: Re-run the script contract test**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_scripts_test.ts
```

Expected: PASS.

- [ ] **Step 5: Build and smoke the new image**

Run:

```bash
bun run image:prepare
```

Expected: PASS, with the image entrypoint equal to `/app/knock-linux-x64` and `/config` returning the ready page.

- [ ] **Step 6: Commit the binary-backed image switch**

```bash
git add src/interfaces/cli/release_scripts_test.ts package.json scripts/release/smoke_image.sh Dockerfile .github/workflows/docker.yml
git commit -m "refactor(docker): run compiled binary in release image"
```

Expected: commit succeeds with only the image/runtime release changes.

## Task 4: Document the new release flow and add the cold-start guardrail

**Files:**

- Modify: `src/interfaces/cli/release_scripts_test.ts`
- Modify: `package.json`
- Create: `scripts/release/measure_cold_start.sh`
- Modify: `README.md`
- Modify: `docker/README.md`
- Test: `src/interfaces/cli/release_scripts_test.ts`

- [ ] **Step 1: Extend the failing script contract for the cold-start measurement entrypoint**

```ts
// src/interfaces/cli/release_scripts_test.ts (append)
assertEquals(
  scripts['measure:cold-start'],
  'bash ./scripts/release/measure_cold_start.sh',
)
```

- [ ] **Step 2: Run the script contract test before adding the measurement script**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_scripts_test.ts
```

Expected: FAIL because `measure:cold-start` does not exist yet.

- [ ] **Step 3: Add the measurement script and update the docs**

```bash
# scripts/release/measure_cold_start.sh
#!/usr/bin/env bash
set -euo pipefail

baseline_image="${BASE_IMAGE:?BASE_IMAGE is required}"
candidate_image="${CANDIDATE_IMAGE:?CANDIDATE_IMAGE is required}"
ready_path="${READY_PATH:-/config}"
ready_marker="${READY_MARKER:-Knock Config}"
threshold_pct="${THRESHOLD_PCT:-30}"
samples="${SAMPLES:-3}"

measure_once() {
  local image="$1"
  local runtime_dir port cid started ended
  runtime_dir="$(mktemp -d)"
  port="$(python - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"
  cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
  started="$(python - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  cid="$(docker run -d --rm -p "${port}:${port}" -v "$runtime_dir:/app/runtime" -e KNOCK_WEB_HOST=0.0.0.0 -e KNOCK_WEB_PORT="$port" "$image")"
  trap 'docker rm -f "$cid" >/dev/null 2>&1 || true; rm -rf "$runtime_dir"' RETURN
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${port}${ready_path}" | grep -q "$ready_marker"; then
      ended="$(python - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
      echo $((ended - started))
      return 0
    fi
    sleep 0.25
  done
  return 1
}

measure_series() {
  local image="$1"
  for _ in $(seq 1 "$samples"); do
    measure_once "$image"
  done
}

median_ms() {
  python - <<'PY' "$@"
import sys
values = sorted(int(value) for value in sys.argv[1:])
print(values[len(values) // 2])
PY
}

readarray -t baseline_runs < <(measure_series "$baseline_image")
readarray -t candidate_runs < <(measure_series "$candidate_image")
baseline_ms="$(median_ms "${baseline_runs[@]}")"
candidate_ms="$(median_ms "${candidate_runs[@]}")"
improvement_pct="$(python - <<PY
baseline = int(${baseline_ms})
candidate = int(${candidate_ms})
print(int(((baseline - candidate) / baseline) * 100))
PY
)"

echo "baseline_runs=${baseline_runs[*]}"
echo "candidate_runs=${candidate_runs[*]}"
echo "baseline_median_ms=${baseline_ms}"
echo "candidate_median_ms=${candidate_ms}"
echo "improvement_pct=${improvement_pct}"

if [ "$improvement_pct" -lt "$threshold_pct" ]; then
  echo "cold-start improvement below threshold" >&2
  exit 1
fi
```

````md
<!-- README.md (relevant content shape) -->

### 本地二进制构建

```bash
bun run build:binary
```
````

产物输出到 `dist/knock-linux-x64`。该产物保留现有 CLI 契约，可继续使用 `--mode all|web|daemon`。

### 容器运行

镜像默认入口不再是 `bun src/container_main.ts`，而是编译后的 `/app/knock-linux-x64`。容器仍保留 `KNOCK_CONFIG_PATH`、`KNOCK_WEB_HOST`、`KNOCK_WEB_PORT`、`KNOCK_IMMEDIATE` 的默认参数注入语义。

````

```md
<!-- docker/README.md (relevant content shape) -->
- 默认入口：`/app/knock-linux-x64`
- 运行阶段不再携带 `src/`、`web/`、`node_modules/`、`.web-dist/`
- 发布前门禁固定执行：`bun run verify:full`、`bun run build:binary`、`bun run smoke:binary`、`bun run image:prepare`
````

```json
// package.json (script addition)
{
  "scripts": {
    "measure:cold-start": "bash ./scripts/release/measure_cold_start.sh"
  }
}
```

- [ ] **Step 4: Re-run the script contract and documentation consistency checks**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_scripts_test.ts && rg -n "build:binary|smoke:binary|smoke:image|measure:cold-start|knock-linux-x64|/app/knock-linux-x64" README.md docker/README.md package.json Dockerfile .github/workflows/docker.yml
```

Expected: PASS, with all release entrypoints and the new binary path visible in the expected files.

- [ ] **Step 5: Run the final repo verification and the image/binary smokes**

Run:

```bash
bun run verify:full && bun run test && bun run build:binary && bun run smoke:binary && bun run image:prepare
```

Expected: PASS.

- [ ] **Step 6: Build a baseline image from `main` and run the cold-start comparison**

Run:

```bash
git worktree add /tmp/knock-main main
bash -lc 'cd /tmp/knock-main && bun install --frozen-lockfile && KNOCK_IMAGE_TAG=knock:baseline bun run docker:build'
KNOCK_IMAGE_TAG=knock:local bun run docker:build
BASE_IMAGE=knock:baseline CANDIDATE_IMAGE=knock:local bun run measure:cold-start
```

Expected: output includes `baseline_median_ms=...`, `candidate_median_ms=...`, `improvement_pct=...`, and exits 0 only when improvement is at least 30.

- [ ] **Step 7: Commit the docs and cold-start guardrail**

```bash
git add src/interfaces/cli/release_scripts_test.ts package.json scripts/release/measure_cold_start.sh README.md docker/README.md
git commit -m "docs(release): document binary delivery and cold-start guardrail"
```

Expected: commit succeeds with docs + measurement guardrail only.

## Spec coverage check

- **Linux x64 single-file binary:** Task 2 adds the compiled entry, build script, and smoke path.
- **Binary-backed Docker image:** Task 3 switches the runtime image to the compiled binary and adds image smoke.
- **CLI `--mode all|web|daemon` stability:** Task 2 reuses `runContainerEntrypoint()` and `dispatchStartupCommand()` instead of inventing a new startup model.
- **Remove production dependence on runtime `build:web`:** Task 2 moves binary creation to an explicit build step; Task 3 moves the image to the binary runtime.
- **Remove production dependence on `.web-dist` sidecar and request-time dynamic imports:** Task 2 introduces `compiled_web_main.tsx` with static imports and an embedded client asset.
- **30% image / cold-start goal:** Task 3 preserves image size checking; Task 4 adds a cold-start comparison script and final threshold gate.
- **Docs + release flow visibility:** Task 4 updates `README.md` and `docker/README.md`.

## Placeholder scan

- No `TODO` / `TBD` markers remain.
- Every task includes exact file paths, commands, and expected outcomes.
- Every code step includes the concrete module/script shape to write.

## Type consistency check

- Runtime binary path is consistently `dist/knock-linux-x64` in package scripts, Dockerfile, smoke scripts, and docs.
- Docker entrypoint is consistently `/app/knock-linux-x64` in scripts, Dockerfile, and docs.
- Script names are consistently `build:binary`, `smoke:binary`, `smoke:image`, and `measure:cold-start`.
- The compiled path consistently reuses `runContainerEntrypoint()` + `dispatchStartupCommand()` rather than inventing a second CLI contract.
