# Test Architecture Hard Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性完成全仓测试三层化（unit/contract/flow）、冻结 R01-R20 风险矩阵、落地 `test-architecture-guard` 硬门禁，并产出可量化验收指标。

**Architecture:** 先建立统一测试基础设施与风险矩阵单一事实源，再按业务域原子迁移测试到三层模型，同时强制 flow 风险 ID 映射与高风险 contract 映射。最后把门禁 skill 与仓库规则接入，形成“改测试即校验”的自动执行链，并通过 scoped + 全量组合验证完成收口。

**Tech Stack:** Deno、TypeScript、现有 `deno task` 工具链、Claude Code skills/rules、仓库现有测试框架与断言库。

---

## Scope Check

本次范围聚焦单一子系统：测试架构治理（结构、矩阵、门禁、验证）。它和业务功能开发解耦，可以独立交付并立即生效。

## File Structure

### Create

- `docs/testing/risk-matrix.yml` — 冻结 R01-R20，定义 `domain/trigger/expected_guardrail/required_layer/owner_tests`。
- `.claude/rules/testing-architecture.md` — 项目级强约束：三层模型、命名、映射、验证与阻断规则。
- `.claude/skills/test-architecture-guard/SKILL.md` — 门禁 skill 入口与流程规范。
- `.claude/skills/test-architecture-guard/scripts/guard.ts` — 门禁脚本，执行触发检测、规则校验、验证命令与报告输出。
- `.claude/skills/test-architecture-guard/scripts/guard_test.ts` — 门禁脚本测试。
- `src/testing/runtime_harness.ts` — 统一 runtime 生命周期管理。
- `src/testing/fixture_factory.ts` — 统一 fixture 构造器。
- `src/testing/assertion_kit.ts` — 统一断言入口。
- `src/testing/scenario_runner.ts` — flow 场景驱动器。
- `src/testing/risk_mapping.ts` — 风险映射读取/校验工具。
- `src/testing/*_test.ts` — 以上基础设施测试。
- `docs/testing/migration-report-template.md` — 迁移报告模板（指标、验证结果、剩余风险）。

### Modify

- `src/**/_test.ts`（按域分批）— 迁移为 `unit/contract/flow` 语义并接入共享测试工具。
- `src/test_runtime.ts` — 兼容迁移入口或替换为 `runtime_harness.ts` 薄转发。
- `.claude/settings.json` — 配置测试改动默认触发 `test-architecture-guard`（保持已有 hook 行为）。
- `CLAUDE.md`（仓库根）— 增补测试规范入口索引（只补充已实现内容）。

### Test

- `src/testing/runtime_harness_test.ts`
- `src/testing/fixture_factory_test.ts`
- `src/testing/assertion_kit_test.ts`
- `src/testing/scenario_runner_test.ts`
- `src/testing/risk_mapping_test.ts`
- `.claude/skills/test-architecture-guard/scripts/guard_test.ts`
- 各业务域迁移后的 scoped 测试文件

---

### Task 1: 冻结风险矩阵与规则骨架

**Files:**

- Create: `docs/testing/risk-matrix.yml`
- Create: `.claude/rules/testing-architecture.md`
- Test: `src/testing/risk_mapping_test.ts`

- [ ] **Step 1: 写风险矩阵读取失败测试**

```ts
import { assertEquals } from '@std/assert'
import { loadRiskMatrix } from './risk_mapping.ts'

Deno.test('risk-mapping: 应读取并返回 20 条冻结风险', async () => {
  const matrix = await loadRiskMatrix('docs/testing/risk-matrix.yml')
  assertEquals(matrix.length, 20)
  assertEquals(matrix[0].id, 'R01')
  assertEquals(matrix[19].id, 'R20')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `deno task test src/testing/risk_mapping_test.ts`  
Expected: FAIL，`risk_mapping.ts` 或 `risk-matrix.yml` 不存在。

- [ ] **Step 3: 写最小风险矩阵与加载器实现**

```yml
# docs/testing/risk-matrix.yml
- id: R01
  domain: source
  trigger: source fetch timeout
  expected_guardrail: run marked failed with actionable reason
  required_layer: flow+contract
  owner_tests:
    - src/sources/syndication_test.ts
