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

# testing-architecture

这些规则覆盖测试架构治理与硬门禁约束。

- 测试分层 MUST 使用 `unit` / `contract` / `flow` 三层模型。
- `flow` 用例命名 MUST 绑定风险 ID（`R01` 到 `R20`）。
- 风险矩阵 MUST 以 `docs/testing/risk-matrix.yml` 作为单一事实源。
- 风险矩阵条目 MUST 固定为 20 条，按 `R01` 到 `R20` 编号。
- 每条风险 MUST 包含字段：`id`、`domain`、`trigger`、`expected_guardrail`、`required_layer`、`owner_tests`。
- `required_layer=flow+contract` 的风险，`flow` 与 `contract` 两层 MUST 都存在映射测试。
- `contract` 与 `flow` 测试命中风险条目时，测试文件路径 MUST 出现在对应 `owner_tests` 中。
- `unit` 测试 MAY 不绑定风险 ID。
- 命中测试相关文件改动时，仓库门禁 MUST 运行测试架构校验。
- 命中共享高风险边界时，门禁 MUST 追加一次全量 `bun run test`。
- 新增或迁移测试后，变更集 MUST 通过 scoped 的 `test`、`check`、`fmt:check` 验证。
