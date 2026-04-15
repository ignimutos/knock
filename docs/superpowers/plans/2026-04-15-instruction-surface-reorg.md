# Instruction Surface Reorg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure global and project instruction surfaces so stable general rules live in `/root/.claude/CLAUDE.md`, project-specific rule bodies live in `.claude/rules/**`, `GitNexus.md` moves back into the repo as a path-scoped rule, and repo `CLAUDE.md` becomes a thin project entry.

**Architecture:** Keep a 3-layer instruction model. The global file carries cross-repo stable rules, the repo root `CLAUDE.md` carries only top-level project constraints, and path-scoped rule files under `.claude/rules/**` carry project rule bodies with explicit `paths:` frontmatter so they load only when relevant. Treat the change as a structure migration, not a behavior rewrite.

**Tech Stack:** Claude Code memory/project rules, Markdown, repo-local instruction files, Deno task conventions

---

## File map

### Global files

- Modify: `/root/.claude/CLAUDE.md` — keep only cross-repo stable guidance and remove `@GitNexus.md`
- Read/Migrate from: `/root/.claude/GitNexus.md` — source of the GitNexus rule body if it still exists

### Repo top-level files

- Modify: `/root/git/knock/.claude/worktrees/unknown/CLAUDE.md` — shrink to a thin project entry with only top-level project constraints

### Repo rule files to create

- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/execution.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/verification.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/docs-sync.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/config-contract.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/naming-and-dependencies.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/gitnexus.md`

### Existing repo rule files to modify

- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-otel.md` — add explicit `paths:` frontmatter
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-console.md` — add explicit `paths:` frontmatter
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/testing-architecture.md` — add explicit `paths:` frontmatter

### Specs and plans

- Reference: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/specs/2026-04-14-instruction-surface-design.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/plans/2026-04-15-instruction-surface-reorg.md`

## Task 1: Verify prerequisites and capture migration inputs

**Files:**

- Read: `/root/.claude/GitNexus.md`
- Read: `/root/.claude/CLAUDE.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-otel.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-console.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/testing-architecture.md`

- [ ] **Step 1: Inspect whether the GitNexus source file still exists with content**

Run: `ls -l "/root/.claude/GitNexus.md" && wc -l "/root/.claude/GitNexus.md"`
Expected: a concrete size and line count for the source file.

- [ ] **Step 2: Stop immediately if `/root/.claude/GitNexus.md` is empty**

If the file is empty, do not guess the old content. Record this exact blocker and stop implementation:

```text
BLOCKED: /root/.claude/GitNexus.md is empty, so the original GitNexus rule body cannot be migrated verbatim. Restore the source file content first, then resume this plan.
```

Expected: either the file has content and work continues, or execution stops with the blocker above.

- [ ] **Step 3: Record the exact skill references inside the GitNexus body**

Run: `grep -nE "\.claude/skills|/root/\.claude/skills|skills/" "/root/.claude/GitNexus.md"`
Expected: zero or more exact path matches that will be rewritten only inside the migrated GitNexus file.

- [ ] **Step 4: Confirm the current global file still imports GitNexus**

Run: `sed -n '1,5p' "/root/.claude/CLAUDE.md"`
Expected:

```markdown
@RTK.md
@GitNexus.md
```

- [ ] **Step 5: Confirm the existing repo rules are currently unscoped**

Run: `grep -nE "^---$|^paths:" .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/rules/testing-architecture.md`
Expected: no matches before the migration.

## Task 2: Rewrite global `/root/.claude/CLAUDE.md` into a stable cross-repo rule set

**Files:**

- Modify: `/root/.claude/CLAUDE.md`
- Create temporary backup: `/root/.claude/CLAUDE.md.bak.before-instruction-surface-reorg`

- [ ] **Step 1: Create a backup because `/root/.claude` is outside the repo**

Run: `cp "/root/.claude/CLAUDE.md" "/root/.claude/CLAUDE.md.bak.before-instruction-surface-reorg"`
Expected: a backup file exists before editing.

- [ ] **Step 2: Remove the GitNexus import and keep only RTK in the header**

Replace:

```markdown
@RTK.md
@GitNexus.md
```

with:

```markdown
@RTK.md
```

Expected: the global file no longer auto-injects GitNexus.

- [ ] **Step 3: Keep only stable cross-repo guidance in the body**

Preserve a short body shaped like this, without any repo-specific content:

```markdown
## 回复原则

