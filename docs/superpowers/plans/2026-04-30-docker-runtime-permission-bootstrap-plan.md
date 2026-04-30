# Docker Runtime Permission Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Docker image self-heal `/app/runtime` bind-mount permissions at startup so restrictive or root-owned host runtime directories still boot without manual `chmod` / `chown` / `--user`.

**Architecture:** Introduce a root bootstrap shell entrypoint that repairs `/app/runtime`, aligns the runtime identity with the mount owner when possible, and then execs the compiled binary. Keep CLI/default-argument normalization in the existing TypeScript container entrypoint so only filesystem/bootstrap concerns live in the shell layer.

**Tech Stack:** POSIX shell, Debian bookworm-slim, `gosu`, Bun-compiled binary, Bun test, Docker

---

## File Structure

### New files

- Create: `src/interfaces/cli/docker_runtime_bootstrap_test.ts`
  - Contract tests for the source-friendly Docker shell entrypoint helpers and runtime identity decisions.

### Modified files

- Modify: `docker/entrypoint.sh`
  - Replace the current Bun-start wrapper with a source-friendly runtime bootstrap entrypoint that can be tested and can repair `/app/runtime` before execing the compiled binary.
- Modify: `Dockerfile`
  - Install `gosu`, copy the shell entrypoint into the image, drop the fixed `USER knock` runtime, and switch the image `ENTRYPOINT` to the shell wrapper.
- Modify: `scripts/release/smoke_image.sh`
  - Assert the shell entrypoint is present and verify image startup from a deliberately restrictive runtime fixture.
- Modify: `scripts/release/measure_cold_start.sh`
  - Align the cold-start runtime fixture with the self-healing path instead of pre-opening permissions to `777/666`.
- Modify: `src/interfaces/cli/release_runtime_permissions_test.ts`
  - Replace the old “chmod 777/666” contract with the new restrictive runtime fixture contract for both release scripts.
- Modify: `docker/README.md`
  - Document that the default image entrypoint self-heals `/app/runtime` permissions and demote explicit `--user` to an advanced override.

### Existing files that should stay stable

- Keep: `src/container_entrypoint.ts`
  - Still owns raw-argv normalization and raw-command passthrough.
- Keep: `src/container_entrypoint_defaults.ts`
  - Still owns `KNOCK_CONFIG_PATH` / `KNOCK_WEB_HOST` / `KNOCK_WEB_PORT` / `KNOCK_IMMEDIATE` default injection semantics.
- Keep: `package.json`
  - Release script entrypoints stay the same; only their internal behavior changes.

## Task 1: Make the Docker shell entrypoint source-friendly and testable

**Files:**

- Create: `src/interfaces/cli/docker_runtime_bootstrap_test.ts`
- Modify: `docker/entrypoint.sh`
- Test: `src/interfaces/cli/docker_runtime_bootstrap_test.ts`

- [ ] **Step 1: Write the failing contract test for the shell bootstrap seam**

```ts
// src/interfaces/cli/docker_runtime_bootstrap_test.ts
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { assertEquals, assertStringIncludes } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'

const scriptUrl = new URL('../../../docker/entrypoint.sh', import.meta.url)
const scriptPath = scriptUrl.pathname

function runShellHelper(snippet: string) {
  return spawnSync(
    'sh',
    ['-lc', `. ${JSON.stringify(scriptPath)}; ${snippet}`],
    {
      encoding: 'utf8',
    },
  )
}

test('[contract] docker entrypoint: source-friendly main guard', () => {
  const text = readFileSync(scriptUrl, 'utf8')
  assertStringIncludes(text, 'main() {')
  assertStringIncludes(
    text,
    'if [ "${0##*/}" = "entrypoint.sh" ] || [ "${0##*/}" = "docker-entrypoint.sh" ]; then',
  )
})

test('[contract] docker entrypoint: runtime owner should become target uid/gid', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-docker-entrypoint-'))

  try {
    const uid = String(process.getuid?.() ?? 0)
    const gid = String(process.getgid?.() ?? 0)
    const owner = runShellHelper(
      `read_runtime_owner ${JSON.stringify(runtimeDir)}`,
    )
    assertEquals(owner.status, 0)
    assertEquals(owner.stdout.trim(), `${uid}:${gid}`)

    const resolved = runShellHelper(
      `resolve_target_identity 10001 10001 ${uid} ${gid}`,
    )
    assertEquals(resolved.status, 0)
    assertEquals(resolved.stdout.trim(), `${uid}:${gid} keep-root=0`)
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true })
  }
})

test('[contract] docker entrypoint: root-owned runtime should keep root', () => {
  const result = runShellHelper('resolve_target_identity 10001 10001 0 0')
  assertEquals(result.status, 0)
  assertEquals(result.stdout.trim(), '0:0 keep-root=1')
})
```

