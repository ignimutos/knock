# Rules Paths Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten and correct `.claude/rules/*.md` loading surfaces according to the completed audit, while allowing only minimal body edits where a new match surface would otherwise conflict with the rule text.

**Architecture:** Treat the audit report as the default source of truth, then apply each rule’s recommended loading-surface change with one last narrow correctness pass against representative sample paths. The one approved exception is `gitnexus.md`, which remains in `.claude/rules/` but loads unconditionally with no frontmatter. The work stays inside the existing rule files and preserves the current instruction-surface layering: global `/root/.claude/CLAUDE.md`, thin repo `CLAUDE.md`, and `.claude/rules/*.md`.

**Tech Stack:** Claude Code project rules, Markdown, Deno test tasks, repo documentation tests

---

## File map

### Rules to modify

- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/execution.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/verification.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/docs-sync.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/config-contract.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/gitnexus.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-otel.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-console.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/testing-architecture.md`

### Rule to re-check but likely keep unchanged

- Verify only: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/naming-and-dependencies.md`

### Audit and design references

- Read: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/specs/2026-04-15-rules-path-fix-design.md`

### Verification targets

- Test: `/root/git/knock/.claude/worktrees/unknown/src/config/config_example_test.ts`
- Test: `/root/git/knock/.claude/worktrees/unknown/src/config/load_config_test.ts`
- Verify: `/root/git/knock/.claude/worktrees/unknown/CLAUDE.md`
- Verify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/*.md`

## Task 1: Apply the broad engineering rule path fixes

**Files:**

- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/execution.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/verification.md`
- Verify only: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/naming-and-dependencies.md`

- [ ] **Step 1: Rewrite `execution.md` frontmatter to the audited target set**

Set `execution.md` frontmatter exactly to:

```markdown
---
paths:
  - 'src/**'
  - 'web/**'
  - 'scripts/**'
  - 'deno.json'
  - 'CLAUDE.md'
  - '.claude/rules/**'
---
```

Keep the body unchanged unless a direct wording conflict appears.

- [ ] **Step 2: Verify `execution.md` sample-path behavior against the new paths**

Check the intended outcomes:

```text
应命中: src/application/run_source_use_case.ts
应命中: web/routes/index.tsx
应命中: scripts/run-paths.sh
应命中: deno.json
应命中: CLAUDE.md
不应命中: docs/testing/risk-matrix.yml
不应命中: .claude/settings.json
应命中: .claude/rules/logging-otel.md
```

Expected: all positive and negative cases align with the audit direction.

- [ ] **Step 3: Rewrite `verification.md` frontmatter to the audited target set**

Set `verification.md` frontmatter exactly to:

```markdown
---
paths:
  - 'src/**'
  - 'web/**'
  - 'scripts/**'
  - 'deno.json'
  - 'README.md'
  - 'config.example.yml'
  - 'CLAUDE.md'
  - '.claude/rules/**'
---
```

Keep the body unchanged unless a direct wording conflict appears.

- [ ] **Step 4: Verify `verification.md` sample-path behavior against the new paths**

Check the intended outcomes:

```text
应命中: src/config/load_config.ts
应命中: README.md
应命中: config.example.yml
应命中: scripts/run-paths.sh
应命中: deno.json
应命中: .claude/rules/config-contract.md
不应命中: .claude/settings.json
不应命中: docs/superpowers/specs/2026-04-15-rules-path-audit-design.md
```

Expected: `.claude/settings.json` drops out; scripts and deno.json become covered.

- [ ] **Step 5: Re-check `naming-and-dependencies.md` and keep it unchanged unless the audit is disproved**

Re-verify these outcomes before deciding not to edit:

```text
应命中: src/core/logger.ts
应命中: web/routes/index.tsx
应命中: README.md
应命中: config.example.yml
应命中: CLAUDE.md
不应命中: docs/testing/risk-matrix.yml
```

