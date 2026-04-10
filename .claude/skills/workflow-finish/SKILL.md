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
- 脚本负责自动 `git add -A`、commit、merge base branch、验证、merge-back，并输出足够的 TUI 信息与结构化 JSON；成功后的 worktree/分支 cleanup 改由独立的 `cleanup.ts` 处理。
- 若脚本返回 `nextAction=ralph_loop`，模型 **MUST** 基于脚本返回的结构化字段（如 `reason`、`worktreePath`、`rootRepoPath`、`featureBranch`、`baseBranch`、`paths`、`stdout/stderr` 或 `verification.*`）生成一个精简、任务导向的非空 prompt，再进入 `ralph-loop` 处理冲突或验证失败；loop 成功后重新生成 commit message，再次调用同一个脚本。此路径 **MUST NOT** 调用 `ExitWorktree`，必须保留当前 worktree 上下文。
- 若脚本返回成功结果（`status=completed_pending_choice`），skill **MUST** 在 merge-back 成功后展示 3 个选项；此时返回字段 `autoCommitted` 只表示脚本开头是否因为 worktree 中存在未提交改动而自动创建了提交，**不**表示 merge-back 是否成功。
  1. 删除 worktree 和分支并退回主工作区（显示实际 `worktreePath`、`featureBranch`、`rootRepoPath`、`baseBranch`）
  2. 不删除，保留当前工作区
  3. 用户输入
- 选项 1：skill **MUST** 调用 `deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/workflow-finish/scripts/cleanup.ts --worktree-path <worktreePath> --root-repo-path <rootRepoPath> --feature-branch <featureBranch>`；`cleanup.ts` 会校验 worktree 当前分支必须与 `featureBranch` 一致、worktree 必须 clean，且该分支仍已并入主工作区当前分支。若 cleanup 成功，再调用 `ExitWorktree({ action: "keep" })` 离开当前 worktree 会话，恢复到创建 worktree 前的主工作区会话。若 cleanup 失败，**MUST** 明确报告“代码已 merge-back，但 cleanup 部分失败”，并附上实际失败的路径/分支；**MUST NOT** 报告为完整成功。
- 选项 2：代码已经 merge-back 到主工作区，但 **MUST NOT** 删除当前 `worktreePath` / `featureBranch`，也 **MUST NOT** 自动调用 `ExitWorktree`。
- 选项 3：作为开放式后续动作入口；先接收用户额外指令，再按内容决定是否 cleanup、是否退出 worktree；默认 **MUST NOT** 自动执行任何破坏性动作。
- 若 `ExitWorktree({ action: "keep" })` 返回 no-op、报错，或其他任何未能恢复主工作区会话的结果，skill **MUST** 以“仓库已完成但会话未恢复”的部分失败向用户报告，并附上脚本返回的 `rootRepoPath`；**MUST NOT** 把这种情况报告为完整成功。
- 若脚本返回错误，直接停止并交由用户手动处理；此路径 **MUST NOT** 调用 `ExitWorktree`。