- [ ] **Step 2: Run the new contract test and verify it fails before the shell refactor**

Run:

```bash
bun run test:path -- src/interfaces/cli/docker_runtime_bootstrap_test.ts
```

Expected: FAIL because `docker/entrypoint.sh` currently auto-executes on source and does not expose `read_runtime_owner`, `resolve_target_identity`, or a source-friendly `main()` guard.

- [ ] **Step 3: Refactor `docker/entrypoint.sh` into a runtime bootstrap entrypoint with explicit helper functions**

```sh
#!/bin/sh
set -eu

APP_BIN="${APP_BIN:-/app/knock-linux-x64}"
RUNTIME_DIR="${KNOCK_RUNTIME_DIR:-/app/runtime}"
DEFAULT_UID="${APP_UID:-10001}"
DEFAULT_GID="${APP_GID:-10001}"

read_runtime_owner() {
  runtime_dir="$1"
  stat -c '%u:%g' "$runtime_dir"
}

resolve_target_identity() {
  default_uid="$1"
  default_gid="$2"
  runtime_uid="${3:-}"
  runtime_gid="${4:-}"

  target_uid="$default_uid"
  target_gid="$default_gid"
  keep_root=0

  if [ -n "$runtime_uid" ] && [ -n "$runtime_gid" ]; then
    target_uid="$runtime_uid"
    target_gid="$runtime_gid"
  fi

  if [ "$target_uid" = "0" ] || [ "$target_gid" = "0" ]; then
    keep_root=1
  fi

  printf '%s:%s keep-root=%s\n' "$target_uid" "$target_gid" "$keep_root"
}

fix_runtime_permissions() {
  runtime_dir="$1"
  target_uid="$2"
  target_gid="$3"

  for path in \
    "$runtime_dir" \
    "$runtime_dir/config.yml" \
    "$runtime_dir/config.yaml" \
    "$runtime_dir/outputs" \
    "$runtime_dir/logs" \
    "$runtime_dir/db.sqlite" \
    "$runtime_dir/knock.db"
  do
    if [ -e "$path" ]; then
      chown -R "${target_uid}:${target_gid}" "$path" 2>/dev/null || true
      chmod -R u+rwX "$path" 2>/dev/null || true
      chmod -R g+rwX "$path" 2>/dev/null || true
    fi
  done
}

exec_app() {
  target_uid="$1"
  target_gid="$2"
  shift 2

  if [ "$(id -u)" -eq 0 ] && [ "$target_uid" != "0" ] && [ "$target_gid" != "0" ]; then
    exec gosu "${target_uid}:${target_gid}" "$APP_BIN" "$@"
  fi

  exec "$APP_BIN" "$@"
}

main() {
  runtime_uid=''
  runtime_gid=''

  if [ -d "$RUNTIME_DIR" ]; then
    owner="$(read_runtime_owner "$RUNTIME_DIR" 2>/dev/null || true)"
    if [ -n "$owner" ]; then
      runtime_uid="${owner%%:*}"
      runtime_gid="${owner##*:}"
    fi
  fi

  identity="$(resolve_target_identity "$DEFAULT_UID" "$DEFAULT_GID" "$runtime_uid" "$runtime_gid")"
  target_uid="${identity%%:*}"
  rest="${identity#*:}"
  target_gid="${rest%% *}"

  if [ "$(id -u)" -eq 0 ] && [ -d "$RUNTIME_DIR" ]; then
    fix_runtime_permissions "$RUNTIME_DIR" "$target_uid" "$target_gid"
  fi

  exec_app "$target_uid" "$target_gid" "$@"
}

if [ "${0##*/}" = "entrypoint.sh" ] || [ "${0##*/}" = "docker-entrypoint.sh" ]; then
  main "$@"
fi
```