# ... R02-R19 ...
- id: R20
  domain: web
  trigger: playground evaluate malformed input
  expected_guardrail: stable error contract and no side effects
  required_layer: contract
  owner_tests:
    - web/routes/api/xquery/evaluate_test.ts
```

```ts
export interface RiskRule {
  id: string
  domain: string
  trigger: string
  expected_guardrail: string
  required_layer: 'unit' | 'contract' | 'flow' | 'flow+contract'
  owner_tests: string[]
}

export async function loadRiskMatrix(path: string): Promise<RiskRule[]> {
  const text = await Deno.readTextFile(path)
  const data = parseYaml(text) as RiskRule[]
  if (data.length !== 20) throw new Error('风险矩阵必须固定为20条')
  return data
}
```

- [ ] **Step 4: 写测试规则文档**

```md
# testing-architecture

- 测试分层 MUST 使用 unit/contract/flow
- flow 用例 MUST 绑定风险 ID（R01-R20）
- required_layer=flow+contract 的风险，contract 测试 MUST 有映射
- unit 测试 MAY 不绑定风险 ID
- 改动命中测试相关文件 MUST 触发硬门禁
- 命中共享高风险边界 MUST 追加全量 deno task test
```

- [ ] **Step 5: 运行验证**

Run: `deno task test src/testing/risk_mapping_test.ts && deno task check src/testing && deno task fmt:check docs/testing/risk-matrix.yml .claude/rules/testing-architecture.md`  
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add docs/testing/risk-matrix.yml .claude/rules/testing-architecture.md src/testing/risk_mapping.ts src/testing/risk_mapping_test.ts
git commit -m "test: freeze R01-R20 risk matrix and rules"
```

### Task 2: 建立共享测试基础设施（Harness/Factory/Assertion/Runner）

**Files:**

- Create: `src/testing/runtime_harness.ts`
- Create: `src/testing/fixture_factory.ts`
- Create: `src/testing/assertion_kit.ts`
- Create: `src/testing/scenario_runner.ts`
- Test: `src/testing/runtime_harness_test.ts`
- Test: `src/testing/fixture_factory_test.ts`
- Test: `src/testing/assertion_kit_test.ts`
- Test: `src/testing/scenario_runner_test.ts`
- Modify: `src/test_runtime.ts`

- [ ] **Step 1: 写 runtime harness 失败测试**

```ts
import { assertEquals } from '@std/assert'
import { withRuntimeHarness } from './runtime_harness.ts'

Deno.test('runtime-harness: 应自动 prepare 与 cleanup', async () => {
  let existsDuringRun = false
  await withRuntimeHarness(async ({ runtimeDir }) => {
    existsDuringRun = await exists(runtimeDir)
  })
  assertEquals(existsDuringRun, true)
})
```

- [ ] **Step 2: 写 fixture/assertion/runner 失败测试**

```ts
Deno.test('fixture-factory: 默认 source fixture 可直接用于测试', () => {
  const fixture = createSourceFixture()
  assertEquals(typeof fixture.id, 'string')
})

Deno.test('assertion-kit: 应断言错误类别与关键字段', () => {
  assertErrorShape(new Error('boom'), { messageIncludes: 'boom' })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `deno task test src/testing/runtime_harness_test.ts src/testing/fixture_factory_test.ts src/testing/assertion_kit_test.ts src/testing/scenario_runner_test.ts`  
Expected: FAIL。

- [ ] **Step 4: 实现最小共享测试组件**

```ts
export async function withRuntimeHarness<T>(
  run: (ctx: { runtimeDir: string }) => Promise<T>,
): Promise<T> {
  const runtimeDir = await Deno.makeTempDir({ prefix: 'knock-test-' })
  await emptyDir(runtimeDir)
  try {
    return await run({ runtimeDir })
  } finally {
    await Deno.remove(runtimeDir, { recursive: true })
  }
}
```

```ts
export function createSourceFixture(
  overrides: Partial<SourceFixture> = {},
): SourceFixture {
  return {
    id: 'source-default',
    type: 'syndication',
    url: 'https://example.com/feed.xml',
    ...overrides,
  }
}
```

- [ ] **Step 5: 兼容 `src/test_runtime.ts`**

```ts
export { withRuntimeHarness as withOwnedRuntime } from './testing/runtime_harness.ts'
```

- [ ] **Step 6: 运行验证**

Run: `deno task test src/testing && deno task check src/testing src/test_runtime.ts`  
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/testing src/test_runtime.ts
git commit -m "test: add shared test harness and fixtures"
```

