---
name: finishing-a-development-branch
description: Use when implementation in a managed git worktree is complete, validation is green, and the next step is local merge-back or cleanup decisions in the knock repository
---

# finishing-a-development-branch

这是 knock 仓库对 finish skill 的本地覆写。

## 核心约束

- 正式收尾以显式调用本 skill 为准；自动触发只作为补充，不能替代显式收尾。
- 当前环境若不在 `.claude/worktrees/` 下，必须直接拒绝，不进入收尾流程。
- 默认只处理本地 merge-back；不内建 PR 流程，也不提供 discard 流程。
- 文案与后续动作都不再提 `ralph-loop`。

## 何时使用

- 实现已完成，且准备把当前 worktree 的变更合回主工作区。
- 需要在收尾前显式整理 commit message 与验证路径。
- `scripts/finish.ts` 返回需要继续修复的结构化结果后，需要继续完成 review -> test -> fix 循环。
- `scripts/finish.ts` 返回 merge-back 已完成、但还需要用户选择 cleanup 动作。

## 流程

1. 生成或接收完整 commit message；若用户已给出，则直接使用用户输入。
2. 显式整理本次改动 diff，并补齐需要一起传入的关联测试文件或目录；调用脚本前必须逐个作为 `--path` 传入。
3. 调用：

   `deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/finishing-a-development-branch/scripts/finish.ts --message <full-message> --path <path> [--base-branch <branch>]`

4. 读取脚本结构化结果并继续：
   - 若返回 `status=needs_attention` 或 `nextAction=repair_loop`，复用 implementer 完成 review -> test -> fix 循环，然后重新生成或确认 commit message，再次调用同一个 `finish.ts`。
   - 若返回 `status=completed_pending_choice`，展示且只展示以下 3 个选项：
     1. 删除当前 worktree（默认也清理当前 root session 的子代理 worktree）
     2. 保留当前 worktree（默认仍清理当前 root session 的子代理 worktree）
     3. 用户输入

## 选项处理

### 选项 1：删除当前 worktree

- 必须先调用 `ExitWorktree({ action: "keep" })`。
- 只有 exit 成功后，才能调用：

  `deno run --allow-read --allow-write --allow-run --allow-env <rootRepoPath>/.claude/skills/finishing-a-development-branch/scripts/cleanup.ts --worktree-path <worktreePath> --root-repo-path <rootRepoPath> --feature-branch <featureBranch>`

- 若 `ExitWorktree({ action: "keep" })` 明确返回 no-op，且明确说明当前没有活动的 worktree session，才允许 root fallback；除此之外不得 fallback。
- root fallback 时，必须先切回 `rootRepoPath` 再调用 `cleanup.ts`；仅使用绝对脚本路径但仍停留在错误 cwd，不算满足该要求。

### 选项 2：保留当前 worktree

- 当前 worktree 与 feature branch 保留不删。
- 仍要按脚本既有语义清理当前 root session 的子代理 worktree。
- 不自动调用 `ExitWorktree`。

### 选项 3：用户输入

- 先接收用户额外指令，再决定是否 cleanup、是否退出 worktree。
- 默认不自动执行破坏性动作。

## 结果解释

- `completed_pending_choice` 只表示 merge-back 已完成，接下来要由用户选择 cleanup 动作。
- `autoCommitted` 只表示脚本起始阶段是否因 worktree 有未提交改动而自动创建提交，不表示 merge-back 成败。
- 前两项默认都会清理当前 root session 的子代理 worktree；区别只在于当前这个 root worktree 自己是否删除。

## 禁止事项

- 不把当前流程扩展成 PR 创建、远端 push 或 discard。
- 不在非 `.claude/worktrees/` 环境继续执行。
- 不跳过显式 `--path` 整理。
- 不再引用已删除的旧 workflow 文案。
