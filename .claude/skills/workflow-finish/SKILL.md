---
name: workflow-finish
description: Use when finalizing work in a git worktree and merging validated changes back into the main workspace.
---

# workflow-finish

这是一个脚本优先的协议层 skill。

输入优先级：

- 若用户显式提供 commit message，优先使用用户输入。
- 否则由模型生成完整 commit message。
- 若用户显式提供改动文件列表，优先使用用户输入。
- 否则由模型先提取受影响文件列表与需要补跑的关联测试路径，并在调用脚本前显式作为 `--path` 传入；脚本只基于这些显式路径做 `lint:check` / `check` / `test` 范围执行，不再自行推断慢测组。
- 若用户显式提供 base branch，优先使用用户输入；否则由脚本自动检测主工作区当前分支。

调用脚本前，skill **MUST** 先整理出受影响文件与需要补跑的关联测试路径，并逐个作为 `--path` 传入；缺少 `--path` 时 **MUST NOT** 调用脚本。

调用脚本：

`deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/workflow-finish/scripts/finish.ts --message <full-message> --path <path> [--base-branch <branch>]`

处理规则：

- docs-only 改动时，脚本只跑受影响文件的 `fmt:check`，跳过 `lint:check` / `check` / `test`。
- 普通代码改动时，脚本只执行显式传入路径对应的 `lint:check` / `check` / `test`；`test` 命中全量触发项时回退默认全量。
- 脚本负责自动 `git add -A`、commit、merge base branch、验证、merge-back、删除 worktree/分支，并输出足够的 TUI 信息与结构化 JSON。
- 若脚本返回 `nextAction=ralph_loop`，进入 `ralph-loop` 处理冲突或验证失败；loop 成功后重新生成 commit message，再次调用同一个脚本。此路径 **MUST NOT** 调用 `ExitWorktree`，必须保留当前 worktree 上下文。
- 若脚本返回成功结果（`status=completed`），skill **MUST** 调用 `ExitWorktree({ action: "keep" })` 离开当前 worktree 会话，恢复到创建 worktree 前的主工作区会话。这里使用 `keep` 只是为了恢复会话；worktree/分支删除已由脚本完成，因此 **MUST NOT** 再调用 `remove`。
- 若 `ExitWorktree({ action: "keep" })` 返回 no-op、报错，或其他任何未能恢复主工作区会话的结果，skill **MUST** 以“仓库已完成但会话未恢复”的部分失败向用户报告，并附上脚本返回的 `rootRepoPath`；**MUST NOT** 把这种情况报告为完整成功。
- 若脚本返回错误，直接停止并交由用户手动处理；此路径 **MUST NOT** 调用 `ExitWorktree`。
