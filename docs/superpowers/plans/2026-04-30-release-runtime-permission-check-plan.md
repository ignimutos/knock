# Release Runtime Permission Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the release smoke and cold-start scripts prepare `/app/runtime` permissions explicitly and fail fast on permission drift before `docker run`.

**Architecture:** Keep Bash as the execution surface, but first make the two release scripts sourceable so contract tests can call script-local permission helpers directly. Then add `prepare_runtime_permissions()` and `assert_runtime_permissions()` in each script, and call them at the exact points where the temporary runtime directory is created and immediately before container startup.

**Tech Stack:** Bash, Bun, TypeScript, Node `child_process`, Node `fs`

---

## File Structure

### New files

- Create: `src/interfaces/cli/release_runtime_permissions_test.ts`
  - Contract tests for source-friendly release scripts and their runtime-permission helpers.

### Modified files

- Modify: `scripts/release/smoke_image.sh`
  - Wrap the script in `main()`, add a direct-execution guard, add `prepare_runtime_permissions()` and `assert_runtime_permissions()`, and invoke them before `docker run`.
- Modify: `scripts/release/measure_cold_start.sh`
  - Apply the same source-friendly structure and runtime-permission helper flow inside `measure_once()`.

### Intentional non-goals inside the implementation

- Do not modify application runtime code under `src/interfaces/web/**` or container runtime code under `src/container_entrypoint.ts`.
- Do not introduce a shared shell helper file.
- Do not change Docker image user, config shape, or release script entrypoints in `package.json`.

## Task 1: Make the release scripts sourceable for tests

**Files:**

- Create: `src/interfaces/cli/release_runtime_permissions_test.ts`
- Modify: `scripts/release/smoke_image.sh`
- Modify: `scripts/release/measure_cold_start.sh`
- Test: `src/interfaces/cli/release_runtime_permissions_test.ts`

- [ ] **Step 1: Write the failing seam-creation contract test**

```ts
// src/interfaces/cli/release_runtime_permissions_test.ts
import { readFileSync } from 'node:fs'
import { assertStringIncludes } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'

function readReleaseScript(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('[contract] release runtime scripts: 应暴露 source-friendly main guard', () => {
  for (const [name, scriptPath] of [
    ['smoke_image.sh', '../../../scripts/release/smoke_image.sh'],
    ['measure_cold_start.sh', '../../../scripts/release/measure_cold_start.sh'],
  ] as const) {
    const text = readReleaseScript(scriptPath)
    assertStringIncludes(text, 'main() {', `${name} must declare main()`)
    assertStringIncludes(
      text,
      'if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then',
      `${name} must not auto-execute when sourced`,
    )
  }
})
```

- [ ] **Step 2: Run the new contract test and verify it fails for the missing guard**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts
```

Expected: FAIL because neither script currently contains `main()` plus the `BASH_SOURCE` direct-execution guard.

- [ ] **Step 3: Refactor both release scripts into source-friendly `main()` wrappers**

```bash
# scripts/release/smoke_image.sh
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf "$runtime_dir" "$client_tmp"
}

