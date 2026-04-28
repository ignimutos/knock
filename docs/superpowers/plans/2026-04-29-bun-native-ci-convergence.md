# Bun-native CI 收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把活跃 Docker CI、仓库内 verification 规则、以及 `.claude/` 本地 gate / hook 的 Deno-era 执行路径统一收敛到 Bun，同时保留 README 中合法存在的 Deno feed 示例。

**Architecture:** 保留现有 `verify -> image -> publish -> notify` workflow 拓扑，不引入 reusable workflow。实现上先补齐 Bun 时代真正可用的 path-aware 验证脚本，再让 `.claude/` hook / guard / rules 与 GitHub Actions 全部复用这些脚本；`check` 继续保留项目级 `tsc --project tsconfig.json` 基线，因为它不能和文件路径混用。

**Tech Stack:** GitHub Actions YAML, Bun scripts, Bash hook, Python `unittest`, Markdown rule/docs files

---

## File Map

- `.github/workflows/docker.yml` — 当前唯一活跃 Docker CI workflow；需要把 setup / command / trigger paths 从 Deno 收敛到 Bun。
- `package.json` — CI 与本地 gate 共享的脚本契约；需要新增 path-aware Bun helper scripts，同时保留 `verify:full`、`image:prepare` 作为稳定入口。
- `scripts/run-paths.sh` — 已存在的 path switch helper；本次复用，不改逻辑。
- `.claude/hooks/fmt.sh` — 编辑后自动格式化 hook；当前还在直跑 `deno task fmt`。
- `.claude/skills/test-architecture-guard/SKILL.md` — 测试硬门禁 skill 文档；需要同步成 Bun 命令。
- `.claude/skills/test-architecture-guard/scripts/guard.py` — 测试硬门禁实际命令构造与高风险边界清单。
- `.claude/skills/test-architecture-guard/scripts/test_guard.py` — 对 guard 命令文本与边界清单的单测。
- `CLAUDE.md` — 仓库顶层 agent 约束；当前仍把 `deno task` 当默认事实源。
- `.claude/rules/execution.md` — 规则路径选择器；当前仍绑定 `deno.json`。
- `.claude/rules/verification.md` — 验证命令与高风险边界规则；当前仍要求 `deno task ...`，且 `check` 规则与 Bun 现实不一致。
- `.claude/rules/testing-architecture.md` — 测试高风险边界的全量验证升级规则；当前仍写 `deno task test`。
- `README.md` — 开发验证入口说明；应补充 path-aware Bun 本地命令，并保持 CI 描述与 workflow 一致。
- `docker/README.md` — Docker 发布说明；实施时只做一致性复核，除非 workflow 语义变化，否则不编辑。

## Scope Note: `check` stays global

当前 `package.json` 里的 `check` 是 `tsc --project tsconfig.json`。实测 `bun run check -- src/main.ts` 会失败并报：`TS5042: Option 'project' cannot be mixed with source files on a command line.`

因此本计划的契约是：

- `test` / `fmt:check` / `lint:check` 提供 path-aware 版本。
- `check` 继续作为项目级基线验证命令，不发明伪 scoped 版本。
- 所有规则、hook、gate 文案都必须明确这个差异，避免再写出“`check` 应传受影响路径”这种无法执行的要求。

### Task 1: Add path-aware Bun script contracts

**Files:**
- Modify: `package.json`
- Reuse without edits: `scripts/run-paths.sh`

**Tests:**
- `bun run test:path -- src/container_entrypoint_test.ts`
- `bun run fmt:check:path -- README.md`
- `bun run lint:check:path -- src/main.ts`
- `bun run check`

- [ ] **Step 1: Capture the current mismatch before editing**

Run:

```bash
bun run check -- src/main.ts
bun run test -- src/container_entrypoint_test.ts
```

Expected:
- The first command FAILS with `TS5042: Option 'project' cannot be mixed with source files on a command line.`
- The second command prints `bun test src web src/container_entrypoint_test.ts`, proving the current `test` script is not actually path-scoped.

- [ ] **Step 2: Add explicit path-aware Bun scripts to `package.json`**

Update the `scripts` block so the existing full-repo commands stay unchanged and the path-aware variants are added next to them:

