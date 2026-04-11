# Stop Hook Guard Design

## Summary

本设计为 Knock 仓库新增一个原生 Claude Code `Stop` 守门 hook，用来拦截“并不真正需要用户参与”的等待式停顿，同时保留真正需要用户判断的停止场景。实现不再依赖 hookify，也不依赖上游流程自觉输出 `BLOCKED:` / `CONFIRM:` / `DECISION:` 之类标签。

本设计只覆盖 stop 阶段的判断，不改 PermissionRequest、PostToolUse、workflow-init、workflow-finish 或其他现有 hook 行为。实现计划见：

- `docs/superpowers/plans/2026-04-11-stop-hook-guard-plan.md`

## Problem Statement

当前会话暴露的问题不是 Claude Code 真卡死，而是 agent 在仍可继续推进时错误地以“等你回复”“如果你要我继续”之类文案收尾，导致流程被停在一个并不需要用户参与的状态。此前尝试的 hookify 方案有三个根本问题：

1. 规则文件平铺在 `.claude/` 根下，用户明确认为这种组织方式会把目录堆成屎山。
2. hookify 的 stop 规则对 `pattern:` 的字段推断不可靠，容易把简单规则绑到错误字段。
3. 依赖自觉标签协议并不现实；如果没有稳定的执行者会主动写标签，那么“协议”不是约束，只是愿望。

本次目标是把“错误等待式 stop”变成一个真正受控的原生 hook 机制。

## Goals

1. 用原生 Claude hooks 替换此前的 hookify stop 规则方向。
2. 拦截等待式、回推式、无真实决策方向的 stop。
3. 保留真正需要用户参与的 stop：真实阻塞、高风险确认、真实方案分叉。
4. 对明显 case 采用本地确定性规则；只把灰区交给模型判断。
5. 当模型判定链路失败时，不黑盒、不静默，直接把原始 stop 信息交给用户判断。
6. 保持目录整洁：实现落在 `.claude/hooks/` 与 `.claude/settings.json`，不再新增 `.claude/hookify.*.local.md`。

## Non-Goals

1. 不重写所有上游技能、agent 或 slash command 的输出协议。
2. 不要求任何上游流程自觉遵守 `BLOCKED:` / `CONFIRM:` / `DECISION:` 标签。
3. 不把所有 stop 都交给模型判定。
4. 不改动现有 PermissionRequest / PostToolUse hook 语义。
5. 不顺手做通用“任务完成质量审查框架”；当前只解决 stop 守门问题。

## Confirmed Decisions

### 1. 采用原生 hook，而不是 hookify

- 使用 `.claude/hooks/` 中的原生脚本。
- 通过 `.claude/settings.json` 注册 `Stop` hook。
- 不再继续扩展 hookify 规则文件。

### 2. 只做一个总控 `command` Stop hook

- 不采用“一个 command hook + 一个 prompt hook 顺序串联”的设计。
- 原因：同一事件的 hooks 会并行运行，不能依赖顺序或短路语义。
- 因此只注册一个 `command` 型 Stop hook，由该脚本自行完成三段式判定：
  1. 明显 block
  2. 明显 allow
  3. 灰区调用 Claude

### 3. 采用“规则优先，模型兜底”的混合式判断

- **明显无效 stop**：脚本直接 block。
- **明显有效 stop**：脚本直接 allow。
- **灰区**：脚本内部调用 Claude 做二分类判断：这次 stop 是否真的需要用户参与。

这是为了避免把所有 stop 都送进模型，同时也避免纯 regex/关键词规则对语义灰区误判过多。

### 4. 不依赖自觉标签协议

- 不能把正确性建立在上游流程会主动写 `BLOCKED:` / `CONFIRM:` / `DECISION:` 的前提上。
- 如未来个别流程愿意使用标签，最多只作为辅助信号，而不是主约束条件。

### 5. 灰区模型调用失败时，原始信息透传给用户

如果灰区判定时模型调用失败：

- 本次 stop **allow**，不强行卡死流程。
- hook 把原始 stop 信息返回给用户。
- 明确说明：模型判定失败，改由用户自行判断。

这样既避免黑盒，也避免把整个系统因判定链路失败而卡死。

## Required File Impact

### Existing files expected to change

- `.claude/settings.json`
  - 注册新的 `Stop` hook 配置。

### New files expected to be added

- `.claude/hooks/stop-guard.py`
  - `Stop` 事件入口脚本；读取 stdin JSON，完成显式规则判断、灰区分流和 Claude 调用。
- `.claude/hooks/stop-guard-prompt.txt`
  - 保存灰区模型分类 prompt，避免在脚本里堆过长 prompt 文本。
- `.claude/hooks/stop-guard_test.py`
  - 针对样例 payload 覆盖明显 block / allow / 灰区 / 模型失败降级路径。

> prompt 内容必须有单一事实源，不散落在多处脚本拼接字串里。

## Hook Input / Output Contract

### Hook 输入

脚本至少需要读取这些字段：

- `hook_event_name`
- `reason`
- `transcript_path`（若存在）
- 其他辅助字段只在实现需要时读取

### Hook 输出

#### Block 场景

返回 JSON，至少包含：

- `decision: "block"`
- `reason` 或 `systemMessage`

文案要求：

- 明确指出这是“错误等待式 stop / 明显回推下一步”
- 明确指出应继续执行，而不是等待用户

#### Allow 场景