- [ ] **Step 4: Run the contract test again and verify it passes**

Run:

```bash
bun run test:path -- src/interfaces/cli/docker_runtime_bootstrap_test.ts
```

Expected: PASS with `3 pass`, confirming the helper seam and root-vs-drop decision logic exist before the Dockerfile wiring happens.

- [ ] **Step 5: Commit the seam-creation refactor**

```bash
git add docker/entrypoint.sh src/interfaces/cli/docker_runtime_bootstrap_test.ts
git commit -m "test(docker): add runtime bootstrap entrypoint seam"
```

## Task 2: Convert release scripts to prove the self-healing path instead of pre-opening permissions

**Files:**

- Modify: `scripts/release/smoke_image.sh`
- Modify: `scripts/release/measure_cold_start.sh`
- Modify: `src/interfaces/cli/release_runtime_permissions_test.ts`
- Test: `src/interfaces/cli/release_runtime_permissions_test.ts`

- [ ] **Step 1: Replace the old `777/666` contract with restrictive runtime-fixture tests**

```ts
// src/interfaces/cli/release_runtime_permissions_test.ts
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from '../../testing/assert.ts'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '../../testing/test_api.ts'

function runPreparedFixture(scriptPath: string, runtimeDir: string): string {
  const configPath = join(runtimeDir, 'config.yml')
  return spawnSync(
    'bash',
    [
      '-lc',
      `source ${JSON.stringify(scriptPath)}; prepare_runtime_fixture ${JSON.stringify(runtimeDir)}; echo "$(stat -c '%a' ${JSON.stringify(runtimeDir)}) $(stat -c '%a' ${JSON.stringify(configPath)})"`,
    ],
    { encoding: 'utf8' },
  ).stdout.trim()
}

test('[contract] smoke image script: prepare_runtime_fixture should keep a restrictive runtime fixture', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-fixture-'))
  const configPath = join(runtimeDir, 'config.yml')
  writeFileSync(configPath, 'sources: {}\n')
  chmodSync(runtimeDir, 0o755)
  chmodSync(configPath, 0o644)

  try {
    const scriptPath = new URL(
      '../../../scripts/release/smoke_image.sh',
      import.meta.url,
    ).pathname
    assertEquals(runPreparedFixture(scriptPath, runtimeDir), '700 644')
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true })
  }
})

test('[contract] measure cold start script: prepare_runtime_fixture should keep a restrictive runtime fixture', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-fixture-'))
  const configPath = join(runtimeDir, 'config.yml')
  writeFileSync(configPath, 'sources: {}\n')
  chmodSync(runtimeDir, 0o755)
  chmodSync(configPath, 0o644)

  try {
    const scriptPath = new URL(
      '../../../scripts/release/measure_cold_start.sh',
      import.meta.url,
    ).pathname
    assertEquals(runPreparedFixture(scriptPath, runtimeDir), '700 644')
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true })
  }
})

test('[contract] smoke image script: should verify the shell entrypoint contract', () => {
  const text = readFileSync(
    new URL('../../../scripts/release/smoke_image.sh', import.meta.url),
    'utf8',
  )
  assertStringIncludes(
    text,
    `[ "$entrypoint" = '["/app/docker-entrypoint.sh"]' ]`,
  )
})
```

- [ ] **Step 2: Run the release-script contract test and verify it fails on the old helper behavior**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts
```

Expected: FAIL because both release scripts still prepare `777/666` fixtures and `smoke_image.sh` still expects `['/app/knock-linux-x64']` as the image entrypoint.

- [ ] **Step 3: Update both release scripts to create a restrictive fixture and assert the shell entrypoint**

```bash
# scripts/release/smoke_image.sh
prepare_runtime_fixture() {
  local runtime_dir
  runtime_dir="$1"

  chmod 0700 "$runtime_dir"
  chmod 0644 "$runtime_dir/config.yml"
}

