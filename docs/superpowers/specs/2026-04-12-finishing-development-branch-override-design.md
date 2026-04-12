# 本地覆写 `finishing-a-development-branch` Design Spec

## 摘要

本设计把当前仓库的收尾协议统一收敛到本地同名 skill `finishing-a-development-branch`。该 skill 覆写 superpowers 官方同名 skill，吸收官方“开发完成后进入收尾阶段”的语义，以及当前本地 `workflow-finish` 的脚本化安全收尾能力；同时删除旧 `workflow-init` / `workflow-finish` 入口，改为在开始阶段统一使用 `claude -w <name>` 进入 worktree。

新收尾协议目标是：在当前主 worktree 中完成自动提交、吸收 `main`、scoped 验证、review/test/fix 循环、merge-back、本地 cleanup 选项展示，并把当前 root session 下产生的子代理 worktree 统一记账与清理纳入同一条收尾路径。

## 背景与问题

当前仓库同时存在三套相近但不完全一致的收尾语义：

1. superpowers 官方 `finishing-a-development-branch`：强调“开发完成后给出后续选项”，但流程偏通用，包含 PR / discard 等本仓库当前不需要的一般化分支处理语义。
2. 本地 `workflow-finish`：已实现 worktree 检测、自动提交、合并 `main`、scoped verification、merge-back、cleanup 脚本与 `ExitWorktree` 安全退出逻辑。
3. 用户当前已决定的新开始流程：直接使用 `claude -w <name>` 创建并进入 worktree，不再需要 `workflow-init`。

与此同时，superpowers 的 subagent-driven-development 会在实现、评审、回修之间复用 implementer 子代理并不断循环；子代理可能创建临时 worktree，但 Claude Code 不提供一个可靠的“事后列出本轮全部子代理 worktree”的统一状态面。若不主动记账，最终收尾阶段无法安全、完整地判断哪些子代理 worktree 属于当前任务、哪些可删、哪些应跳过。

因此，本次设计要解决的不是简单“改一个 skill 名称”，而是把：

- 官方 finishing skill 的对外入口语义
- 本地 `workflow-finish` 的安全收尾协议
- 子代理 worktree 的运行态记账与统一 cleanup

合并成一个单一、明确、可验证的 finish 流程。

## 目标

1. 本地提供同名 `finishing-a-development-branch`，覆盖官方 skill。
2. 删除旧 `workflow-init` / `workflow-finish` skill 与旧入口文案，避免双入口并存。
3. 收尾协议强绑定 worktree 环境；非 `.claude/worktrees/` 环境直接拒绝执行。
4. 允许在当前 worktree dirty 时自动提交，再继续 finish 流程。
5. 在 finish 流程中完成：
   - 合并 `main` 到当前 worktree
   - scoped `fmt/check/lint/test` 验证
   - review -> test -> fix 循环
   - merge-back 到本地 `main`
   - 最终 3 选项展示
6. 通过 hooks 落盘记录当前 root session 关联的子代理 worktree，并在 cleanup 阶段统一处理。
7. cleanup 只处理当前 root session，不顺手扫历史残留。
8. cleanup 结果要区分 `deleted` / `skipped` / `failed`，并在部分失败时明确报告。

## 非目标

本次设计不做以下事项：

1. 不保留 `workflow-init` / `workflow-finish` 的兼容壳、别名或迁移层。
2. 不把新 finish 做成通用 PR / discard / remote push 工作流；这些场景走最终选项 3 的额外用户输入。
3. 不在 `SubagentStop` 时立刻尝试删除子代理 worktree。
4. 不依赖 `ralph-loop` 处理 finish 里的冲突或验证失败。
5. 不把子代理 worktree 账本替换成只靠上下文/记忆的隐式追踪。
6. 不在本轮 finish 中顺带清理旧 session 遗留的历史 worktree。
7. 不要求 skill 自动触发必定发生；正式收尾协议以显式调用为准。

## 已确认决策

### 1. 开始与结束入口收敛

- 开始阶段：统一改为 `claude -w <name>`。
- 结束阶段：统一使用本地同名 `finishing-a-development-branch`。
- 旧 `workflow-init` / `workflow-finish` 目录、脚本旧路径、相关文档引用都删除，不保留兼容层。

### 2. 同名 skill 采用覆写而非继承

Claude Code / superpowers 的同名 skill 覆写本质是 shadowing，不存在“自动继承官方 skill 再局部补丁”的机制。因此，本地 `finishing-a-development-branch` 将完整重写 `SKILL.md`，但手工吸收：

- 官方 skill 的“开发完成 -> 收尾选项”语义
- 当前 `workflow-finish` 的脚本化安全协议

### 3. 收尾协议强绑定 worktree 环境