- 回复直接从内容开始。
- 直接给答案。使用完成任务所需的最少词数，同时保证信息足够。
- 保持极其简洁。短句优先。

## 工作方式

- 先思考，再行动。
- 改代码或文档前，先读目标文件和相邻上下文。
- 优先编辑现有文件，优先局部修改，优先最小完整改动。
- 宣告完成前先验证结果。
- 没有验证结果时，不宣称完成。
```

- [ ] **Step 4: Verify the rewritten global file contains no project-specific content**

Run: `grep -nE "knock|deno task|\.claude/rules|GitNexus" "/root/.claude/CLAUDE.md"`
Expected: no matches.

- [ ] **Step 5: Review the manual diff against the backup**

Run: `diff -u "/root/.claude/CLAUDE.md.bak.before-instruction-surface-reorg" "/root/.claude/CLAUDE.md"`
Expected: the diff only removes GitNexus injection and any project-specific wording.

## Task 3: Create new path-scoped repo rule files from the current repo rule bodies

**Files:**

- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/execution.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/verification.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/docs-sync.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/config-contract.md`
- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/naming-and-dependencies.md`
- Reference: `/root/git/knock/.claude/worktrees/unknown/CLAUDE.md`

- [ ] **Step 1: Create `execution.md` with explicit scoped frontmatter**

```markdown
---
paths:
  - 'src/**'
  - 'web/**'
  - 'CLAUDE.md'
  - '.claude/**'
---

# execution

- 修改前 MUST 先读目标模块及相邻上下文；行为改动前 MUST 先读相邻测试。
- 非平凡任务（多文件、接口/状态变化、重构）MUST 先有简短计划（目标 / 实现 / 验证）。
- MUST 保持原子变更，MUST 避免混入无关清理。
- 如前提缺失、假设失效或验证失败，MUST 停止并重新规划；必要时报告 `BLOCKED: <reason>`。
- 只有真实阻塞、高风险共享状态操作、或真实方案分叉时，MAY 请求用户参与。
- 实现取舍优先级 SHOULD 为：correctness → direct path to target structure → single source of truth → smallest complete fix → root-cause repair → maintainability。
```

- [ ] **Step 2: Create `verification.md` with explicit scoped frontmatter**

```markdown
---
paths:
  - 'src/**'
  - 'web/**'
  - 'CLAUDE.md'
  - '.claude/**'
  - 'README.md'
  - 'config.example.yml'
---

# verification

## Docs-only changes

- MUST 校验提到的路径与命令真实存在。
- 可不跑代码；交付中 MUST 明确一致性检查结果与未运行项。

## Code changes

- MUST NOT 在未验证行为前宣告完成。
- MUST 先跑最窄相关验证，优先使用 scoped task：`deno task test <path>`。
- 对 `check` / `fmt:check` / `lint:check` / `test`，agents 直接调用时 MUST 传入受影响路径；需要基线验证时 MAY 无参调用。
- 共享入口与高影响边界改动收尾前 MUST 运行全量 `deno task test`；典型边界包括 `src/main.ts`、`src/core/app.ts`、`src/db/*`、`src/sources/xquery.ts`、`src/test_runtime.ts`、`deno.json`、`scripts/run-paths.sh`。
- 按改动影响 SHOULD 追加 `deno task check`、`deno task lint:check`、`deno task fmt:check`。

## Final review output

- 最终交付 SHOULD 明确：改动内容、已运行验证、未运行验证、剩余风险或后续事项。
```

- [ ] **Step 3: Create `docs-sync.md` with explicit scoped frontmatter**

```markdown
---
paths:
  - 'README.md'
  - 'config.example.yml'
  - 'src/**'
  - 'web/**'
  - 'CLAUDE.md'
---

# docs-sync