### Task 3: 落地硬门禁 skill（test-architecture-guard）

**Files:**

- Create: `.claude/skills/test-architecture-guard/SKILL.md`
- Create: `.claude/skills/test-architecture-guard/scripts/guard.ts`
- Create: `.claude/skills/test-architecture-guard/scripts/guard_test.ts`
- Modify: `.claude/settings.json`

- [ ] **Step 1: 写门禁脚本失败测试**

```ts
import { assertEquals } from '@std/assert'
import { runGuard } from './guard.ts'

Deno.test('guard: flow 测试缺风险ID应阻断', async () => {
  const result = await runGuard({
    changedPaths: ['src/core/logger_test.ts'],
    checkRiskMapping: async () => ({ ok: false, missing: ['R07'] }),
  })
  assertEquals(result.gate, 'blocked')
  assertEquals(result.failed_checks.includes('risk_mapping'), true)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `deno task test .claude/skills/test-architecture-guard/scripts/guard_test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 guard 核心逻辑**

```ts
export interface GuardResult {
  gate: 'passed' | 'blocked'
  failed_checks: string[]
  actionable_fix: string[]
  related_paths: string[]
}

export async function runGuard(input: GuardInput): Promise<GuardResult> {
  const failed: string[] = []
  const fixes: string[] = []

  const risk = await input.checkRiskMapping()
  if (!risk.ok) {
    failed.push('risk_mapping')
    fixes.push(`补齐风险映射: ${risk.missing.join(', ')}`)
  }

  const shared = await input.checkSharedEntrypoint()
  if (!shared.ok) {
    failed.push('shared_test_components')
    fixes.push('替换自建 setup，统一使用 src/testing/*')
  }

  return {
    gate: failed.length === 0 ? 'passed' : 'blocked',
    failed_checks: failed,
    actionable_fix: fixes,
    related_paths: input.changedPaths,
  }
}
```

- [ ] **Step 4: 写 skill 规范文件**

```md
---
name: test-architecture-guard
description: 测试改动硬门禁；检查风险映射、共享入口、验证命令与高风险边界全量测试。
---

1. 识别改动路径
2. 校验 flow/contract 风险映射
3. 校验共享测试组件入口
4. 运行 scoped 验证
5. 命中高风险边界时运行 deno task test
6. 输出 gate 报告
```