Expected: current frontmatter still fits the rule; no edit needed.

- [ ] **Step 6: Run targeted formatting check for these three rule files**

Run: `deno task fmt:check .claude/rules/execution.md .claude/rules/verification.md .claude/rules/naming-and-dependencies.md`
Expected: PASS.

## Task 2: Apply the docs and config rule path fixes

**Files:**

- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/docs-sync.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/config-contract.md`

- [ ] **Step 1: Rewrite `docs-sync.md` frontmatter to the audited target set**

Set `docs-sync.md` frontmatter exactly to:

```markdown
---
paths:
  - 'README.md'
  - 'config.example.yml'
  - 'src/main.ts'
  - 'src/application/**'
  - 'src/interfaces/**'
  - 'src/config/**'
  - 'src/sources/**'
  - 'src/deliveries/**'
  - 'web/**'
---
```

Keep body unchanged unless a direct wording conflict appears.

- [ ] **Step 2: Verify `docs-sync.md` sample-path behavior**

Check:

```text
应命中: README.md
应命中: config.example.yml
应命中: src/config/schema.ts
应命中: web/routes/index.tsx
应命中: src/deliveries/http.ts
不应命中: .claude/settings.json
不应命中: src/core/logger.ts
```

Expected: docs/config and externally visible code surfaces remain covered; unrelated internals like `src/core/logger.ts` drop out.

- [ ] **Step 3: Rewrite `config-contract.md` frontmatter to the audited target set**

Set `config-contract.md` frontmatter exactly to:

```markdown
---
paths:
  - 'src/config/**'
  - 'src/interfaces/**'
  - 'src/main.ts'
  - 'config.example.yml'
  - 'README.md'