- 明显有效 stop：返回空 JSON 或最小 allow 响应
- 灰区模型失败：返回 allow，同时把原始 stop 信息展示给用户

## Stop Classification Rules

### 1. 直接 block 的模式

以下类型应被视为**无效 stop**：

- 等待式：
  - `等你回复`
  - `等你确认`
  - `等你决定`
  - `let me know`
  - `wait for your reply`
- 回推明显下一步：
  - `如果你要我继续`
  - `if you want I can continue`
  - `我可以接着做 ...`（但没有真实分叉）
- 无意义停顿：
  - `我先停在这里`
  - `pause here`
  - `先到这里`

共同特征：

- 没有真实阻塞
- 没有高风险确认
- 没有真实方案分叉
- 本质上只是把还能继续推进的事情交还给用户

### 2. 直接 allow 的模式

以下类型应被视为**有效 stop**：

- 真实阻塞：
  - 权限缺失
  - 外部凭据缺失
  - 依赖环境不可用
  - 必要文件/命令不存在
- 高风险确认：
  - 删除
  - push / merge / cleanup
  - 覆盖共享状态
  - 对外发送或修改共享资源
- 真实方案分叉：
  - 多个互斥实现路径
  - scope 明显不同
  - 下一步取决于用户业务选择，而不是执行惯性

### 3. 灰区判定

若不满足明显 block，也不满足明显 allow，则进入灰区。

灰区时脚本应向 Claude 提供：

- 当前 stop reason 原文
- 必要的 transcript 摘要或截断上下文
- 一个极窄的判题任务：
  - 这次 stop 是否真的需要用户参与？
  - 只允许回答 `ALLOW` 或 `BLOCK`
  - 再给一句极短理由

## Claude 灰区分类要求

Claude 灰区分类器的任务必须非常窄：

- **ALLOW**：只有在继续执行会越权、会改变 scope、会触发高风险动作，或已遇到真实阻塞时。
- **BLOCK**：当 stop 只是礼貌性停顿、明显下一步回推、或执行仍可继续时。

分类器不能做代码实现建议，也不能展开长篇解释；只做 stop 有效性判断。

## Failure Handling

### 1. Claude 调用失败

- 不把失败当作非法 stop。
- 允许 stop 通过。
- 向用户显示：
  - 原始 stop reason
  - 一个短说明：模型判定失败，请人工判断

### 2. Hook 脚本自身失败

- 必须尽量降到“可解释失败”，不能无声吞错。
- 至少给出：
  - 脚本失败
  - 失败原因摘要
- 默认策略应避免因守门器崩溃导致整个会话不可用。

### 3. 防递归 / 防重入

由于 `Stop` 会在每次 Claude 结束响应时触发，设计必须考虑：

- 灰区模型调用不能再触发同类 stop 守门死循环。
- 若运行时提供 `stop_hook_active` 或等价信号，应优先利用它避免重入。
- 若无现成信号，实现层必须用局部进程/环境标记做一次性防重入保护。

## Testing Strategy

### Required test cases

至少覆盖：

1. **明显等待式 stop → block**
   - 输入示例：`等你回复后我再继续。`
2. **明显回推下一步 → block**
   - 输入示例：`如果你要，我可以继续整理剩余文档。`
3. **明显高风险确认 → allow**
   - 输入示例：删除 worktree / push / cleanup 之前的确认文案
4. **明显真实分叉 → allow**
   - 输入示例：两个互斥实现路径，需要用户选一个
5. **明显真实阻塞 → allow**
   - 输入示例：缺权限 / 缺 token / 依赖命令不存在
6. **灰区 + Claude 返回 ALLOW**
7. **灰区 + Claude 返回 BLOCK**
8. **灰区 + Claude 调用失败 → allow + 原文透传**
9. **防重入路径**
   - 已处于 stop hook 内时不再次触发模型判定链

### Verification scope

本任务改动 `.claude/settings.json` 与 `.claude/hooks/*`，属于 repo workflow/tooling 面，不直接触碰运行时业务代码。最小闭环至少应包含：

- hook 脚本样例测试
- `.claude/settings.json` 结构校验
- 至少一次人工 pipe-test，模拟 `Stop` stdin payload
- 明确报告未实际覆盖的真实 interactive stop 场景

## Risks

1. **灰区语义误判**
   - 即使引入模型，也不可能 100% 正确。
2. **Stop hook 自己变成卡点**
   - 若防重入做不好，会造成新的“假卡住”。
3. **Claude CLI/API 调用路径差异**
   - 若脚本中模型调用方式选择不当，会带来权限、耗时或重入问题。
4. **关键词 allow 规则过宽**
   - 可能把其实不需要用户参与的文案误放行。
5. **关键词 block 规则过宽**
   - 可能拦掉本来合法的真实确认语句。

## Acceptance Criteria

1. stop 守门实现完全基于原生 `.claude/hooks` + `.claude/settings.json`。
2. 仓库内不再依赖新增 hookify 规则文件来实现该能力。
3. 明显等待式 / 回推式 stop 会被 block。
4. 明显真实阻塞 / 高风险确认 / 真实分叉会被 allow。
5. 灰区会调用 Claude 做有效 stop 判定。
6. 模型调用失败时，原始 stop 信息会透传给用户，并 allow。
7. 实现包含防重入处理，避免 stop 守门自身制造新卡顿。
8. 实现附带最小可重复验证脚本或测试，能在仓库内独立验证主要判定路径。