- 行为、配置 shape、命名、CLI 输出或错误文案变化时，MUST 同步检查 `README.md` 与 `config.example.yml`。
- MUST NOT 记录代码未实现的行为。
```

- [ ] **Step 4: Create `config-contract.md` with explicit scoped frontmatter**

```markdown
---
paths:
  - 'src/config/**'
  - 'config.example.yml'
  - 'README.md'
  - 'src/**'
---

# config-contract

- 当前配置模型：`deliveries.<id>` 定义 canonical delivery，`sources.<id>.deliveries` 是 keyed map；key 为 delivery ID，value 为该 source 对对应 delivery 的 override。source 侧只允许按 delivery 类型覆写消息子树：file 覆写 `file.content`、push 的 canonical 消息子树是 `push.request.payload` 且 source override 键为 `payload`、email 覆写 `email.message`；空 override 使用 `{}`。
- MUST NOT 恢复 `templates` / `destinations` 等旧结构。
- MUST 保持单一事实源，MUST NOT 制造双 shape。
- 若任务未明确要求迁移兼容，MUST NOT 添加历史字段兼容层、别名或迁移提示。
- MUST 保留 `${ENV_VAR}` 展开语义。
- MUST NOT 在代码或提交配置中硬编码 token/chatId/password 等 secrets。
- MUST NOT 在日志中输出敏感原始值。
```

- [ ] **Step 5: Create `naming-and-dependencies.md` with explicit scoped frontmatter**

```markdown
---
paths:
  - 'src/**'
  - 'web/**'
  - 'README.md'
  - 'config.example.yml'
  - 'CLAUDE.md'
---

# naming-and-dependencies

- 同一概念在 config / types / tests / docs / CLI / error 中 MUST 使用稳定术语。
- 注释与 TODO SHOULD 保持最小化；自然语言注释 MUST 使用中文；保留 TODO/FIXME 时 MUST 写明延期原因与移除条件。
- 新增依赖优先级 SHOULD 为：原生 JS/TS API → `@std/*` → `remeda` → 领域库。
- 新的不可信结构化输入边界 SHOULD 在边界处一次性用 `zod` 校验。
```

- [ ] **Step 6: Verify all newly created rules are scoped**

Run: `grep -nE "^---$|^paths:" .claude/rules/execution.md .claude/rules/verification.md .claude/rules/docs-sync.md .claude/rules/config-contract.md .claude/rules/naming-and-dependencies.md`
Expected: every file shows YAML frontmatter and a `paths:` block.

- [ ] **Step 7: Commit the newly created rule files**

```bash
git add .claude/rules/execution.md .claude/rules/verification.md .claude/rules/docs-sync.md .claude/rules/config-contract.md .claude/rules/naming-and-dependencies.md
git commit -m "docs: split project rules into scoped files"
```

## Task 4: Add explicit `paths:` frontmatter to existing logging and testing rules

**Files:**

- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-otel.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-console.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/testing-architecture.md`

- [ ] **Step 1: Add frontmatter to `logging-otel.md`**

Prepend:

```markdown
---
paths:
  - 'src/main.ts'
  - 'src/application/**'
  - 'src/core/**'
  - 'src/db/**'
  - 'src/deliveries/**'
  - 'src/interfaces/**'
  - 'src/sources/**'
  - 'src/web/**'
  - 'web/**'
  - 'README.md'
  - 'config.example.yml'
---
```

Expected: the existing OTel rule body remains unchanged below the frontmatter.

- [ ] **Step 2: Add frontmatter to `logging-console.md`**

Prepend:

```markdown
---
paths:
  - 'src/main.ts'
  - 'src/core/**'
  - 'src/interfaces/**'
  - 'src/web/**'
  - 'web/**'
  - 'README.md'
  - 'config.example.yml'
---
```

Expected: the existing console rule body remains unchanged below the frontmatter.

- [ ] **Step 3: Add frontmatter to `testing-architecture.md`**

Prepend:

```markdown
---
paths:
  - 'src/**/*test.ts'
  - 'web/**/*test.ts'
  - 'web/**/*test.tsx'
  - 'docs/testing/**'
  - '.claude/settings.json'
  - 'scripts/run-paths.sh'
---
```