---
```

Keep body unchanged unless a direct wording conflict appears.

- [ ] **Step 4: Verify `config-contract.md` sample-path behavior**

Check:

```text
应命中: src/config/schema.ts
应命中: src/interfaces/config/load_definitions.ts
应命中: src/main.ts
应命中: config.example.yml
应命中: README.md
不应命中: src/deliveries/http.ts
不应命中: web/routes/index.tsx
```

Expected: the config-contract rule no longer follows broad `src/**` traffic.

- [ ] **Step 5: Run targeted formatting check for the two rule files**

Run: `deno task fmt:check .claude/rules/docs-sync.md .claude/rules/config-contract.md`
Expected: PASS.

## Task 3: Apply the GitNexus and logging-console path fixes

**Files:**

- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/gitnexus.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-console.md`

- [ ] **Step 1: Remove `gitnexus.md` frontmatter so it becomes unconditional**

Delete the entire YAML frontmatter block from `gitnexus.md` so the file starts directly with the GitNexus body.

Expected first lines:

```markdown
<!-- gitnexus:start -->

# GitNexus — Code Intelligence
```

Keep body unchanged unless a direct wording conflict appears.

- [ ] **Step 2: Verify `gitnexus.md` is now repo-wide and unconditional**

Check:

```text
应成立: 文件不再包含 `paths:` frontmatter
应成立: 文件仍位于 `.claude/rules/gitnexus.md`
应成立: 未新增根目录 GitNexus 文件
应成立: `CLAUDE.md` 未新增 `@import`
```

Expected: GitNexus guidance becomes repo-wide and always loaded, matching the final user decision.

- [ ] **Step 3: Rewrite `logging-console.md` frontmatter to the audited target set**

Set `logging-console.md` frontmatter exactly to:

```markdown
---
paths:
  - 'src/main.ts'
  - 'src/core/logger.ts'
  - 'src/core/logger_test.ts'
  - 'src/interfaces/daemon/**'
  - 'src/interfaces/web/**'
  - 'web/routes/**'
  - 'README.md'
  - 'config.example.yml'
---
```

If the rule body mentions a broader execution surface than “console display layer”, make only the smallest wording change needed to remove that direct conflict.

- [ ] **Step 4: Verify `logging-console.md` sample-path behavior**

Check:

```text
应命中: src/core/logger.ts
应命中: src/core/logger_test.ts
应命中: src/interfaces/daemon/start_daemon.ts
应命中: src/interfaces/web/preview_runtime.ts
应命中: web/routes/index.tsx
应命中: README.md
应命中: config.example.yml
不应命中: src/config/schema.ts
不应命中: src/deliveries/http.ts
```

Expected: broad unrelated core/delivery/config files no longer trigger the console-display rule.

- [ ] **Step 5: Run targeted formatting check for the two rule files**

Run: `deno task fmt:check .claude/rules/gitnexus.md .claude/rules/logging-console.md`
Expected: PASS.

## Task 4: Apply the logging and testing coverage expansions

**Files:**

- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-otel.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/testing-architecture.md`

- [ ] **Step 1: Rewrite `logging-otel.md` frontmatter to the expanded target set**

Set `logging-otel.md` frontmatter exactly to:

```markdown
---
paths:
  - 'src/main.ts'
  - 'src/application/**'
  - 'src/config/**'
  - 'src/core/**'
  - 'src/db/**'
  - 'src/deliveries/**'
  - 'src/infrastructure/**'
  - 'src/interfaces/**'
  - 'src/sources/**'
  - 'src/web/**'
  - 'web/**'
  - 'README.md'
  - 'config.example.yml'
---
```

Keep body unchanged unless a direct wording conflict appears.

- [ ] **Step 2: Verify `logging-otel.md` sample-path behavior**

Check:

```text
应命中: src/core/logger.ts
应命中: src/deliveries/http.ts
应命中: src/config/load_config.ts
应命中: src/infrastructure/deliveries/http_delivery_executor.ts
应命中: README.md
应命中: config.example.yml
不应命中: src/testing/risk_mapping_test.ts
```

Expected: missing real logging surfaces become covered without expanding into pure testing files.

- [ ] **Step 3: Rewrite `testing-architecture.md` frontmatter to the expanded target set**

Set `testing-architecture.md` frontmatter exactly to:

```markdown
---
paths:
  - 'src/testing/**'
  - 'src/**/*test.ts'
  - 'web/**/*test.ts'
  - 'web/**/*test.tsx'
  - 'docs/testing/**'
  - '.claude/settings.json'
  - '.claude/skills/test-architecture-guard/**'
  - 'scripts/run-paths.sh'
---
```

Keep body unchanged unless a direct wording conflict appears.

- [ ] **Step 4: Verify `testing-architecture.md` sample-path behavior**

Check:

```text
应命中: src/testing/risk_mapping.ts
应命中: src/testing/risk_mapping_test.ts
应命中: web/routes/index_test.ts
应命中: docs/testing/risk-matrix.yml
应命中: .claude/settings.json
应命中: .claude/skills/test-architecture-guard/SKILL.md
应命中: scripts/run-paths.sh
不应命中: src/core/logger.ts
```

Expected: the rule now covers test infrastructure and guard implementation paths.

- [ ] **Step 5: Run targeted formatting check for the two rule files**

Run: `deno task fmt:check .claude/rules/logging-otel.md .claude/rules/testing-architecture.md`
Expected: PASS.

## Task 5: Run document-contract regression tests and adjust only if evidence demands it

**Files:**

- Modify if needed: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/*.md`
- Test: `/root/git/knock/.claude/worktrees/unknown/src/config/config_example_test.ts`
- Test: `/root/git/knock/.claude/worktrees/unknown/src/config/load_config_test.ts`

- [ ] **Step 1: Run the document-contract regression tests after the path changes**

Run: `deno task test src/config/config_example_test.ts src/config/load_config_test.ts`
Expected: PASS.

- [ ] **Step 2: If these tests fail, stop and identify whether the failure comes from body/path mismatch**

If red, read the failure output completely and isolate the exact rule file or wording that conflicts with the new path surface. Do not make broad rewrites.

