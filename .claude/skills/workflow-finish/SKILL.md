---
name: workflow-finish
description: Use when finalizing work in a git worktree and merging validated changes back into the main workspace.
disable-model-invocation: true
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
  1. 先返回主工作区，再删除 worktree 和分支（显示实际 `worktreePath`、`featureBranch`、`rootRepoPath`、`baseBranch`）
  2. 不删除，保留当前工作区
  3. 用户输入
- 选项 1：skill **MUST** 先调用 `ExitWorktree({ action: "keep" })` 离开当前 worktree 会话；只有在 exit 成功后，才 **MUST** 基于 `rootRepoPath` 下的绝对脚本路径调用 `deno run --allow-read --allow-write --allow-run --allow-env <rootRepoPath>/.claude/skills/workflow-finish/scripts/cleanup.ts --worktree-path <worktreePath> --root-repo-path <rootRepoPath> --feature-branch <featureBranch>`。`cleanup.ts` 会校验 worktree 当前分支必须与 `featureBranch` 一致、worktree 必须 clean，且该分支仍已并入主工作区当前分支。
- 选项 1 的 no-op 兜底：仅当 `ExitWorktree({ action: "keep" })` 明确返回 no-op，且明确报告当前没有活动的 worktree session（例如当前 worktree 不是本会话通过 `EnterWorktree` 进入的）时，skill **MAY** 继续 cleanup。此时 skill **MUST** 通过 `cd <rootRepoPath> && deno run --allow-read --allow-write --allow-run --allow-env <rootRepoPath>/.claude/skills/workflow-finish/scripts/cleanup.ts --worktree-path <worktreePath> --root-repo-path <rootRepoPath> --feature-branch <featureBranch>` 这一类命令先切回主工作区，再运行 `cleanup.ts`；仅使用绝对脚本路径而不切回 `rootRepoPath`，**MUST NOT** 视为满足本兜底。这个兜底只适用于 no-op / 无活动 session，不适用于其他真实 exit 错误。
- 选项 1 的失败语义：
  - 若 `ExitWorktree({ action: "keep" })` 成功，后续 cleanup 成功，则报告完整成功。
  - 若 `ExitWorktree({ action: "keep" })` 返回 no-op / 无活动 session，且 root fallback cleanup 成功，也 **MUST** 视为完整成功；成功消息 **SHOULD** 顺带注明本次走了 no-op fallback。
  - 若 `ExitWorktree({ action: "keep" })` 是真实错误而非 no-op，skill **MUST** 立即停止，**MUST NOT** 继续 cleanup，并以“代码已 merge-back，但会话恢复失败，cleanup 未执行”的部分失败报告给用户。
  - 若 cleanup 失败，skill **MUST** 明确报告“代码已 merge-back，但 cleanup 部分失败”，并附上实际失败的路径/分支；**MUST** 同时附上一条基于 `rootRepoPath`、`worktreePath`、`featureBranch` 的可重试 cleanup 命令；**MUST NOT** 报告为完整成功。
- 选项 2：代码已经 merge-back 到主工作区，但 **MUST NOT** 删除当前 `worktreePath` / `featureBranch`，也 **MUST NOT** 自动调用 `ExitWorktree`。
- 选项 3：作为开放式后续动作入口；先接收用户额外指令，再按内容决定是否 cleanup、是否退出 worktree；默认 **MUST NOT** 自动执行任何破坏性动作。
- 若脚本返回错误，直接停止并交由用户手动处理；此路径 **MUST NOT** 调用 `ExitWorktree`。
