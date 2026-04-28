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

# execution

- 修改前 MUST 先读目标模块及相邻上下文；行为改动前 MUST 先读相邻测试。
- 非平凡任务（多文件、接口/状态变化、重构）MUST 先有简短计划（目标 / 实现 / 验证）。
- MUST 保持原子变更，MUST 避免混入无关清理。
- 如前提缺失、假设失效或验证失败，MUST 停止并重新规划；必要时报告 `BLOCKED: <reason>`。
- 只有真实阻塞、高风险共享状态操作、或真实方案分叉时，MAY 请求用户参与。
- 实现取舍优先级 SHOULD 为：correctness → direct path to target structure → single source of truth → smallest complete fix → root-cause repair → maintainability。
