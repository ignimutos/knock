---
name: test-architecture-guard
description: 测试改动硬门禁；检查风险映射与共享测试入口，输出 gate 报告
---

# test-architecture-guard

当测试相关改动发生后，执行硬门禁检查并输出结构化结果。

## 流程

1. 收集变更路径（`--changed`）
2. 校验风险映射（risk mapping）
3. 校验共享测试入口（shared entrypoint）
4. 生成 gate 报告（`gate` / `failed_checks` / `actionable_fix` / `related_paths`）

## 硬门禁行为

- 任一检查失败时：`gate=blocked`
- 全部检查通过时：`gate=passed`
- 输出 JSON 报告供 hook 与人工读取

## 命令

`python .claude/skills/test-architecture-guard/scripts/guard.py --changed <path> [<path> ...]`