新 finish 只允许在 `.claude/worktrees/` 下的 worktree 中运行。若当前不在 worktree：

- 直接报错并停止
- 不做自动 fallback
- 不尝试在主仓库执行半套流程

### 4. 自动提交保留

若当前 worktree 存在未提交改动，finish 允许自动：

- `git add -A`
- `git commit -m <message>`

主工作区仍必须保持 clean，避免 merge-back 污染主仓库。

commit message 规则：

- 若用户显式提供 message，优先使用用户输入
- 否则由收尾 skill 基于当前 diff 与本轮上下文生成完整 message

### 5. review / test / fix loop 由 skill 编排

`finish.ts` 负责：

- worktree/root 检测
- `main` -> 当前 worktree 合并
- scoped verification
- merge-back
- 结构化状态输出

真正的修复循环由 skill 编排：

- merge 冲突 / verification 失败 / merge-back 冲突时
- 返回 implementer 子代理修复
- 再 review / test / fix
- 再继续 finish

不再依赖 `ralph-loop`。

### 6. implementer 子代理复用

当 reviewer 打回时，继续复用同一个 implementer 子代理做回修，不为每次回修新开 implementer。这样与 superpowers 原有 subagent-driven-development 流程一致，也减少临时 worktree 垃圾。

### 7. final review 智能补跑

官方 subagent-driven-development 在进入 finishing 之前通常已经做过 final reviewer。新 finish 采用“上下文优先”的智能补跑策略：

- 若当前上下文明确表明 final review 已完成且结论有效，则不重复补跑
- 若上下文缺失、压缩、resume 后不清楚，则补跑一次 final reviewer

这里不额外落盘 `finish-context.json`，因为该判断属于主会话编排语义，不属于必须脚本化持久化的运行态事实。

### 8. cleanup 默认包含子代理 worktree

最终 3 个选项保持不变，但问题文案明确说明：

- 选删除主 worktree：默认也清理当前 root session 的子代理 worktree
- 选保留主 worktree：默认仍清理当前 root session 的子代理 worktree
- 需要额外组合或特殊保留，走选项 3 的额外用户输入

### 9. 删除当前主 worktree 前必须先退出会话

当用户选择删除当前 worktree：

1. 先执行 `ExitWorktree({ action: "keep" })`
2. exit 成功后，再从主工作区运行 cleanup
3. 若 `ExitWorktree` 明确返回 no-op 且明确说明当前无活动 session，允许 root fallback
4. 其他真实 exit 错误：立即停止 cleanup，并以部分失败报告

这延续并固化了现有 `workflow-finish` 已验证过的安全路径。

### 10. cleanup 顺序

按照用户确认，cleanup 顺序为：

1. 先删除主 worktree
2. 再删除当前 root session 关联的子代理 worktree

该顺序虽然在排障上不如“先删子代理再删主 worktree”稳，但本设计尊重用户明确选择。

## 架构分层

### A. Skill 层：本地 `finishing-a-development-branch`

建议目录：

- `.claude/skills/finishing-a-development-branch/SKILL.md`

职责：

- 对外作为唯一 finish 入口
- 编排收尾状态机
- 生成或接收 commit message
- 提取并补齐 verification 路径
- 驱动 implementer / reviewer / final reviewer 协调
- 读取 cleanup 结果并向用户呈现 3 个选项后的最终报告

### B. Script 层：`finish.ts` / `cleanup.ts`

建议迁移路径：

- `.claude/skills/finishing-a-development-branch/scripts/finish.ts`
- `.claude/skills/finishing-a-development-branch/scripts/cleanup.ts`

来源：直接复用并改造现有 `workflow-finish` 脚本骨架。

职责边界：

- `finish.ts`：git/verification 状态机
- `cleanup.ts`：主 worktree + 子代理 worktree 的批量安全删除

### C. Hook 层：子代理 worktree 账本

建议目录：

- `.claude/hooks/*`
- 状态文件：`.claude/state/subagent-worktrees.json`

职责：

- 只记录事实
- 不直接删 worktree
- 不承担 review 或清理决策

## finish 状态机

### 阶段 1：前置检查

1. 检查当前是否位于 `.claude/worktrees/` 下
2. 检查主工作区是否 clean
3. 解析当前 feature branch、root repo path、base branch
4. 若当前 worktree dirty，则自动提交

### 阶段 2：验证路径准备

skill 先基于：

- `git diff --name-only <base>...HEAD`
- 当前任务上下文
- 直接调用边界
- 相邻测试路径

整理出显式 verification 路径，再逐个 `--path` 传给 `finish.ts`。脚本只执行显式传入路径，不再做隐式大范围测试推断。

### 阶段 3：吸收 `main`

`finish.ts` 执行：

- merge `main` 到当前 worktree

若发生冲突：

