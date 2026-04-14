---
name: test-architecture-guard
description: 测试改动硬门禁；检查风险映射与共享测试入口，输出 gate 报告
---

# test-architecture-guard

当测试相关改动发生后，执行硬门禁检查并输出结构化结果。

## 流程

1. 收集变更路径：支持 `--changed`，也支持从 hook stdin JSON 读取 `.tool_input.file_path` 与 `.tool_response.filePath`
2. 合并去重后的变更路径
3. 校验风险映射（risk mapping）：测试文件需具备风险映射依据（文件内 `R\d\d` 标记或风险矩阵 owner_tests 覆盖）
4. 校验共享测试入口（shared test components）：拦截 `prepareOwnedRuntime` / `cleanupOwnedRuntime` / `Deno.makeTempDir` 等本地 runtime 搭建模式
5. 执行 scoped verification：
   - `deno task test <changed test files>`
   - `deno task check <changed paths>`
   - `deno task fmt:check <changed paths>`
6. 命中高风险边界时追加全量验证：`deno task test`
7. 生成 gate 报告（`gate` / `failed_checks` / `actionable_fix` / `related_paths`）

## 硬门禁行为

- 任一检查失败时：`gate=blocked` 且进程退出码为非零
- 全部检查通过时：`gate=passed` 且进程退出码为 0
- 输出 JSON 报告供 hook 与人工读取

## 附加模式

- `--check-risk-files`：校验 `docs/testing/risk-matrix.yml` 中 `owner_tests` 路径是否真实存在

## 命令

`python .claude/skills/test-architecture-guard/scripts/guard.py --changed <path> [<path> ...] [--check-risk-files]`