- [ ] **Step 5: 配置默认触发**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": ".claude/hooks/fmt.sh" },
          {
            "type": "command",
            "command": "deno run --allow-read --allow-run .claude/skills/test-architecture-guard/scripts/guard.ts"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: 运行验证**

Run: `deno task test .claude/skills/test-architecture-guard/scripts/guard_test.ts && deno task check .claude/skills/test-architecture-guard/scripts`  
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add .claude/skills/test-architecture-guard .claude/settings.json
git commit -m "chore: add test architecture hard gate skill"
```

### Task 4: 迁移 config/domain/core 测试为三层模型（原子提交 1）

**Files:**

- Modify: `src/config/*_test.ts`
- Modify: `src/domain/*_test.ts`
- Modify: `src/core/*_test.ts`
- Test: `src/config/*_test.ts`
- Test: `src/domain/*_test.ts`
- Test: `src/core/*_test.ts`

- [ ] **Step 1: 先写一个 flow 映射失败样例**

```ts
Deno.test(
  '[flow] R03 config parse failure surfaces actionable error',
  async () => {
    // 使用 scenario runner + fixture factory
  },
)
```

- [ ] **Step 2: 运行目标测试确认失败**

Run: `deno task test src/config src/domain src/core`  
Expected: FAIL（新分层命名、风险映射或共享组件尚未齐备）。

- [ ] **Step 3: 迁移为三层并接入共享组件**

```ts
// 示例：src/core/logger_test.ts
Deno.test(
  '[contract] R11 logger emits otel severity and scope fields',
  async () => {
    const fixture = createLogFixture({ severity: 'error' })
    const record = emitLog(fixture)
    assertOtelRecordShape(record, {
      severityText: 'ERROR',
      requiredFields: ['scope.name', 'body'],
    })
  },
)
```

- [ ] **Step 4: 为 flow/high-risk-contract 补风险 ID**

```ts
// [flow] R07 delivery retry exhausted persists failed attempt
// [contract] R11 logger emits otel severity and scope fields
```

- [ ] **Step 5: 运行 scoped 验证**

Run: `deno task test src/config src/domain src/core && deno task check src/config src/domain src/core && deno task lint:check src/config src/domain src/core && deno task fmt:check src/config src/domain src/core`  
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/config src/domain src/core
git commit -m "test: migrate config domain core tests to layered model"
```

### Task 5: 迁移 application/sources/deliveries/infrastructure 测试为三层模型（原子提交 2）

**Files:**

- Modify: `src/application/**/*_test.ts`
- Modify: `src/sources/*_test.ts`
- Modify: `src/deliveries/*_test.ts`
- Modify: `src/infrastructure/**/*_test.ts`

- [ ] **Step 1: 写 flow 风险映射失败测试**

```ts
Deno.test(
  '[flow] R07 delivery retry exhausted marks attempt failed',
  async () => {
    // first red
  },
)
```

- [ ] **Step 2: 运行目标测试确认失败**

Run: `deno task test src/application src/sources src/deliveries src/infrastructure`  
Expected: FAIL。

- [ ] **Step 3: 批量迁移测试结构与命名**

```ts
Deno.test('[unit] delivery executor maps channel correctly', () => {
  // pure mapping assertions
})

Deno.test(
  '[contract] R14 source parser returns stable diagnostics shape',
  async () => {
    // contract assertions
  },
)

Deno.test(
  '[flow] R07 delivery retry exhausted marks attempt failed',
  async () => {
    // scenario runner based flow
  },
)
```

- [ ] **Step 4: 接入 guard 需要的映射注释/元数据**

```ts
// risk-id: R07
// layer: flow
```

- [ ] **Step 5: 运行 scoped 验证**

Run: `deno task test src/application src/sources src/deliveries src/infrastructure && deno task check src/application src/sources src/deliveries src/infrastructure && deno task lint:check src/application src/sources src/deliveries src/infrastructure && deno task fmt:check src/application src/sources src/deliveries src/infrastructure`  
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/application src/sources src/deliveries src/infrastructure
git commit -m "test: migrate app source delivery infra tests to layered model"
```

### Task 6: 迁移 interfaces/web/main 测试并完成全仓映射闭环（原子提交 3）

**Files:**

- Modify: `src/interfaces/**/*_test.ts`
- Modify: `src/main_test.ts`
- Modify: `src/web/*_test.ts`
- Modify: `web/**/*_test.ts`
- Modify: `docs/testing/risk-matrix.yml`

- [ ] **Step 1: 写 web/cli flow 映射失败测试**

```ts
Deno.test(
  '[flow] R20 playground malformed input keeps error contract stable',
  async () => {
    // first red
  },
)
```

- [ ] **Step 2: 运行目标测试确认失败**

Run: `deno task test src/interfaces src/main_test.ts src/web web`  
Expected: FAIL。

- [ ] **Step 3: 迁移并补齐映射**

```yml
- id: R20
  owner_tests:
    - web/routes/api/xquery/evaluate_test.ts
    - web/routes/api/syndication/evaluate_test.ts
```

- [ ] **Step 4: 校验 R01-R20 owner_tests 全存在**

Run: `deno run --allow-read .claude/skills/test-architecture-guard/scripts/guard.ts --check-risk-files`  
Expected: PASS，报告 `missing_owner_tests=[]`。

- [ ] **Step 5: 运行 scoped 验证**

Run: `deno task test src/interfaces src/main_test.ts src/web web && deno task check src/interfaces src/main.ts src/web web && deno task lint:check src/interfaces src/main_test.ts src/web web && deno task fmt:check src/interfaces src/main_test.ts src/web web docs/testing/risk-matrix.yml`  
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/interfaces src/main_test.ts src/web web docs/testing/risk-matrix.yml
git commit -m "test: migrate interfaces and web tests with risk closure"
```

### Task 7: 接入高风险边界全量验证与迁移报告

**Files:**

- Create: `docs/testing/migration-report-template.md`
- Create: `docs/testing/migration-report-2026-04-14.md`
- Modify: `.claude/skills/test-architecture-guard/scripts/guard.ts`

- [ ] **Step 1: 为 guard 增加高风险边界判定测试**

```ts
Deno.test('guard: touching src/main.ts requires full test run', async () => {
  const result = await runGuard({ changedPaths: ['src/main.ts'], ...mocks })
  assertEquals(result.failed_checks.includes('full_test_required'), false)
  assertEquals(result.executed_commands.includes('deno task test'), true)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `deno task test .claude/skills/test-architecture-guard/scripts/guard_test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现高风险边界命中逻辑**

```ts
const FULL_TEST_BOUNDARIES = new Set([
  'deno.json',
  'src/main.ts',
  'src/core/app.ts',
  'src/db/client.ts',
  'src/db/schema.ts',
  'src/db/migrations/',
  'src/sources/xquery.ts',
  'src/sources/source_runtime.ts',
])
```

- [ ] **Step 4: 生成迁移报告模板与实例**

```md
## Metrics

- R01-R20 coverage: 20/20
- Layered pass rate: unit/contract/flow = 100%
- Scoped test latency: P50=, P90=

## Verification Commands

- [x] deno task test <scoped...>
- [x] deno task check <scoped...>
- [x] deno task lint:check <scoped...>
- [x] deno task fmt:check <scoped...>
- [x] deno task test (full; boundary hit)
```

- [ ] **Step 5: 运行验证**

Run: `deno task test .claude/skills/test-architecture-guard/scripts/guard_test.ts && deno task check .claude/skills/test-architecture-guard/scripts && deno task fmt:check docs/testing/migration-report-template.md docs/testing/migration-report-2026-04-14.md`  
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add .claude/skills/test-architecture-guard/scripts/guard.ts .claude/skills/test-architecture-guard/scripts/guard_test.ts docs/testing/migration-report-template.md docs/testing/migration-report-2026-04-14.md
git commit -m "test: enforce full-test boundaries and add migration report"
```

### Task 8: 全仓最终验证与文档收口

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-04-14-test-architecture-hard-gate-design.md`（仅在实现差异需要回写时）
- Modify: `docs/superpowers/plans/2026-04-14-test-architecture-hard-gate.md`（勾选执行记录）

- [ ] **Step 1: 跑全仓最终验证命令**

Run: `deno task test && deno task check && deno task lint:check && deno task fmt:check`  
Expected: PASS。

- [ ] **Step 2: 运行硬门禁回归演练**

Run: `deno run --allow-read --allow-run .claude/skills/test-architecture-guard/scripts/guard.ts --changed src/core/logger_test.ts`  
Expected: `gate=passed` 且输出完整报告结构。

- [ ] **Step 3: 更新仓库入口说明**

```md
## Testing Architecture

- 风险矩阵：`docs/testing/risk-matrix.yml`
- 规则：`.claude/rules/testing-architecture.md`
- 门禁 skill：`.claude/skills/test-architecture-guard/SKILL.md`
```

- [ ] **Step 4: 提交最终收口**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-04-14-test-architecture-hard-gate-design.md docs/superpowers/plans/2026-04-14-test-architecture-hard-gate.md
git commit -m "docs: finalize test architecture governance entrypoints"
```

---

## Acceptance Metrics (Gate to Close)

1. **R01-R20 覆盖率**：`20/20`，每条均有 `owner_tests`。
2. **分层测试通过率**：`unit/contract/flow` 全通过。
3. **Scoped 执行效率**：输出 P50/P90 到迁移报告。
4. **硬门禁有效性**：缺风险映射、缺共享入口、缺验证命令任一情况均返回 `gate=blocked`。
5. **高风险边界策略**：命中边界时自动追加全量 `deno task test`。

## Self-Review Checklist

- Spec coverage:
  - 三层架构、共享测试组件：Task 2、4、5、6
  - 风险矩阵冻结与映射：Task 1、4、5、6
  - 硬门禁与自动参考：Task 3、7
  - 高风险边界全量验证：Task 7、8
  - 验收指标与报告：Task 7、8
- Placeholder scan: 计划无 TBD/TODO/“后续补齐”占位。
- Type consistency: `RiskRule`、`GuardResult`、`withRuntimeHarness`、`required_layer` 在任务中保持同名。

## Execution Notes

- 业务域提交顺序固定：`config/domain/core` -> `application/sources/deliveries/infrastructure` -> `interfaces/web/main`。
- 每个原子提交前后都运行对应 scoped 验证。
- 触发共享高风险边界时在该任务内立即跑全量 `deno task test`，不延后。
