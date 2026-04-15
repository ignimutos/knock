---
paths:
  - 'src/**'
  - 'web/**'
  - 'scripts/**'
  - 'deno.json'
  - 'README.md'
  - 'config.example.yml'
  - 'CLAUDE.md'
  - '.claude/rules/**'
---

# verification

## Docs-only changes

- MUST 校验提到的路径与命令真实存在。
- 可不跑代码；交付中 MUST 明确一致性检查结果与未运行项。

## Code changes

- MUST NOT 在未验证行为前宣告完成。
- MUST 先跑最窄相关验证，优先使用 scoped task：`deno task test <path>`。
- 对 `check` / `fmt:check` / `lint:check` / `test`，agents 直接调用时 MUST 传入受影响路径；需要基线验证时 MAY 无参调用。
- 共享入口与高影响边界改动收尾前 MUST 运行全量 `deno task test`；典型边界包括 `src/main.ts`、`src/core/app.ts`、`src/db/*`、`src/sources/xquery.ts`、`src/test_runtime.ts`、`deno.json`、`scripts/run-paths.sh`。
- 按改动影响 SHOULD 追加 `deno task check`、`deno task lint:check`、`deno task fmt:check`。

## Final review output

- 最终交付 SHOULD 明确：改动内容、已运行验证、未运行验证、剩余风险或后续事项。
