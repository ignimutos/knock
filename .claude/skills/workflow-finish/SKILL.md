---
name: workflow-finish
description: Use when finalizing work in a git worktree and merging validated changes back into the main workspace.
---

# workflow-finish

这是一个脚本优先的协议层 skill。

输入优先级：

- 若用户显式提供 commit message，优先使用用户输入。
- 否则由模型生成完整 commit message。
- 若用户显式提供路径列表，优先使用用户输入。
- 否则由模型提取受影响文件与相关测试范围。
- 若用户显式提供 base branch，优先使用用户输入；否则由脚本自动检测主工作区当前分支。

调用脚本：

`deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/workflow-finish/scripts/finish.ts --message <full-message> --path <path> [--base-branch <branch>]`

处理规则：

- 脚本负责自动 `git add -A`、commit、merge `main`、验证、merge-back、删除 worktree/分支，并输出足够的 TUI 信息与结构化 JSON。
- 若脚本返回 `nextAction=ralph_loop`，进入 `ralph-loop` 处理冲突或验证失败；loop 成功后重新生成 commit message，再次调用同一个脚本。
- 若脚本返回成功结果，skill 只根据返回的 `rootRepoPath` 切回主工作区会话；不再重复删除，也不做额外检查。
- 若脚本返回错误，直接停止并交由用户手动处理。