main() {
  image="${KNOCK_IMAGE_TAG:-knock:local}"
  entrypoint="$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')"
  [ "$entrypoint" = '["/app/knock-linux-x64"]' ]

  runtime_dir="$(mktemp -d)"
  container_name="knock-smoke-$(date +%s)-$RANDOM"
  client_tmp="$(mktemp)"
  port="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"

  trap cleanup EXIT

  cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
  chmod 0777 "$runtime_dir"
  chmod 0666 "$runtime_dir/config.yml"

  docker run -d --rm \
    --name "$container_name" \
    -p "${port}:${port}" \
    -v "$runtime_dir:/app/runtime" \
    -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
    -e KNOCK_WEB_HOST=0.0.0.0 \
    -e KNOCK_WEB_PORT="$port" \
    "$image" >/dev/null

  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${port}/config" | grep -q 'Knock Config'; then
      curl -fsS "http://127.0.0.1:${port}/assets/client.js" >"$client_tmp"
      test -s "$client_tmp"
      exit 0
    fi
    sleep 0.25
  done

  echo "image did not become ready" >&2
  exit 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
```

```bash
# scripts/release/measure_cold_start.sh
#!/usr/bin/env bash
set -euo pipefail

measure_once() {
  local image="$1"
  local runtime_dir=""
  local container_name=""
  local port started ended
  cleanup_measure_once() {
    if [ -n "${container_name:-}" ]; then
      docker rm -f "$container_name" >/dev/null 2>&1 || true
    fi
    if [ -n "${runtime_dir:-}" ]; then
      rm -rf "$runtime_dir"
    fi
  }

  trap cleanup_measure_once RETURN
  runtime_dir="$(mktemp -d)"
  container_name="knock-measure-$(date +%s)-$RANDOM"
  port="$(python3 - <<'PY'
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
  chmod 0777 "$runtime_dir"
  chmod 0666 "$runtime_dir/config.yml"

  started="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

  docker run -d --rm \
    --name "$container_name" \
    -p "${port}:${port}" \
    -v "$runtime_dir:/app/runtime" \
    -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
    -e KNOCK_WEB_HOST=0.0.0.0 \
    -e KNOCK_WEB_PORT="$port" \
    "$image" >/dev/null

  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${port}${ready_path}" | grep -q "$ready_marker"; then
      ended="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
      cleanup_measure_once
      container_name=""
      runtime_dir=""
      echo $((ended - started))
      return 0
    fi
    sleep 0.25
  done

  docker logs "$container_name" || true
  cleanup_measure_once
  container_name=""
  runtime_dir=""
  return 1
}

measure_series() {
  local image="$1"
  for _ in $(seq 1 "$samples"); do
    measure_once "$image"
  done
}

median_ms() {
  python3 - <<'PY' "$@"
import sys
values = sorted(int(value) for value in sys.argv[1:])
print(values[len(values) // 2])
PY
}

main() {
  baseline_image="${BASE_IMAGE:?BASE_IMAGE is required}"
  candidate_image="${CANDIDATE_IMAGE:?CANDIDATE_IMAGE is required}"
  ready_path="${READY_PATH:-/config}"
  ready_marker="${READY_MARKER:-Knock Config}"
  threshold_pct="${THRESHOLD_PCT:-30}"
  samples="${SAMPLES:-3}"

  if [ -z "$ready_path" ]; then
    echo "READY_PATH must not be empty" >&2
    exit 1
  fi

  if ! [[ "$samples" =~ ^[1-9][0-9]*$ ]]; then
    echo "SAMPLES must be a positive integer" >&2
    exit 1
  fi

  if ! [[ "$threshold_pct" =~ ^[0-9]+$ ]]; then
    echo "THRESHOLD_PCT must be an integer" >&2
    exit 1
  fi

  readarray -t baseline_runs < <(measure_series "$baseline_image")
  readarray -t candidate_runs < <(measure_series "$candidate_image")

  baseline_ms="$(median_ms "${baseline_runs[@]}")"
  candidate_ms="$(median_ms "${candidate_runs[@]}")"
  improvement_pct="$(python3 - <<PY
baseline = int(${baseline_ms})
candidate = int(${candidate_ms})
if baseline <= 0:
    raise SystemExit('baseline median must be positive')
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
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
```

- [ ] **Step 4: Re-run the seam-creation test and verify it passes**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts
```

Expected: PASS with the source-friendly guard now present in both scripts.

- [ ] **Step 5: Commit the seam refactor**

```bash
git add src/interfaces/cli/release_runtime_permissions_test.ts scripts/release/smoke_image.sh scripts/release/measure_cold_start.sh
git commit -m "refactor(release): make runtime scripts sourceable"
```

## Task 2: Add runtime permission preparation and preflight checks to `smoke_image.sh`

**Files:**

- Modify: `src/interfaces/cli/release_runtime_permissions_test.ts`
- Modify: `scripts/release/smoke_image.sh`
- Test: `src/interfaces/cli/release_runtime_permissions_test.ts`

- [ ] **Step 1: Extend the test file with failing `smoke_image.sh` helper behavior tests**

```ts
// append to src/interfaces/cli/release_runtime_permissions_test.ts
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertEquals } from '../../testing/assert.ts'

function runBash(program: string): {
  status: number
  stdout: string
  stderr: string
} {
  const result = spawnSync('bash', ['-lc', program], {
    cwd: new URL('../../../', import.meta.url),
    encoding: 'utf8',
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

test('[contract] smoke_image.sh: prepare_runtime_permissions 应修正 runtime 挂载权限', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'knock-release-runtime-'))
  const runtimeDir = join(sandbox, 'runtime')
  mkdirSync(runtimeDir)
  writeFileSync(join(runtimeDir, 'config.yml'), 'sources: {}\n')
  chmodSync(runtimeDir, 0o700)
  chmodSync(join(runtimeDir, 'config.yml'), 0o600)

  try {
    const result = runBash(`
      set -euo pipefail
      source ./scripts/release/smoke_image.sh
      prepare_runtime_permissions ${JSON.stringify(runtimeDir)}
      printf 'dir=%s\n' "$(stat -c '%a' ${JSON.stringify(runtimeDir)})"
      printf 'file=%s\n' "$(stat -c '%a' ${JSON.stringify(join(runtimeDir, 'config.yml'))})"
    `)

    assertEquals(result.status, 0)
    assertEquals(result.stdout.includes('dir=777'), true)
    assertEquals(result.stdout.includes('file=666'), true)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('[contract] smoke_image.sh: assert_runtime_permissions 应在权限漂移时直接失败', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'knock-release-runtime-'))
  const runtimeDir = join(sandbox, 'runtime')
  mkdirSync(runtimeDir)
  writeFileSync(join(runtimeDir, 'config.yml'), 'sources: {}\n')
  chmodSync(runtimeDir, 0o700)
  chmodSync(join(runtimeDir, 'config.yml'), 0o644)

  try {
    const result = runBash(`
      set +e
      source ./scripts/release/smoke_image.sh
      assert_runtime_permissions ${JSON.stringify(runtimeDir)}
    `)

    assertEquals(result.status, 1)
    assertEquals(result.stderr.includes('runtime dir mode must be 777'), true)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the targeted test and verify it fails because the helper functions do not exist yet**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts
```

Expected: FAIL with `prepare_runtime_permissions: command not found` and/or `assert_runtime_permissions: command not found`.

- [ ] **Step 3: Implement `smoke_image.sh` permission helpers and call the preflight assertion before `docker run`**

```bash
# scripts/release/smoke_image.sh
prepare_runtime_permissions() {
  local runtime_dir="$1"
  chmod 0777 "$runtime_dir"
  chmod 0666 "$runtime_dir/config.yml"
}

assert_runtime_permissions() {
  local runtime_dir="$1"
  local config_path="$runtime_dir/config.yml"

  [ -d "$runtime_dir" ] || {
    echo "runtime dir missing: $runtime_dir" >&2
    exit 1
  }
  [ -f "$config_path" ] || {
    echo "runtime config missing: $config_path" >&2
    exit 1
  }
  [ "$(stat -c '%a' "$runtime_dir")" = '777' ] || {
    echo "runtime dir mode must be 777: $runtime_dir" >&2
    exit 1
  }
  [ "$(stat -c '%a' "$config_path")" = '666' ] || {
    echo "runtime config mode must be 666: $config_path" >&2
    exit 1
  }
}

main() {
  image="${KNOCK_IMAGE_TAG:-knock:local}"
  entrypoint="$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')"
  [ "$entrypoint" = '["/app/knock-linux-x64"]' ]

  runtime_dir="$(mktemp -d)"
  container_name="knock-smoke-$(date +%s)-$RANDOM"
  client_tmp="$(mktemp)"
  port="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"

  trap cleanup EXIT

  cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
  prepare_runtime_permissions "$runtime_dir"
  assert_runtime_permissions "$runtime_dir"

  docker run -d --rm \
    --name "$container_name" \
    -p "${port}:${port}" \
    -v "$runtime_dir:/app/runtime" \
    -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
    -e KNOCK_WEB_HOST=0.0.0.0 \
    -e KNOCK_WEB_PORT="$port" \
    "$image" >/dev/null

  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${port}/config" | grep -q 'Knock Config'; then
      curl -fsS "http://127.0.0.1:${port}/assets/client.js" >"$client_tmp"
      test -s "$client_tmp"
      exit 0
    fi
    sleep 0.25
  done

  echo "image did not become ready" >&2
  exit 1
}
```

- [ ] **Step 4: Re-run the smoke permission tests and verify they pass**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts
```

Expected: PASS for the two `smoke_image.sh` permission-helper tests.

- [ ] **Step 5: Commit the smoke permission guard**

```bash
git add src/interfaces/cli/release_runtime_permissions_test.ts scripts/release/smoke_image.sh
git commit -m "fix(release): guard smoke runtime permissions"
```

## Task 3: Add the same runtime permission flow to `measure_cold_start.sh`

**Files:**

- Modify: `src/interfaces/cli/release_runtime_permissions_test.ts`
- Modify: `scripts/release/measure_cold_start.sh`
- Test: `src/interfaces/cli/release_runtime_permissions_test.ts`

- [ ] **Step 1: Extend the test file with failing `measure_cold_start.sh` helper behavior tests**

```ts
// append to src/interfaces/cli/release_runtime_permissions_test.ts

test('[contract] measure_cold_start.sh: prepare_runtime_permissions 应修正每次采样的 runtime 权限', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'knock-release-runtime-'))
  const runtimeDir = join(sandbox, 'runtime')
  mkdirSync(runtimeDir)
  writeFileSync(join(runtimeDir, 'config.yml'), 'sources: {}\n')
  chmodSync(runtimeDir, 0o700)
  chmodSync(join(runtimeDir, 'config.yml'), 0o600)

  try {
    const result = runBash(`
      set -euo pipefail
      source ./scripts/release/measure_cold_start.sh
      prepare_runtime_permissions ${JSON.stringify(runtimeDir)}
      printf 'dir=%s\n' "$(stat -c '%a' ${JSON.stringify(runtimeDir)})"
      printf 'file=%s\n' "$(stat -c '%a' ${JSON.stringify(join(runtimeDir, 'config.yml'))})"
    `)

    assertEquals(result.status, 0)
    assertEquals(result.stdout.includes('dir=777'), true)
    assertEquals(result.stdout.includes('file=666'), true)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('[contract] measure_cold_start.sh: assert_runtime_permissions 应在采样前直接失败', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'knock-release-runtime-'))
  const runtimeDir = join(sandbox, 'runtime')
  mkdirSync(runtimeDir)
  writeFileSync(join(runtimeDir, 'config.yml'), 'sources: {}\n')
  chmodSync(runtimeDir, 0o700)
  chmodSync(join(runtimeDir, 'config.yml'), 0o644)

  try {
    const result = runBash(`
      set +e
      source ./scripts/release/measure_cold_start.sh
      assert_runtime_permissions ${JSON.stringify(runtimeDir)}
    `)

    assertEquals(result.status, 1)
    assertEquals(result.stderr.includes('runtime dir mode must be 777'), true)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the targeted test and verify it fails because the measurement script does not expose the helper functions yet**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts
```

Expected: FAIL on the two new `measure_cold_start.sh` tests with helper-function-not-found errors.

- [ ] **Step 3: Add the same helper functions to `measure_cold_start.sh` and assert before each `docker run`**

```bash
# scripts/release/measure_cold_start.sh
prepare_runtime_permissions() {
  local runtime_dir="$1"
  chmod 0777 "$runtime_dir"
  chmod 0666 "$runtime_dir/config.yml"
}

assert_runtime_permissions() {
  local runtime_dir="$1"
  local config_path="$runtime_dir/config.yml"

  [ -d "$runtime_dir" ] || {
    echo "runtime dir missing: $runtime_dir" >&2
    exit 1
  }
  [ -f "$config_path" ] || {
    echo "runtime config missing: $config_path" >&2
    exit 1
  }
  [ "$(stat -c '%a' "$runtime_dir")" = '777' ] || {
    echo "runtime dir mode must be 777: $runtime_dir" >&2
    exit 1
  }
  [ "$(stat -c '%a' "$config_path")" = '666' ] || {
    echo "runtime config mode must be 666: $config_path" >&2
    exit 1
  }
}

measure_once() {
  local image="$1"
  local runtime_dir=""
  local container_name=""
  local port started ended

  cleanup_measure_once() {
    if [ -n "${container_name:-}" ]; then
      docker rm -f "$container_name" >/dev/null 2>&1 || true
    fi
    if [ -n "${runtime_dir:-}" ]; then
      rm -rf "$runtime_dir"
    fi
  }

  trap cleanup_measure_once RETURN
  runtime_dir="$(mktemp -d)"
  container_name="knock-measure-$(date +%s)-$RANDOM"
  port="$(python3 - <<'PY'
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
  prepare_runtime_permissions "$runtime_dir"
  assert_runtime_permissions "$runtime_dir"

  started="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

  docker run -d --rm \
    --name "$container_name" \
    -p "${port}:${port}" \
    -v "$runtime_dir:/app/runtime" \
    -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
    -e KNOCK_WEB_HOST=0.0.0.0 \
    -e KNOCK_WEB_PORT="$port" \
    "$image" >/dev/null

  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${port}${ready_path}" | grep -q "$ready_marker"; then
      ended="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
      cleanup_measure_once
      container_name=""
      runtime_dir=""
      echo $((ended - started))
      return 0
    fi
    sleep 0.25
  done

  docker logs "$container_name" || true
  cleanup_measure_once
  container_name=""
  runtime_dir=""
  return 1
}
```

- [ ] **Step 4: Re-run the permission-helper tests and verify they pass for both scripts**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts
```

Expected: PASS for all runtime-permission contract tests.

- [ ] **Step 5: Commit the cold-start permission guard**

```bash
git add src/interfaces/cli/release_runtime_permissions_test.ts scripts/release/measure_cold_start.sh
git commit -m "fix(release): guard cold-start runtime permissions"
```

## Task 4: Run the scoped verification set

**Files:**

- Modify: `src/interfaces/cli/release_runtime_permissions_test.ts`
- Modify: `scripts/release/smoke_image.sh`
- Modify: `scripts/release/measure_cold_start.sh`
- Test: `src/interfaces/cli/release_runtime_permissions_test.ts`
- Test: `src/interfaces/cli/release_scripts_test.ts`

- [ ] **Step 1: Run the focused test suite for release-script contracts**

Run:

```bash
bun run test:path -- src/interfaces/cli/release_runtime_permissions_test.ts src/interfaces/cli/release_scripts_test.ts
```

Expected: PASS with the new permission-guard contracts and the existing package-script contract both green.

- [ ] **Step 2: Run scoped formatting checks on the changed files**

Run:

```bash
bun run fmt:check:path -- src/interfaces/cli/release_runtime_permissions_test.ts scripts/release/smoke_image.sh scripts/release/measure_cold_start.sh
```

Expected: PASS with no formatting diffs reported.

- [ ] **Step 3: Run scoped lint and project type-checking for the new TypeScript test**

Run:

```bash
bun run lint:check:path -- src/interfaces/cli/release_runtime_permissions_test.ts src/interfaces/cli/release_scripts_test.ts && bun run check
```

Expected: PASS with no lint or TypeScript errors.

- [ ] **Step 4: Commit the verified runtime permission guard set**

```bash
git add src/interfaces/cli/release_runtime_permissions_test.ts scripts/release/smoke_image.sh scripts/release/measure_cold_start.sh
git commit -m "test(release): lock runtime permission preflight"
```

## Spec coverage check

- **Explicit runtime permission handling in the two release scripts:** Task 2 and Task 3 add `prepare_runtime_permissions()` in `smoke_image.sh` and `measure_cold_start.sh`.
- **Check before every container startup / sample:** Task 2 and Task 3 add `assert_runtime_permissions()` immediately before `docker run`.
- **No shared shell helper extraction:** Both tasks duplicate the helper functions locally, matching the approved scope.
- **TDD-first implementation:** Task 1 creates the sourceable seam, then Task 2 and Task 3 add failing behavior tests before implementation.

## Placeholder scan

- No `TODO`, `TBD`, or “similar to Task N” placeholders remain.
- Every code-changing step includes concrete code or command content.
- Every verification step includes an exact command and expected outcome.

## Type and naming consistency check

- The plan uses the same helper names in tests and scripts throughout: `prepare_runtime_permissions()` and `assert_runtime_permissions()`.
- The new test file path stays stable throughout: `src/interfaces/cli/release_runtime_permissions_test.ts`.
- Both scripts use the same error strings for permission drift so the tests can assert them deterministically.
