---
name: workflow-finish
description: Use when finalizing work in a git worktree and handing merge-back plus cleanup to the shared workflow script.
---

# workflow-finish

这是一个协议层 skill。

协议职责：

- 调用方负责先为当前工作生成完整 commit message。
- 之后调用共享脚本入口：

  `deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/workflow/worktree.ts finish --message <full-message> --json`

- `finish` 成功后，调用方应尝试 `ExitWorktree(action: "remove", discard_changes: true)`。
- 无论 `ExitWorktree` 是否成功，调用方都继续调用 shared script `cleanup`。
- 随后由调用方继续调用共享脚本入口：

  `deno run --allow-read --allow-write --allow-run --allow-env .claude/skills/workflow/worktree.ts cleanup --json`

边界约束：

- 不在此 skill 中重写 merge-back、验证、主工作区检测或 cleanup 判定逻辑。
- 上述流程语义与 git 细节由 shared script `workflow/worktree.ts` 负责；此 skill 只声明调用接口与责任分界。