```json
{
  "scripts": {
    "build:web": "vite build --configLoader native",
    "start": "bun run src/main.ts",
    "web": "bun run src/main.ts --mode web",
    "daemon": "bun run src/main.ts --mode daemon",
    "dev": "bun run src/main.ts",
    "check": "tsc --project tsconfig.json",
    "fmt": "prettier --write .",
    "fmt:path": "bash ./scripts/run-paths.sh prettier --write -- . --",
    "fmt:check": "prettier --check .",
    "fmt:check:path": "bash ./scripts/run-paths.sh prettier --check -- . --",
    "lint": "oxlint --fix .",
    "lint:check": "oxlint .",
    "lint:check:path": "bash ./scripts/run-paths.sh oxlint -- . --",
    "test": "bun test src web",
    "test:path": "bash ./scripts/run-paths.sh bun test -- src web --",
    "test:arch": "bun test src/testing/risk_mapping_test.ts",
    "test:startup": "bun test src/config/config_example_test.ts src/interfaces/cli/parse_cli_command_test.ts src/core/app_test.ts src/container_entrypoint_test.ts web/main_test.ts",
    "verify:scoped": "bun run build:web && bun run check && bun run test:arch && bun run test:startup",
    "verify:full": "bun run verify:scoped && bun run test",
    "docker:build": "bash -lc 'docker build --tag \"${KNOCK_IMAGE_TAG:-knock:local}\" .'",
    "docker:size:check": "bash -lc 'image=\"${KNOCK_IMAGE_TAG:-knock:local}\"; size_bytes=$(docker image inspect \"$image\" --format \"{{.Size}}\"); size_mb=$(((size_bytes + 1048575) / 1048576)); limit_mb=${KNOCK_IMAGE_MAX_SIZE_MB:-450}; printf \"Docker image size: %s MB (limit %s MB)\\n\" \"$size_mb\" \"$limit_mb\"; test \"$size_mb\" -le \"$limit_mb\"'",
    "image:prepare": "bun run docker:build && bun run docker:size:check",
    "release:prepare": "bun run verify:full && bun run image:prepare"
  }
}
```

- [ ] **Step 3: Verify the new path-aware scripts behave as intended**

Run:

```bash
bun run test:path -- src/container_entrypoint_test.ts
bun run fmt:check:path -- README.md
bun run lint:check:path -- src/main.ts
bun run check
```

Expected:
- `bun run test:path -- src/container_entrypoint_test.ts` only runs the requested test file.
- `bun run fmt:check:path -- README.md` checks only `README.md` and prints Prettier success.
- `bun run lint:check:path -- src/main.ts` checks only `src/main.ts`.
- `bun run check` passes as the project-wide baseline.

- [ ] **Step 4: Review scope and commit Task 1**

Use GitNexus before committing:

```text
gitnexus_detect_changes({scope: "all", repo: "knock"})
```

Then commit:

```bash
git add package.json
git commit -m "chore(tooling): add path-aware Bun verification scripts"
```

### Task 2: Migrate local hooks and test gate automation to Bun

**Files:**
- Modify: `.claude/hooks/fmt.sh`
- Modify: `.claude/skills/test-architecture-guard/SKILL.md`
- Modify: `.claude/skills/test-architecture-guard/scripts/guard.py`
- Modify: `.claude/skills/test-architecture-guard/scripts/test_guard.py`

**Tests:**
- `python .claude/skills/test-architecture-guard/scripts/test_guard.py`
- temp-file smoke for `.claude/hooks/fmt.sh`

- [ ] **Step 1: Update the guard tests first so they describe the Bun-era contract**

Change the Python test expectations to assert the new command text and the current real high-risk boundary set.

Use these exact assertion shapes:

```python
self.assertIn("bun run test:path -- src/core/logger_test.ts", executed)
self.assertIn("bun run check", executed)
self.assertIn("bun run fmt:check:path -- src/core/logger_test.ts docs/testing/risk-matrix.yml", executed)
```

Replace the old high-risk boundary loop with Bun-era boundaries that actually exist in this repo:

```python
for boundary_path in (
    "package.json",
    "bun.lock",
    "scripts/run-paths.sh",
    "src/main.ts",
    "src/container_entrypoint.ts",
    "src/test_runtime.ts",
    "src/sources/xquery.ts",
):
```