assert_runtime_fixture() {
  local runtime_dir config_path dir_mode config_mode
  runtime_dir="$1"
  config_path="$runtime_dir/config.yml"

  if [ ! -d "$runtime_dir" ]; then
    echo 'runtime fixture check failed: runtime_dir must exist and be a directory' >&2
    return 1
  fi

  if [ ! -f "$config_path" ]; then
    echo 'runtime fixture check failed: config.yml must exist and be a regular file' >&2
    return 1
  fi

  dir_mode="$(stat -c '%a' "$runtime_dir")"
  if [ "$dir_mode" != '700' ]; then
    echo "runtime fixture check failed: expected runtime_dir mode 700, got $dir_mode" >&2
    return 1
  fi

  config_mode="$(stat -c '%a' "$config_path")"
  if [ "$config_mode" != '644' ]; then
    echo "runtime fixture check failed: expected config.yml mode 644, got $config_mode" >&2
    return 1
  fi
}

entrypoint="$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')"
[ "$entrypoint" = '["/app/docker-entrypoint.sh"]' ]

cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
prepare_runtime_fixture "$runtime_dir"
assert_runtime_fixture "$runtime_dir"
```

```bash
# scripts/release/measure_cold_start.sh
prepare_runtime_fixture() {
  local runtime_dir
  runtime_dir="$1"

  chmod 0700 "$runtime_dir"
  chmod 0644 "$runtime_dir/config.yml"
}

assert_runtime_fixture() {
  local runtime_dir config_path dir_mode config_mode
  runtime_dir="$1"
  config_path="$runtime_dir/config.yml"

  if [ ! -d "$runtime_dir" ]; then
    echo 'runtime fixture check failed: runtime_dir must exist and be a directory' >&2
    return 1
  fi

  if [ ! -f "$config_path" ]; then
    echo 'runtime fixture check failed: config.yml must exist and be a regular file' >&2
    return 1
  fi

  dir_mode="$(stat -c '%a' "$runtime_dir")"
  if [ "$dir_mode" != '700' ]; then
    echo "runtime fixture check failed: expected runtime_dir mode 700, got $dir_mode" >&2
    return 1
  fi

  config_mode="$(stat -c '%a' "$config_path")"
  if [ "$config_mode" != '644' ]; then
    echo "runtime fixture check failed: expected config.yml mode 644, got $config_mode" >&2
    return 1
  fi
}

cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
prepare_runtime_fixture "$runtime_dir"
assert_runtime_fixture "$runtime_dir"
```

- [ ] **Step 4: Run the updated release-script contract test and verify it passes**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts
```

Expected: PASS with the restrictive `700/644` fixture contract and the new shell-entrypoint assertion locked in.

- [ ] **Step 5: Commit the release-script fixture shift**

```bash
git add scripts/release/smoke_image.sh scripts/release/measure_cold_start.sh src/interfaces/cli/release_runtime_permissions_test.ts
git commit -m "test(release): verify restrictive runtime fixture path"
```

## Task 3: Wire the image to the runtime bootstrap entrypoint and prove the real Docker path

**Files:**

- Modify: `Dockerfile`
- Modify: `docker/entrypoint.sh`
- Test: `scripts/release/smoke_image.sh`
- Test: `src/container_entrypoint_test.ts`

- [ ] **Step 1: Run the real image smoke against the restrictive fixture and verify it still fails before Dockerfile wiring**

Run:

```bash
bun run docker:build && bun run smoke:image
```

Expected: FAIL because the image still uses `ENTRYPOINT ["/app/knock-linux-x64"]` and fixed `USER knock`, so the restrictive `700/644` fixture cannot self-heal yet.

- [ ] **Step 2: Update the runtime image to install `gosu`, copy the shell wrapper, drop `USER knock`, and switch the image entrypoint**

```Dockerfile
# Dockerfile (runtime stage)
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system knock \
  && useradd --system --gid knock --home-dir /app --shell /usr/sbin/nologin knock \
  && mkdir -p /app/runtime

WORKDIR /app

ENV KNOCK_RUNTIME_DIR=/app/runtime

COPY --from=build /app/dist/knock-linux-x64 /app/knock-linux-x64
COPY --from=build /app/node_modules/jsdom /app/node_modules/jsdom
COPY --from=build /app/node_modules/css-tree /app/node_modules/css-tree
COPY --from=build /app/node_modules/mdn-data /app/node_modules/mdn-data
COPY docker/entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && chown -R knock:knock /app

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD []
```

- [ ] **Step 3: Rebuild the image and rerun the restrictive smoke to verify the bootstrap path now succeeds**