Expected: the existing testing-architecture rule body remains unchanged below the frontmatter.

- [ ] **Step 4: Verify the existing rule bodies were preserved**

Run: `sed -n '1,20p' .claude/rules/logging-otel.md && sed -n '1,20p' .claude/rules/logging-console.md && sed -n '1,20p' .claude/rules/testing-architecture.md`
Expected: frontmatter appears first and the original rule text begins immediately after it.

- [ ] **Step 5: Commit the scoped existing rule files**

```bash
git add .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/rules/testing-architecture.md
git commit -m "docs: scope existing project rules by path"
```

## Task 5: Migrate GitNexus rule body into `.claude/rules/gitnexus.md`

**Files:**

- Create: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/gitnexus.md`
- Read: `/root/.claude/GitNexus.md`

- [ ] **Step 1: Create the repo GitNexus rule file with explicit frontmatter**

```markdown
---
paths:
  - 'src/**'
  - 'web/**'
  - 'CLAUDE.md'
  - '.claude/**'
---
```

Expected: the file starts with scoped frontmatter before the migrated body.

- [ ] **Step 2: Paste the full GitNexus rule body into the repo rule file**

Copy the full restored content of `/root/.claude/GitNexus.md` below the frontmatter. Do not summarize or trim it.

Expected: `.claude/rules/gitnexus.md` contains the full original GitNexus rule text.

- [ ] **Step 3: Rewrite only the skill path references inside the migrated GitNexus body**

Use the exact matches captured in Task 1 Step 3 and only rewrite those references. Example target form:

```markdown
- Understand architecture / "How does X work?" → `/root/.claude/skills/gitnexus-exploring/SKILL.md`
- Blast radius / "What breaks if I change X?" → `/root/.claude/skills/gitnexus-impact-analysis/SKILL.md`
- Trace bugs / "Why is X failing?" → `/root/.claude/skills/gitnexus-debugging/SKILL.md`
- Rename / extract / split / refactor → `/root/.claude/skills/gitnexus-refactoring/SKILL.md`
- Tools, resources, schema reference → `/root/.claude/skills/gitnexus-guide/SKILL.md`
- Index, status, clean, wiki CLI commands → `/root/.claude/skills/gitnexus-cli/SKILL.md`
```

Do not rewrite unrelated rule text.

- [ ] **Step 4: Verify no stale project-local skill paths remain in `gitnexus.md`**

Run: `grep -nE "\.claude/skills|skills/" .claude/rules/gitnexus.md`
Expected: only the intended global skill references remain.

- [ ] **Step 5: Commit the GitNexus migration**

```bash
git add .claude/rules/gitnexus.md
git commit -m "docs: move gitnexus rules back into repo"
```

## Task 6: Shrink repo `CLAUDE.md` into a thin project entry

**Files:**

- Modify: `/root/git/knock/.claude/worktrees/unknown/CLAUDE.md`
- Reference: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/*.md`

- [ ] **Step 1: Replace the large body with a thin top-level structure**

Rewrite the file so its section structure is only:

```markdown
# CLAUDE.md

## Canonical scope

...

## Project-specific workflow

...

## Project-only contracts

...

## Verification boundaries

...

## CI reality

...
```

Expected: detailed repository map, long project snapshot, and rule-heavy sections are removed.

- [ ] **Step 2: Keep only top-level workflow constraints in the new body**

```markdown
## Project-specific workflow

- 当标准 task 存在时，agents MUST 优先使用 `deno task`。
- `check` / `fmt:check` / `lint:check` / `test` 直接调用时 MUST 优先使用受影响路径。
```

- [ ] **Step 3: Keep only top-level project contracts in the new body**

```markdown
## Project-only contracts

- 当前配置模型保持 `deliveries.<id>` canonical + `sources.<id>.deliveries` keyed override。
- MUST NOT 恢复 `templates` / `destinations` 等旧结构。
- MUST 保留 `${ENV_VAR}` 展开语义。
```

Do not paste full rule bodies here.

- [ ] **Step 4: Keep only top-level verification boundaries in the new body**