Keep the assertions checking that a high-risk boundary still triggers the full-project command:

```python
self.assertIn("bun run test", executed)
```

- [ ] **Step 2: Run the Python test suite to confirm the old implementation now fails**

Run:

```bash
python .claude/skills/test-architecture-guard/scripts/test_guard.py
```

Expected:
- FAIL, because `guard.py` still emits `deno task ...` commands and still carries stale boundary entries.

- [ ] **Step 3: Implement the Bun-era hook and guard behavior**

Update `.claude/hooks/fmt.sh` to call the new path-aware script:

```bash
#!/usr/bin/env bash
set -euo pipefail

if ! jq -r '.tool_input.file_path // .tool_response.filePath // empty' \
  | { read -r f || exit 0; bun run fmt:path -- "$f"; }; then
  exit 0
fi
```

Update `.claude/skills/test-architecture-guard/SKILL.md` so the execution section matches the new contract:

```md
5. 执行 scoped verification：
   - `bun run test:path -- <changed test files>`
   - `bun run check`
   - `bun run fmt:check:path -- <changed paths>`
6. 命中高风险边界时追加全量验证：`bun run test`
```

Update `guard.py` to use the current boundary set and Bun commands:

```python
HIGH_RISK_BOUNDARIES = (
    "package.json",
    "bun.lock",
    "scripts/run-paths.sh",
    "src/main.ts",
    "src/container_entrypoint.ts",
    "src/db/",
    "src/test_runtime.ts",
    "src/sources/xquery.ts",
)
```

```python
def _verification_commands(changed_paths: List[str]) -> List[List[str]]:
    commands: List[List[str]] = []
    changed_test_files = [path for path in changed_paths if _is_test_file(path)]
    checkable_paths = [path for path in changed_paths if _is_checkable_path(path)]
    has_test_related_changes = bool(changed_test_files)
    has_high_risk_changes = _hits_high_risk_boundary(changed_paths)

    if not has_test_related_changes and not has_high_risk_changes:
        return commands

    if has_test_related_changes:
        commands.append(["bun", "run", "test:path", "--", *changed_test_files])

    if checkable_paths:
        commands.append(["bun", "run", "check"])

    if changed_paths:
        commands.append(["bun", "run", "fmt:check:path", "--", *changed_paths])

    if has_high_risk_changes:
        commands.append(["bun", "run", "test"])

    return commands
```

Keep `lint:check:path` out of `guard.py` for now; this gate’s existing contract only enforced `test` / `check` / `fmt:check`, and this task should not widen the gate beyond the approved spec.

- [ ] **Step 4: Re-run the Python tests until they pass**

Run:

```bash
python .claude/skills/test-architecture-guard/scripts/test_guard.py
```

Expected:
- PASS.

- [ ] **Step 5: Smoke-test the format hook against a disposable temp file**

Run:

```bash
mkdir -p .tmp
fixture=$(mktemp .tmp/fmt-hook-XXXXXX.ts)
printf 'const  value=1\n' > "$fixture"
printf '{"tool_input":{"file_path":"%s"}}' "$fixture" | bash .claude/hooks/fmt.sh
test -s "$fixture"
rm "$fixture"
```

Expected:
- The hook exits `0`.
- The temp file still exists and has been formatted by Prettier.
- No repo-wide format command is triggered.

- [ ] **Step 6: Review scope and commit Task 2**

Use GitNexus before committing:

```text
gitnexus_detect_changes({scope: "all", repo: "knock"})
```

Then commit:

```bash
git add .claude/hooks/fmt.sh .claude/skills/test-architecture-guard/SKILL.md .claude/skills/test-architecture-guard/scripts/guard.py .claude/skills/test-architecture-guard/scripts/test_guard.py
git commit -m "chore(claude): migrate hooks and test guard to Bun"
```

