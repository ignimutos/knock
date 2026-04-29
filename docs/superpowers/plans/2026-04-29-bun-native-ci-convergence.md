# Bun-owned CLI 执行收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `package.json` 里当前由外部 JavaScript CLI 执行的 `build:web` / `check` / `fmt*` 脚本显式落到 Bun，消除 `vite.config.ts` native loader 对默认 Node 的隐式依赖。

**Architecture:** 保持现有脚本名、`verify:scoped` / `verify:full` 编排、以及 `src/interfaces/web/start_web.ts` 对 `build:web` 的调用方式不变，只替换脚本内部的 CLI 归属。先用一个持久化 contract test 锁住 `package.json` 的目标脚本字符串，再做最小脚本改动，最后补 docs-sync 检查与共享高影响边界验证。

**Tech Stack:** Bun, TypeScript, Bun test, Vite, Prettier, Bash, GitNexus

---

## File Map

- `package.json:6-15` — 本次唯一业务改动面；把 `vite` / `tsc` / `prettier` CLI 显式交给 Bun。
- `src/interfaces/cli/package_scripts_test.ts` — 新增 contract test；从仓库根读取 `package.json`，锁住 6 条脚本契约。
- `scripts/run-paths.sh:1-48` — 只读参考；确认 `bun --bun prettier` 这种多段命令能通过现有 path helper 正常透传，无需改脚本。
- `src/interfaces/web/start_web.ts:253-254` — 只读参考；证明调用方只依赖 `build:web` 这个脚本名，因此本次必须保持脚本名不变。
- `README.md` — docs-sync 只读检查；确认现有验证文档不需要因为“脚本内部运行时归属变化”而改文案。
- `config.example.yml` — docs-sync 只读检查；本次不改配置语义，预期保持不变。

## Scope Guardrails

- 不新增 `setup-node`。
- 不改 `.github/workflows/docker.yml`。
- 不改 `lint*`、`test*`、`verify:*` 的脚本名。
- 不改 `src/interfaces/web/start_web.ts`，因为调用方只看 `build:web` 名字。
- 如果 docs-sync 检查发现 `README.md` 或 `config.example.yml` 已经与目标行为一致，则保持不改。

### Task 1: Add a package-script contract test first

**Files:**

- Create: `src/interfaces/cli/package_scripts_test.ts`
- Read-only reference: `package.json:6-15`

**Test:**

- `bun test src/interfaces/cli/package_scripts_test.ts`

- [ ] **Step 1: Write the failing contract test**

Create `src/interfaces/cli/package_scripts_test.ts` with this exact content:

```ts
import { assertEquals } from '../../testing/assert.ts'
import { readFileSync } from 'node:fs'
import { test } from '../../testing/test_api.ts'

type PackageJson = {
  scripts?: Record<string, string>
}

test('[contract] package.json scripts: 外部 JS CLI 应显式由 Bun 执行', () => {
  const text = readFileSync(
    new URL('../../../package.json', import.meta.url),
    'utf8',
  )
  const parsed = JSON.parse(text) as PackageJson
  const scripts = parsed.scripts ?? {}

  assertEquals(
    scripts['build:web'],
    'bun --bun vite build --configLoader native',
  )
  assertEquals(scripts.check, 'bun --bun tsc --project tsconfig.json')
  assertEquals(scripts.fmt, 'bun --bun prettier --write .')
  assertEquals(
    scripts['fmt:path'],
    'bash ./scripts/run-paths.sh bun --bun prettier --write -- . --',
  )
  assertEquals(scripts['fmt:check'], 'bun --bun prettier --check .')
  assertEquals(
    scripts['fmt:check:path'],
    'bash ./scripts/run-paths.sh bun --bun prettier --check -- . --',
  )
})
```

- [ ] **Step 2: Run the targeted test and confirm it fails before the implementation**

Run:

```bash
bun test src/interfaces/cli/package_scripts_test.ts
```

Expected:

- FAIL.
- At least one assertion shows the current value is still the old contract, e.g. `vite build` or `tsc --project tsconfig.json` instead of the Bun-owned string.

### Task 2: Switch the package scripts to Bun-owned CLIs

**Files:**

- Modify: `package.json:6-15`
- Keep unchanged: `scripts/run-paths.sh:1-48`
- Keep unchanged: `src/interfaces/web/start_web.ts:253-254`

**Tests:**

- `bun test src/interfaces/cli/package_scripts_test.ts`
- `bun run build:web`
- `bun run check`
- `bun run fmt:check:path -- package.json`

- [ ] **Step 1: Replace the affected script values in `package.json`**