Run:

```bash
bun run docker:build && bun run smoke:image
```

Expected: PASS. `smoke_image.sh` should accept the shell entrypoint contract and the container should become ready even though the mounted runtime fixture starts restrictive.

- [ ] **Step 4: Run one direct Docker proof that the container can read a restrictive bind mount without manual `--user`**

Run:

```bash
runtime_dir="/root/git/knock/.tmp/docker-runtime-proof"
rm -rf "$runtime_dir"
mkdir -p "$runtime_dir"
printf 'sources: {}\n' > "$runtime_dir/config.yml"
chmod 700 "$runtime_dir"
chmod 644 "$runtime_dir/config.yml"
docker run --rm -v "$runtime_dir:/app/runtime" knock:local sh -lc 'test -r /app/runtime/config.yml && echo runtime-ok'
rm -rf "$runtime_dir"
```

Expected: `runtime-ok` on stdout and exit code 0, proving the startup path repaired permissions enough for the raw command path to read the config mount.

- [ ] **Step 5: Commit the runtime image wiring**

```bash
git add Dockerfile docker/entrypoint.sh scripts/release/smoke_image.sh
git commit -m "feat(docker): self-heal runtime bind mount permissions"
```

## Task 4: Update Docker docs and run the full verification stack

**Files:**

- Modify: `docker/README.md`
- Test: `docker/README.md`
- Test: `src/interfaces/cli/docker_runtime_bootstrap_test.ts`
- Test: `src/interfaces/cli/release_runtime_permissions_test.ts`
- Test: `src/container_entrypoint_test.ts`

- [ ] **Step 1: Replace the primary `--user` guidance in `docker/README.md` with startup self-heal docs**

````md
## 一次性执行 daemon

```bash
docker run --rm \
  -v "$(pwd)/runtime:/app/runtime" \
  -e KNOCK_IMMEDIATE=true \
  <image>
```

## 启动常驻模式并暴露 Web

```bash
docker run -d \
  --name knock \
  -p 8000:8000 \
  -v "$(pwd)/runtime:/app/runtime" \
  -e KNOCK_WEB_HOST=0.0.0.0 \
  -e KNOCK_WEB_PORT=8000 \
  <image>
```

默认入口会在启动期检查并修复 `/app/runtime` bind mount 的 owner / mode；多数 Linux bind mount 场景下，不再需要额外传 `--user`。若你明确想覆盖最终运行身份，仍可把 `--user` 当作高级选项手动指定。
````

- [ ] **Step 2: Run a docs consistency check and verify the old “must pass --user” guidance is gone**

Run:

```bash
rg -n '启动期检查并修复 `/app/runtime`|高级选项手动指定|--user' docker/README.md
```

Expected: the new self-heal paragraph is present, and `--user` only appears as an optional advanced override instead of in the main example commands.

- [ ] **Step 3: Run the full verification stack for the Docker entrypoint change**

Run:

```bash
bun run test:path -- src/interfaces/cli/docker_runtime_bootstrap_test.ts src/interfaces/cli/release_runtime_permissions_test.ts src/container_entrypoint_test.ts && bun run fmt:check:path -- Dockerfile docker/entrypoint.sh scripts/release/smoke_image.sh scripts/release/measure_cold_start.sh src/interfaces/cli/docker_runtime_bootstrap_test.ts src/interfaces/cli/release_runtime_permissions_test.ts docker/README.md && bun run lint:check:path -- src/interfaces/cli/docker_runtime_bootstrap_test.ts src/interfaces/cli/release_runtime_permissions_test.ts src/container_entrypoint_test.ts && bun run check && bun run test && bun run docker:build && bun run smoke:image
```

Expected: all commands exit 0; the scoped tests pass first, `bun run test` ends with `0 fail`, and the rebuilt image passes `smoke:image` with the restrictive runtime fixture.

- [ ] **Step 4: Commit the docs and verified final state**

```bash
git add docker/README.md Dockerfile docker/entrypoint.sh scripts/release/smoke_image.sh scripts/release/measure_cold_start.sh src/interfaces/cli/docker_runtime_bootstrap_test.ts src/interfaces/cli/release_runtime_permissions_test.ts
git commit -m "docs(docker): document runtime permission self-healing"
```