- 返回结构化状态，如 `merge_main_conflict`
- skill 驱动 implementer 回修
- 回修后重新走验证与 finish 流程

### 阶段 4：scoped verification

`finish.ts` 依据显式路径执行 scoped：

- `deno task fmt:check`
- `deno task lint:check`
- `deno task check`
- `deno task test`

若 verification 失败：

- 脚本返回结构化状态
- skill 驱动 implementer -> review/test/fix loop
- 直至通过

### 阶段 5：review / test / fix 循环

由 skill 编排，不在脚本中内嵌 reviewer 逻辑。

规则：

1. 优先复用当前 implementer 子代理
2. reviewer 不通过 -> implementer 回修
3. 回修后再次 review
4. 直到：
   - final review（若需要）通过
   - scoped verification 通过

### 阶段 6：merge-back 到主仓库

`finish.ts` 执行：

- 切回主工作区 `main`
- merge 当前 feature branch 回 `main`

若 merge-back 冲突：

- 脚本返回结构化状态，如 `merge_back_conflict`
- skill 驱动 implementer 修复
- 再验证
- 再尝试 merge-back

### 阶段 7：最终选项

merge-back 成功后，skill 展示 3 个选项：

1. 删除当前 worktree（默认也清理本 root session 的子代理 worktree）
2. 保留当前 worktree（默认仍清理本 root session 的子代理 worktree）
3. 用户输入

不内建 PR / discard 一级标准流程。

## 子代理 worktree 账本设计

### 账本位置

- `.claude/state/subagent-worktrees.json`
- 不进 git
- hooks / finish / cleanup 共用

### 归属键

采用双键：

- `rootSessionId`（优先）
- `rootWorktreePath`（回退）

只靠单键不够稳，尤其在 resume、reload、hook 字段不完整时容易漏或误归类。

### 数据结构

账本采用：

- 状态表（每棵 worktree 一条记录）
- 精简 events 数组（只记关键点）

不做完整 append-only 审计日志，避免过度设计。

### 记录字段

每棵 worktree 的最小字段：

- `rootSessionId`
- `rootWorktreePath`
- `agentId`
- `agentSessionId`
- `worktreePath`
- `branch`
- `status`：`created | active | stopped | removed | cleanup_skipped | cleanup_done`
- `createdAt`
- `updatedAt`
- `lastSeenCwd`
- `cleanupReason`（可选）

`events` 只保留关键事件：

- `create`
- `start`
- `stop`
- `remove`
- `cleanup`

### 写账本的 hooks

只使用 4 个 hook：

- `WorktreeCreate`
- `WorktreeRemove`
- `SubagentStart`
- `SubagentStop`

不把 `Stop` 混入账本写入，避免把“回合结束”误当成“生命周期结束”。

### `SubagentStop` 语义

`SubagentStop` 只做：

- 更新账本
- 标记 `stopped`

不在该时点尝试删除子代理 worktree，因为 implementer 后续可能会被 reviewer 打回复用，且“子代理停了”不等于“结果已被吸收”。

### 账本失败策略

账本采用 fail-open：

- hooks 写账本失败，不阻塞子代理结束
- finish 阶段若账本缺失/损坏：
  - 主 worktree 收尾照常
  - 子代理 cleanup 降级为 `skipped`
  - 明确报告“账本不可用，未执行子代理统一清理”

### 账本文件删除策略

- 若所有记录都已 `cleanup_done` / `removed` 且无活跃项，直接删除 `.claude/state/subagent-worktrees.json`
- 若仍有 `active` / `stopped` / `cleanup_skipped` 项，则压缩后保留
- 不留空壳文件

## cleanup 规则

### 处理范围

cleanup 只处理：

- 当前主 worktree
- 当前 root session 关联的子代理 worktree

不顺手清理历史残留 session。

### 安全删除条件

子代理 worktree 及 branch 只有在以下条件同时满足时才允许删除：

1. 路径在 `.claude/worktrees/` 下
2. worktree clean
3. branch 与账本记录一致
4. 可确认属于当前 root session / root worktree
5. branch 已被吸收，或可证明已无进一步保留价值

### 默认删除对象

删除子代理 worktree 时，默认也删除其 branch；若任一条件不满足则跳过并报告，不为“清爽”而强删。

### 结果分类

cleanup 结果必须区分：

- `deleted`：按预期删除成功
- `skipped`：按安全规则故意不删
- `failed`：本来该删，但命令执行失败

这样可以区分“保护性跳过”和“真实执行异常”。

### 部分失败语义

cleanup 不是事务系统，因此采用：

- 部分失败直报
- 不回滚已完成的删除

如果主 worktree 已删除，但某些子代理 cleanup `skipped` 或 `failed`：