### Task 3: Align tracked agent rules with Bun reality

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/rules/execution.md`
- Modify: `.claude/rules/verification.md`
- Modify: `.claude/rules/testing-architecture.md`

**Tests:**
- `git grep -n -E 'deno task|deno\.json|deno\.lock' -- CLAUDE.md .claude/rules`
- path / command consistency checks for every command named in the rules

- [ ] **Step 1: Capture the stale Deno-era rule references**

Run:

```bash
git grep -n -E 'deno task|deno\.json|deno\.lock' -- CLAUDE.md .claude/rules
```

Expected:
- Hits in `CLAUDE.md`, `.claude/rules/verification.md`, `.claude/rules/testing-architecture.md`, and the `paths:` header of `.claude/rules/execution.md`.

- [ ] **Step 2: Rewrite the top-level `CLAUDE.md` workflow guidance**

Update the workflow section to stop prescribing Deno and to explain the `check` exception explicitly:

```md
- 当标准 task 存在时，agents **MUST** 优先使用 `bun run`。
- 对 `fmt:check` / `lint:check` / `test` 的直接调用，agents **MUST** 优先使用受影响路径（例如 `bun run fmt:check:path -- <paths>`、`bun run lint:check:path -- <paths>`、`bun run test:path -- <paths>`）。
- `check` 当前使用项目级 `tsc --project tsconfig.json`，agents **SHOULD** 运行 `bun run check` 作为基线验证。
```

Update the high-impact verification bullet to:

```md
- 命中共享高影响边界时 **MUST** 追加全量 `bun run test`。
```

- [ ] **Step 3: Rewrite the tracked `.claude/rules/*.md` files to match the new contract**

Update `.claude/rules/execution.md` path selector to watch Bun-era config surfaces instead of `deno.json`:

```md
---
paths:
  - 'src/**'
  - 'web/**'
  - 'scripts/**'
  - 'package.json'
  - 'bun.lock'
  - 'Dockerfile'
  - '.github/workflows/**'
  - 'CLAUDE.md'
  - '.claude/rules/**'
---
```

Update `.claude/rules/verification.md` to load on the real CI / local gate surfaces and to describe the Bun contract exactly:

```md
---
paths:
  - 'src/**'
  - 'web/**'
  - 'scripts/**'
  - 'package.json'
  - 'bun.lock'
  - 'Dockerfile'
  - '.dockerignore'
  - 'docker/**'
  - '.github/workflows/**'
  - 'README.md'
  - 'config.example.yml'
  - 'CLAUDE.md'
  - '.claude/rules/**'
  - '.claude/hooks/**'
  - '.claude/skills/test-architecture-guard/**'
---
```

```md
- MUST 先跑最窄相关验证，优先使用 scoped task：`bun run test:path -- <path ...>`、`bun run fmt:check:path -- <path ...>`、`bun run lint:check:path -- <path ...>`。
- `check` 当前使用项目级 `tsc --project tsconfig.json`；命中代码改动时 SHOULD 运行 `bun run check`。
- 共享入口与高影响边界改动收尾前 MUST 运行全量 `bun run test`；典型边界包括 `package.json`、`bun.lock`、`scripts/run-paths.sh`、`src/main.ts`、`src/container_entrypoint.ts`、`src/db/*`、`src/test_runtime.ts`、`src/sources/xquery.ts`。
- 按改动影响 SHOULD 追加 `bun run check`、`bun run lint:check:path -- <path ...>`、`bun run fmt:check:path -- <path ...>`。
```

Update `.claude/rules/testing-architecture.md` to use Bun for the high-risk escalation:

```md
- 命中共享高风险边界时，门禁 MUST 追加一次全量 `bun run test`。
```

- [ ] **Step 4: Verify that the tracked rule surface no longer prescribes Deno**

Run:

```bash
git grep -n -E 'deno task|deno\.json|deno\.lock' -- CLAUDE.md .claude/rules
test -e package.json
test -e bun.lock
test -e .github/workflows/docker.yml
```

Expected:
- The grep returns no output.
- The referenced Bun-era files exist.

- [ ] **Step 5: Review scope and commit Task 3**

Use GitNexus before committing:

```text
gitnexus_detect_changes({scope: "all", repo: "knock"})
```

Then commit:

```bash
git add CLAUDE.md .claude/rules/execution.md .claude/rules/verification.md .claude/rules/testing-architecture.md
git commit -m "docs(claude): align verification rules with Bun"
```

### Task 4: Switch the Docker workflow to Bun and refresh developer-facing docs

**Files:**
- Modify: `.github/workflows/docker.yml`
- Modify: `README.md`
- Compare only; modify only if semantics drifted: `docker/README.md`
- Read-only contract reference: `package.json`

**Tests:**
- `bun run verify:full`
- `bun run image:prepare`
- `git grep -n -E 'deno\.json|deno\.lock|setup-deno|deno task' -- .github/workflows/docker.yml`

- [ ] **Step 1: Capture the current workflow’s Deno-era trigger and runtime assumptions**

Run:

```bash
git grep -n -E 'deno\.json|deno\.lock|setup-deno|deno task' -- .github/workflows/docker.yml
```

Expected:
- Hits in the `paths` filters and in both `verify` / `image` jobs.

- [ ] **Step 2: Replace the workflow trigger set and runtime setup with Bun**

Update both `pull_request.paths` and `push.paths` to the Bun-era input set:

```yaml
paths:
  - src/**
  - web/**
  - package.json
  - bun.lock
  - tsconfig.json
  - vite.config.ts
  - Dockerfile
  - .dockerignore
  - docker/**
  - scripts/**
  - README.md
  - config.example.yml
  - .github/workflows/docker.yml
```

Replace both Deno setup steps with the documented Bun action and pin it to the same version used by `Dockerfile`:

```yaml
- name: Set up Bun
  uses: oven-sh/setup-bun@v2
  with:
    bun-version: 1.3.13
```

Replace the run commands with the Bun contract already defined in `package.json`:

```yaml
- name: Verify release pipeline inputs
  run: bun run verify:full
```

```yaml
- name: Build and size-check image
  run: bun run image:prepare
```

- [ ] **Step 3: Refresh the developer-facing README to document the new local scoped commands**

In the `README.md` development verification section, keep the existing full-project bullets and append the new local scoped helpers:

```md
- `bun run test:path -- <paths>`：按路径运行测试子集。
- `bun run lint:check:path -- <paths>`：按路径运行 lint 子集。
- `bun run fmt:check:path -- <paths>`：按路径运行 Prettier 检查子集。
- `bun run check`：当前仍为项目级 TypeScript 基线验证，不支持按路径切片。
```

Re-read `docker/README.md` after the workflow edit. If its `verify -> image -> publish` wording still matches the workflow semantics exactly, leave it unchanged.

- [ ] **Step 4: Re-run the real local release gate**

Run:

```bash
bun run verify:full
bun run image:prepare
```

Expected:
- `bun run verify:full` passes.
- `bun run image:prepare` passes and prints `Docker image size: <n> MB (limit 450 MB)`.

- [ ] **Step 5: Verify the workflow file is fully Bun-native and the remaining Deno mentions are only business examples**

Run:

```bash
git grep -n -E 'deno\.json|deno\.lock|setup-deno|deno task' -- .github/workflows/docker.yml
git grep -n '\bdeno\b' -- README.md docker/README.md
```

Expected:
- The workflow grep returns no output.
- Any remaining `README.md` / `docker/README.md` hits are feed-example or business-content mentions, not runtime, task, or CI instructions.

- [ ] **Step 6: Review scope and commit Task 4**

Use GitNexus before committing:

```text
gitnexus_detect_changes({scope: "all", repo: "knock"})
```

Then commit:

```bash
git add .github/workflows/docker.yml README.md docker/README.md
git commit -m "fix(ci): switch Docker workflow to Bun"
```

Expected:
- If `docker/README.md` stayed unchanged, `git add` simply stages the files that actually changed.
- If `docker/README.md` drifted and you updated it, it lands in the same commit without using amend.

## Final Checklist

- [ ] `package.json` exposes `test:path`, `fmt:path`, `fmt:check:path`, and `lint:check:path`.
- [ ] `.claude/hooks/fmt.sh` no longer calls `deno task fmt`.
- [ ] `.claude/skills/test-architecture-guard/*` no longer emits `deno task ...` commands.
- [ ] `CLAUDE.md` and tracked `.claude/rules/*.md` no longer prescribe Deno-era verification commands.
- [ ] `.github/workflows/docker.yml` installs Bun with `oven-sh/setup-bun@v2` and runs `bun run verify:full` / `bun run image:prepare`.
- [ ] `bun run verify:full` passed locally.
- [ ] `bun run image:prepare` passed locally.
- [ ] Remaining `deno` strings in `README.md` / `docker/README.md` are only data examples, not CI/runtime guidance.
