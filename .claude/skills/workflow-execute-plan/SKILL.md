---
name: workflow-execute-plan
description: Use when a plan is approved and execution should begin in a worktree before delegating to superpowers:executing-plans.
---

# workflow-execute-plan

这是一个纯编排 skill。

协议职责：

- 此 skill 负责把计划执行入口串接到 `workflow-start` 与 `superpowers:executing-plans`。
- 调用关系为：先运行 `workflow-start`；仅在其成功后，再调用 `superpowers:executing-plans`。
- `workflow-start` 负责确保当前 Claude 会话进入正确的 worktree。
- `superpowers:executing-plans` 负责实际的计划执行流程。

边界约束：

- 不在此 skill 中新增 workflow 规则。
- 不在此 skill 中重写 worktree 创建、finish、merge-back 或 cleanup 细节。
- 此 skill 只保留入口编排关系，不把调用关系扩写成流程规范。