Expected: either no failure, or one isolated minimal correction target.

- [ ] **Step 3: Apply only the smallest body correction if a direct conflict is proven**

A permitted example is narrowing wording like “广域全仓规则” if the new frontmatter has been intentionally reduced to a subdomain. Do not change behavior, examples, or unrelated prose.

Expected: any body edit is directly traceable to a failing regression or a direct path/body contradiction.

- [ ] **Step 4: Re-run the same targeted regression tests**

Run: `deno task test src/config/config_example_test.ts src/config/load_config_test.ts`
Expected: PASS.

## Task 6: Run full verification and summarize the landing adjustments

**Files:**

- Verify: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/*.md`
- Verify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`
- Verify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/specs/2026-04-15-rules-path-fix-design.md`
- Verify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/plans/2026-04-15-rules-path-fix.md`

- [ ] **Step 1: Verify the final rules loading state**

Run: `python - <<'PY'
from pathlib import Path
root = Path('.claude/rules')
for name in ['execution.md','verification.md','docs-sync.md','config-contract.md','gitnexus.md','logging-otel.md','logging-console.md','testing-architecture.md','naming-and-dependencies.md']:
    text = (root / name).read_text()
    state = 'frontmatter' if text.startswith('---\n') else 'no-frontmatter'
    print(name, state)
PY`
Expected:

- `gitnexus.md` => `no-frontmatter`
- the other 8 rule files => `frontmatter`

- [ ] **Step 2: Run repo-scoped formatting checks for all touched design/audit/rule files**

Run: `deno task fmt:check .claude/rules/execution.md .claude/rules/verification.md .claude/rules/docs-sync.md .claude/rules/config-contract.md .claude/rules/gitnexus.md .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/rules/testing-architecture.md .claude/rules/naming-and-dependencies.md docs/superpowers/specs/2026-04-15-rules-path-fix-design.md docs/superpowers/plans/2026-04-15-rules-path-fix.md docs/superpowers/audits/2026-04-15-rules-path-audit.md`
Expected: PASS.

- [ ] **Step 3: Run the full repository test suite**

Run: `deno task test`
Expected: PASS with 0 failures.

- [ ] **Step 4: Review the final diff to confirm the intended scope**

Run: `git diff -- .claude/rules docs/superpowers/specs/2026-04-15-rules-path-fix-design.md docs/superpowers/plans/2026-04-15-rules-path-fix.md docs/superpowers/audits/2026-04-15-rules-path-audit.md`
Expected: 8 rule files changed, `naming-and-dependencies.md` either unchanged or unchanged after re-check, and only minimal body edits if directly justified.

- [ ] **Step 5: Write a landing summary block into your final handoff notes**

Prepare to report:

```text
- Modified rules: <8 files>
- Unchanged rule: naming-and-dependencies.md
- Body tweaks: <none or exact files + reason>
- Verification: <commands run>
- Audit suggestions adjusted during landing: <exact deviations or none>
```

Expected: exact final accounting is available before any commit/branch-finish step.

## Self-review

### Spec coverage

- 9 rule files covered: Tasks 1-4 and Task 6 Step 1.
- Audit-as-default with small second-pass correction: built into Tasks 1-4.
- Minimal body edits only when directly justified: Task 5.
- Sample-path verification and regression tests: Tasks 1-5.
- Full suite validation and final accounting: Task 6.

### Placeholder scan

- No `TODO`, `TBD`, or deferred wording remains.
- Every file path is concrete.
- Every verification step includes an exact command and expected result.

### Type consistency

- `naming-and-dependencies.md` is consistently treated as the re-check/no-change rule.
- `gitnexus.md` is consistently treated as the repo-wide unconditional exception.
- The other 7 path-adjusted rule files remain frontmatter-based targets.

Plan complete and saved to `docs/superpowers/plans/2026-04-15-rules-path-fix.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