- 明确报告主 merge-back 与主 cleanup 已完成
- 同时列出子代理 `skipped` / `failed` 项、原因与可重试命令

## 与现有实现的合并策略

### 复用 `workflow-finish` 的部分

直接迁移并改造：

- root repo / worktree 检测
- `git worktree list --porcelain` 解析
- scoped verification plan
- worktree dirty 自动提交
- merge `main` 到当前 worktree
- merge-back 到主工作区
- cleanup 的分支/路径/merged 校验
- `ExitWorktree` 成功后再删当前 worktree 的安全语义

### 吸收官方 finishing skill 的部分

吸收的不是原文，而是流程骨架与对外语义：

- “开发完成后进入 finish 阶段”
- “完成主要验证后向用户展示最终选项”
- “finish 是收尾协议入口，而不是额外 ad hoc 脚本”

不吸收的部分：

- PR 一级标准流程
- discard 一级标准流程
- 通用化的远程协作选项

## 方案比较

### 方案 A：同名覆写 + 复用现有脚本 + hook 账本（推荐）

做法：

- 本地覆写 `finishing-a-development-branch`
- 迁移现 `workflow-finish` 脚本到新 skill
- 用 4 个 hook 维护子代理 worktree 账本
- 最终 cleanup 统一执行

优点：

- 单一 finish 入口
- 最大化复用已验证脚本逻辑
- 子代理 cleanup 有事实依据
- 与当前仓库工作流最贴合

缺点：

- 需要同步迁移 skill、脚本、hooks 与文档
- 需要在 skill 中补完整状态机编排

### 方案 B：保留 `workflow-finish`，额外做旁路 wrapper

做法：

- 官方 finishing skill 保持不变
- 另建 wrapper 或自定义命令调用旧 `workflow-finish`

优点：

- 对当前实现侵入小

缺点：

- 双入口并存
- 人与模型都容易走错
- finish 语义仍分裂

### 方案 C：只靠 hooks 自动删子代理 worktree

做法：

- 在 `SubagentStop` 时直接删子代理 worktree
- finish 仅负责主 worktree

优点：

- 表面看起来“收得更快”

缺点：

- 与 implementer 复用和 review loop 冲突
- 误删风险高
- 无法保证结果已被主流程吸收

## 推荐方案

采用方案 A：**本地同名覆写 `finishing-a-development-branch`，复用现有 `workflow-finish` 脚本能力，并通过 4 个 hook 维护子代理 worktree 账本，在最终 finish 阶段统一 cleanup。**

## 影响文件

### 将新增

- `.claude/skills/finishing-a-development-branch/SKILL.md`
- `.claude/skills/finishing-a-development-branch/scripts/finish.ts`
- `.claude/skills/finishing-a-development-branch/scripts/cleanup.ts`
- `.claude/hooks/<worktree-ledger-related-hooks>`
- `docs/superpowers/plans/<date>-finishing-development-branch-override.md`

### 将删除

- `.claude/skills/workflow-init/**`
- `.claude/skills/workflow-finish/**`

### 将修改

- `CLAUDE.md`（若仍引用旧 workflow 名称或入口）
- 相关 docs/superpowers 文档与示例
- `.gitignore`（若尚未覆盖 `.claude/state/`）

## 验收标准

1. 在 `.claude/worktrees/<name>` 中显式调用新 finish，能完成自动提交、吸收 `main`、scoped 验证与 merge-back。
2. 在 merge/verification 失败时，finish 不依赖 `ralph-loop`，而是通过 skill 编排回到 implementer 修复并继续循环。
3. 在非 worktree 环境调用新 finish，会直接拒绝。
4. 在 root session 下存在子代理 worktree 时，finish 能读取账本并在 cleanup 阶段统一处理当前 session 关联项。
5. cleanup 结果能明确区分 `deleted` / `skipped` / `failed`。
6. 选删除当前主 worktree 时，必须先 `ExitWorktree({ action: "keep" })`，再执行 cleanup；仅 no-op 情况允许 fallback。
7. 当账本为空且无活跃项时，`.claude/state/subagent-worktrees.json` 会被删除。
8. 仓库中不再残留 `workflow-init` / `workflow-finish` 入口、文档或实现。

## 风险与后续

### 风险

1. 主 worktree 先删、子代理后删的顺序会降低 cleanup 出错时的排障便利性。
2. finish 的自动触发仍依赖模型判断，不能替代显式调用。
3. hooks 账本若字段缺失或损坏，会导致子代理 cleanup 降级为 `skipped`。

### 后续可选演进

1. 在流程稳定后，把 repo-local 实现再抽成私有插件。
2. 为历史残留 worktree 单独提供 sweep 命令，而不是混入 finish。
3. 如果后续需要 PR / discard，再在选项 3 上层扩展，而不是提前内建。
