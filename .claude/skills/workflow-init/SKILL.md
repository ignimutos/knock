---
name: workflow-init
description: Use when starting implementation work that should create or enter the correct git worktree for the current task.
---

# workflow-init

这是一个脚本优先的协议层 skill。

输入优先级：

- 若用户显式提供 worktree 名称，优先使用用户输入。
- 否则由模型生成完整 worktree 名称。
- 若两者都没有，直接失败。

调用脚本：

`deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/workflow-init/scripts/init.ts --name <worktree-name>`

处理规则：

- 脚本负责 worktree 名称标准化、重名后缀、当前上下文检测、必要时创建 worktree，并输出足够的 TUI 信息与结构化 JSON。
- 若脚本返回 `mode=create_worktree`，调用 `EnterWorktree`，并使用返回的 `worktreeName`。
- 若脚本返回 `mode=already_in_worktree`，直接报告成功，不重复切换。
- 不在此 skill 中重写 worktree 命名、路径检测或创建逻辑；这些由脚本负责。
