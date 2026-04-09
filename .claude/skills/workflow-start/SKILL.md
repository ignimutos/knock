---
name: workflow-start
description: Use when starting implementation work that should ensure the current Claude session is inside the correct git worktree.
---

# workflow-start

这是一个协议层 skill。

调用共享脚本：

`deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/workflow/worktree.ts start --label <raw-label> --json`

处理规则：

- 若返回 `mode=create_worktree`，调用 `EnterWorktree`，并使用返回的 `worktreeName`。
- 若返回 `mode=already_in_worktree`，直接报告成功，不创建新 worktree。
- 不在此 skill 中重写 worktree 命名、目录检测或其他流程细节；这些由共享脚本负责。
- 不在此 skill 中描述 merge-back、finish 或 cleanup。
