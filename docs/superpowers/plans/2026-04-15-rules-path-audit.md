# Rules Path Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit every `.claude/rules/*.md` `paths:` glob for syntax validity and semantic coverage, then produce a recommendation report with concrete replacement globs where needed.

**Architecture:** Treat this as an audit artifact, not a behavior change. The implementation reads the current rule files, tests each glob against representative path samples, compares matches to each rule's intended responsibility, and writes a structured audit report that classifies each rule as correct, too broad, too narrow, misaligned, or needing split. No rule files are modified in this plan.

**Tech Stack:** Claude Code project rules, Markdown, shell verification commands, repo documentation

---

## File map

### Inputs

- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/execution.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/verification.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/docs-sync.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/config-contract.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/naming-and-dependencies.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/gitnexus.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-otel.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-console.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/testing-architecture.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/CLAUDE.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/specs/2026-04-15-rules-path-audit-design.md`

### Output

- Create: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`

## Task 1: Freeze the audit inputs and extract the current path matrix

**Files:**

- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/*.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/CLAUDE.md`
- Create later: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`

- [ ] **Step 1: List the target rule files that will be audited**

Run: `printf '%s
' .claude/rules/execution.md .claude/rules/verification.md .claude/rules/docs-sync.md .claude/rules/config-contract.md .claude/rules/naming-and-dependencies.md .claude/rules/gitnexus.md .claude/rules/logging-otel.md .claude/rules/logging-console.md .claude/rules/testing-architecture.md`
Expected: exactly 9 rule file paths printed.

- [ ] **Step 2: Capture the current `paths:` blocks from all 9 rules**

Run: `grep -nE '^---$|^paths:|^  - ' .claude/rules/*.md`
Expected: every rule file shows a frontmatter block with one `paths:` key and one or more path entries.

- [ ] **Step 3: Verify there are exactly 9 rule files under `.claude/rules`**

Run: `ls .claude/rules/*.md | wc -l`
Expected: `9`

- [ ] **Step 4: Record the repo-level top-surface boundary used by the audit**

Read `CLAUDE.md` and confirm it still says detailed rules should live in `.claude/rules/*.md`, with only thin-entry constraints at top level.

```markdown
- 细节规则 **SHOULD** 放在 `.claude/rules/*.md`；本文件只保留顶层项目约束。
```

Expected: this sentence or equivalent remains present.

- [ ] **Step 5: Create the audit report header**

Start `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md` with:

```markdown
# Rules Path Audit

日期：2026-04-15  
范围：`.claude/rules/*.md`

## 审计口径

- 语法：Claude Code `paths:` frontmatter 是否有效
- 语义：命中范围是否与 rule 主题一致
- 策略：偏收紧，优先减少无关命中
```

````

## Task 2: Build syntax and semantic audit criteria with explicit path samples

**Files:**
- Modify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/specs/2026-04-15-rules-path-audit-design.md`

- [ ] **Step 1: Add the classification table skeleton to the audit report**

Append this exact table header to the report:

```markdown
## 审计总表

| rule | 当前 paths | 语法判断 | 语义判断 | 主要问题 | 建议 paths |
| --- | --- | --- | --- | --- | --- |
````

- [ ] **Step 2: Add the risk classification legend**

Append:

```markdown
## 风险分类

- `正确`
- `应收紧`
- `应放宽`
- `应移除某些路径`
- `应拆分`

风险标签：`过宽` / `过窄` / `错位` / `重复`
```

- [ ] **Step 3: Add the sample-path evaluation template**

Append:

```markdown
## 单项审计模板

### <rule-name>

- 应命中：
- 不应命中：
- 边界样本：
- 结论：
- 建议：
```

- [ ] **Step 4: Seed representative sample paths for docs/config/top-surface cases**

Append these sample rows under a `## 样本路径基线` section:

```markdown
- `README.md`
- `config.example.yml`
- `CLAUDE.md`
- `.claude/settings.json`
- `.claude/hooks/fmt.sh`
- `docs/testing/risk-matrix.yml`
- `docs/superpowers/specs/2026-04-15-rules-path-audit-design.md`
- `src/config/schema.ts`
- `src/core/logger.ts`
- `src/testing/risk_mapping_test.ts`
- `web/routes/index.tsx`
```

- [ ] **Step 5: Verify the audit document now contains the evaluation scaffolding**

Run: `grep -nE '审计总表|风险分类|单项审计模板|样本路径基线' docs/superpowers/audits/2026-04-15-rules-path-audit.md`
Expected: all 4 section labels are found.

## Task 3: Audit the broad engineering rules

**Files:**

- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/execution.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/verification.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/naming-and-dependencies.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`

- [ ] **Step 1: Audit `execution.md` against representative paths**

Evaluate at least these paths:

```text
应命中: src/application/run_source_use_case.ts
应命中: web/routes/index.tsx
不应命中: docs/testing/risk-matrix.yml
边界样本: .claude/settings.json
边界样本: CLAUDE.md
```

Record whether `.claude/**` and `CLAUDE.md` are justified or too broad.

- [ ] **Step 2: Audit `verification.md` against representative paths**

Evaluate at least these paths:

```text
应命中: src/config/load_config.ts
应命中: README.md
应命中: config.example.yml
不应命中: docs/superpowers/specs/2026-04-15-rules-path-audit-design.md
边界样本: .claude/settings.json
```

Record whether `.claude/**` is justified or too broad.

- [ ] **Step 3: Audit `naming-and-dependencies.md` against representative paths**

Evaluate at least these paths:

```text
应命中: src/core/logger.ts
应命中: web/routes/index.tsx
应命中: README.md
不应命中: docs/testing/risk-matrix.yml
边界样本: CLAUDE.md
```

Record whether the rule is appropriately broad or should be narrowed.

- [ ] **Step 4: Write the three audit rows into the summary table**

Add one row each for `execution.md`, `verification.md`, and `naming-and-dependencies.md`, filling all six columns with concrete findings.

- [ ] **Step 5: Verify these three rows are present**

Run: `grep -nE 'execution\.md|verification\.md|naming-and-dependencies\.md' docs/superpowers/audits/2026-04-15-rules-path-audit.md`
Expected: all three row identifiers are found.

## Task 4: Audit the config/docs/navigation rules

**Files:**

- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/docs-sync.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/config-contract.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/gitnexus.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`

- [ ] **Step 1: Audit `docs-sync.md`**

Evaluate at least:

```text
应命中: README.md
应命中: config.example.yml
边界样本: src/config/schema.ts
边界样本: web/routes/index.tsx
不应命中: .claude/settings.json
```

Determine whether `src/**` / `web/**` is appropriately broad or should be narrowed.

- [ ] **Step 2: Audit `config-contract.md`**

Evaluate at least:

```text
应命中: src/config/schema.ts
应命中: config.example.yml
应命中: README.md
边界样本: src/deliveries/http.ts
不应命中: web/routes/index.tsx
```

Determine whether `src/**` is too broad and whether `src/config/**` plus docs/config paths is enough.

- [ ] **Step 3: Audit `gitnexus.md`**

Evaluate at least:

```text
应命中: src/core/logger.ts
应命中: web/routes/index.tsx
边界样本: CLAUDE.md
边界样本: .claude/settings.json
不应命中: README.md
```

Determine whether `CLAUDE.md` and `.claude/**` are justified or too broad.

- [ ] **Step 4: Write the three audit rows into the summary table**

Add rows for `docs-sync.md`, `config-contract.md`, and `gitnexus.md` with concrete recommended path sets.

- [ ] **Step 5: Verify these three rows are present**

Run: `grep -nE 'docs-sync\.md|config-contract\.md|gitnexus\.md' docs/superpowers/audits/2026-04-15-rules-path-audit.md`
Expected: all three row identifiers are found.

## Task 5: Audit the logging and testing rules

**Files:**

- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-otel.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/logging-console.md`
- Read: `/root/git/knock/.claude/worktrees/unknown/.claude/rules/testing-architecture.md`
- Modify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`

- [ ] **Step 1: Audit `logging-otel.md`**

Evaluate at least:

```text
应命中: src/core/logger.ts
应命中: src/deliveries/http.ts
应命中: README.md
边界样本: config.example.yml
不应命中: src/testing/risk_mapping_test.ts
```

Determine whether docs/config paths are justified.

- [ ] **Step 2: Audit `logging-console.md`**

Evaluate at least:

```text
应命中: src/core/logger.ts
应命中: web/routes/index.tsx
边界样本: README.md
边界样本: config.example.yml
不应命中: src/config/schema.ts
```

Determine whether docs/config paths are justified and whether the code surface is too broad or too narrow.

- [ ] **Step 3: Audit `testing-architecture.md`**

Evaluate at least:

```text
应命中: src/testing/risk_mapping_test.ts
应命中: web/routes/index_test.ts
应命中: docs/testing/risk-matrix.yml
应命中: .claude/settings.json
边界样本: scripts/run-paths.sh
不应命中: src/core/logger.ts
```

Determine whether any test infrastructure paths are missing.

- [ ] **Step 4: Write the three audit rows into the summary table**

Add rows for `logging-otel.md`, `logging-console.md`, and `testing-architecture.md`.

- [ ] **Step 5: Verify these three rows are present**

Run: `grep -nE 'logging-otel\.md|logging-console\.md|testing-architecture\.md' docs/superpowers/audits/2026-04-15-rules-path-audit.md`
Expected: all three row identifiers are found.

## Task 6: Produce final recommendations and validate the audit artifact

**Files:**

- Modify: `/root/git/knock/.claude/worktrees/unknown/docs/superpowers/audits/2026-04-15-rules-path-audit.md`

- [ ] **Step 1: Add a final recommendation section grouped by priority**

Append:

```markdown
## 总建议

### 无需修改

- <rule list>

### 建议修改

- <rule list>

### 应立即修改

- <rule list>
```

Fill the lists with concrete rule filenames, not placeholders.

- [ ] **Step 2: Add explicit notes for syntax-vs-semantics splits**

Append a short section like:

```markdown
## 额外说明

- 语法正确但语义过宽：...
- 合理重叠：...
- 为避免漏触发而保留稍宽匹配：...
```

Use concrete rule names.

- [ ] **Step 3: Verify the report covers all 9 rule files exactly once in the summary table**

Run: `grep -oE '[a-z-]+\.md' docs/superpowers/audits/2026-04-15-rules-path-audit.md | sort | uniq -c`
Expected: the 9 audited rule filenames appear in the report, with no missing target rule.

- [ ] **Step 4: Run formatting check on the audit spec and plan files**

Run: `deno task fmt:check docs/superpowers/specs/2026-04-15-rules-path-audit-design.md docs/superpowers/plans/2026-04-15-rules-path-audit.md docs/superpowers/audits/2026-04-15-rules-path-audit.md`
Expected: PASS.

- [ ] **Step 5: Review the final diff for audit-only scope**

Run: `git diff -- docs/superpowers/specs/2026-04-15-rules-path-audit-design.md docs/superpowers/plans/2026-04-15-rules-path-audit.md docs/superpowers/audits/2026-04-15-rules-path-audit.md`
Expected: only audit documents changed; no rule files modified.

- [ ] **Step 6: Commit the audit artifacts**

```bash
git add docs/superpowers/specs/2026-04-15-rules-path-audit-design.md docs/superpowers/plans/2026-04-15-rules-path-audit.md docs/superpowers/audits/2026-04-15-rules-path-audit.md
git commit -m "docs: audit rules path matching"
```

## Self-review

### Spec coverage

- 9-rule full audit coverage: Tasks 3, 4, 5.
- Syntax and semantic review both covered: Tasks 1-5.
- Sample-path evidence per rule: Tasks 3-5.
- Final grouped recommendations: Task 6.
- No direct rule edits: enforced by Task 6 Step 5.

### Placeholder scan

- No `TODO`, `TBD`, or deferred wording remains.
- Every file path is exact.
- Every verification step includes an exact command and expected result.

### Type consistency

- Audit target filenames are consistent across all tasks.
- Output artifact path is consistent: `docs/superpowers/audits/2026-04-15-rules-path-audit.md`.
- Classification labels are consistent: `正确`, `应收紧`, `应放宽`, `应移除某些路径`, `应拆分`.

Plan complete and saved to `docs/superpowers/plans/2026-04-15-rules-path-audit.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
