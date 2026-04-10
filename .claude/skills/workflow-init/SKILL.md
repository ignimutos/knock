---
name: workflow-init
description: Use when starting implementation work that should create or enter the correct git worktree for the current task.
---

# workflow-init

这是一个脚本优先的协议层 skill。

输入优先级：

- 若用户显式提供 worktree 名称，优先使用用户输入。
- 否则若用户提供了任务上下文，由模型生成完整 worktree 名称。
- 若两者都没有，**MUST NOT** 因命名问题追问或失败；应直接继续调用脚本，让脚本生成安全随机的 worktree 名称。

调用脚本：

`deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/workflow-init/scripts/init.ts --name <worktree-name>`

处理规则：

- 脚本负责 worktree 名称标准化、当前上下文检测，并输出足够的 TUI 信息与结构化 JSON。
- 若脚本返回 `mode=create_worktree`，调用 `EnterWorktree`，并使用返回的 `worktreeName` 进行创建与切换。
- 若脚本返回 `mode=already_in_target_worktree`，直接报告成功，不重复切换。
- 若脚本返回 `already_in_other_worktree`，直接失败，不复用错误上下文。
- 不在此 skill 中重写 worktree 命名、路径检测或切换逻辑；这些由脚本负责判断、由工具负责最终创建与切换。