```markdown
## Verification boundaries

- docs-only 改动 MUST 做路径与命令一致性检查。
- code changes MUST 先跑最窄相关验证。
- 命中共享高影响边界时 MUST 追加全量 `deno task test`。
```

- [ ] **Step 5: Verify the new repo file is short and no longer duplicates rule bodies**

Run: `wc -l CLAUDE.md && grep -nE "Project snapshot|Repository map|Execution rules|Naming, comments, observability, dependencies|Testing Architecture" CLAUDE.md`
Expected: the line count drops materially and the removed long sections are gone.

- [ ] **Step 6: Commit the thin entry rewrite**

```bash
git add CLAUDE.md
git commit -m "docs: turn repo claude file into thin entry"
```

## Task 7: Validate the final structure and repo-scoped formatting

**Files:**

- Verify: `/root/.claude/CLAUDE.md`
- Verify: `/root/git/knock/.claude/worktrees/unknown/CLAUDE.md`
- Verify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/*.md`
- Verify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/specs/2026-04-14-instruction-surface-design.md`
- Verify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/plans/2026-04-15-instruction-surface-reorg.md`

- [ ] **Step 1: Verify the global file no longer imports GitNexus**

Run: `grep -n "@GitNexus.md" "/root/.claude/CLAUDE.md"`
Expected: no matches.

- [ ] **Step 2: Verify every repo rule file is now path-scoped**

Run: `grep -nE "^---$|^paths:" .claude/rules/*.md`
Expected: every rule file under `.claude/rules` shows YAML frontmatter with `paths:`.

- [ ] **Step 3: Verify the repo root file no longer acts as a rule dump**

Run: `grep -nE "Project snapshot|Repository map|Core contracts|Execution rules" CLAUDE.md`
Expected: no matches.

- [ ] **Step 4: Run repo-scoped formatting checks on modified tracked files**

Run: `deno task fmt:check CLAUDE.md .claude/rules/execution.md .claude/rules/verification.md .claude/rules/docs-sync.md .claude/rules/config-contract.md .claude/rules/naming-and-dependencies.md .claude/rules/gitnexus.md .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/rules/testing-architecture.md docs/superpowers/specs/2026-04-14-instruction-surface-design.md docs/superpowers/plans/2026-04-15-instruction-surface-reorg.md`
Expected: PASS.

- [ ] **Step 5: Review the tracked repo diff**

Run: `git diff -- CLAUDE.md .claude/rules docs/superpowers/specs/2026-04-14-instruction-surface-design.md docs/superpowers/plans/2026-04-15-instruction-surface-reorg.md`
Expected: the diff shows structure migration only, without unrelated code changes.

- [ ] **Step 6: Commit the final repo reconciliation**

```bash
git add CLAUDE.md .claude/rules docs/superpowers/specs/2026-04-14-instruction-surface-design.md docs/superpowers/plans/2026-04-15-instruction-surface-reorg.md
git commit -m "docs: reorganize claude instruction surfaces"
```

## Self-review

### Spec coverage

- Global cross-repo narrowing: covered by Task 2.
- Repo thin entry rewrite: covered by Task 6.
- Theme-based rule split with explicit `paths:`: covered by Task 3.
- Existing logging/testing rules gaining explicit `paths:`: covered by Task 4.
- GitNexus full migration back into repo: covered by Task 5.
- GitNexus-only skill path fixups: covered by Task 5 Step 3.
- Structure-focused verification: covered by Task 7.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Every file path is concrete.
- Every verification step includes an exact command and expected outcome.
- The global file is treated as an out-of-repo manual edit instead of an impossible git commit target.

### Type consistency

- Rule filenames are used consistently: `execution.md`, `verification.md`, `docs-sync.md`, `config-contract.md`, `naming-and-dependencies.md`, `gitnexus.md`.
- The 3-layer model is consistent across tasks: global `/root/.claude/CLAUDE.md`, repo `CLAUDE.md`, `.claude/rules/**`.
- GitNexus path-fix scope remains intentionally narrow throughout the plan.

Plan complete and saved to `docs/superpowers/plans/2026-04-15-instruction-surface-reorg.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