Update the `scripts` entries to these exact strings:

```json
{
  "scripts": {
    "build:web": "bun --bun vite build --configLoader native",
    "check": "bun --bun tsc --project tsconfig.json",
    "fmt": "bun --bun prettier --write .",
    "fmt:path": "bash ./scripts/run-paths.sh bun --bun prettier --write -- . --",
    "fmt:check": "bun --bun prettier --check .",
    "fmt:check:path": "bash ./scripts/run-paths.sh bun --bun prettier --check -- . --"
  }
}
```

Do not rename any script keys. `build:web` must stay named `build:web` because `src/interfaces/web/start_web.ts:253-254` still dispatches `['run', 'build:web']`.

- [ ] **Step 2: Re-run the targeted contract test**

Run:

```bash
bun test src/interfaces/cli/package_scripts_test.ts
```

Expected:

- PASS.
- The new test file is the only test that runs.

- [ ] **Step 3: Smoke-test the Bun-owned web build path**

Run:

```bash
bun run build:web
```

Expected:

- PASS.
- Vite builds `.web-dist/assets/client.js` successfully using `--configLoader native` through Bun。

- [ ] **Step 4: Smoke-test the Bun-owned TypeScript baseline**

Run:

```bash
bun run check
```

Expected:

- PASS.
- `tsc --project tsconfig.json` completes without error under `bun --bun`.

- [ ] **Step 5: Smoke-test the Bun-owned path-aware Prettier wrapper**

Run:

```bash
bun run fmt:check:path -- package.json
```

Expected:

- PASS.
- Only `package.json` is checked.
- `scripts/run-paths.sh` needs no edits.

### Task 3: Run docs-sync checks and shared-boundary verification

**Files:**

- Read-only check: `README.md`
- Read-only check: `config.example.yml`
- Reuse from previous tasks: `package.json`, `src/interfaces/cli/package_scripts_test.ts`

**Tests:**

- `rg -n "bun run verify:full|bun run check|bun run fmt:check:path|build:web" README.md config.example.yml`
- `rg -n "build:web" src/interfaces/web/start_web.ts`
- `bun run verify:full`
- `bun run test`

- [ ] **Step 1: Confirm docs-sync is a no-op**

Run:

```bash
rg -n "bun run verify:full|bun run check|bun run fmt:check:path|build:web" README.md config.example.yml
rg -n "build:web" src/interfaces/web/start_web.ts
```

Expected:

- `README.md` already documents the current command names and does not need to mention `bun --bun` internals.
- `config.example.yml` returns no script/runtime-instruction hits.
- `src/interfaces/web/start_web.ts` still references only the stable script name `build:web`.

If these expectations hold, do not edit `README.md`, `config.example.yml`, or `src/interfaces/web/start_web.ts`.

- [ ] **Step 2: Run the repo’s scoped verification chain**

Run:

```bash
bun run verify:full
```

Expected:

- PASS.
- This covers `build:web`, `check`, `test:arch`, `test:startup`, and the repo’s full `bun run test` chain through the existing script contract.

- [ ] **Step 3: Run an explicit full test pass for the shared high-impact boundary**

Run:

```bash
bun run test
```

Expected:

- PASS.
- No regressions outside the targeted script contract.

- [ ] **Step 4: Review change scope with GitNexus before committing**

Run:

```text
gitnexus_detect_changes({scope: "all", repo: "knock"})
```

Expected:

- Only `package.json` and `src/interfaces/cli/package_scripts_test.ts` appear as changed files.
- Risk stays LOW.

- [ ] **Step 5: Commit the finished change**

Run:

```bash
git add package.json src/interfaces/cli/package_scripts_test.ts
git commit -m "fix(tooling): run JS CLIs through Bun"
```

Expected:

- A single commit containing the new contract test and the Bun-owned script updates.

## Final Checklist

- [ ] `src/interfaces/cli/package_scripts_test.ts` exists and locks the six target script strings.
- [ ] `package.json` uses `bun --bun` for `build:web`, `check`, `fmt`, `fmt:path`, `fmt:check`, and `fmt:check:path`.
- [ ] `scripts/run-paths.sh` remains unchanged.
- [ ] `src/interfaces/web/start_web.ts` remains unchanged.
- [ ] `README.md` and `config.example.yml` were checked and correctly left unchanged.
- [ ] `bun run build:web` passed.
- [ ] `bun run check` passed.
- [ ] `bun run fmt:check:path -- package.json` passed.
- [ ] `bun run verify:full` passed.
- [ ] `bun run test` passed.
