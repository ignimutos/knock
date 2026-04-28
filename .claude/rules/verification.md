---
paths:
  - 'src/**'
  - 'web/**'
  - 'scripts/**'
  - 'package.json'
  - 'bun.lock'
  - 'Dockerfile'
  - '.dockerignore'
  - 'docker/**'
  - '.github/workflows/**'
  - 'README.md'
  - 'config.example.yml'
  - 'CLAUDE.md'
  - '.claude/rules/**'
  - '.claude/hooks/**'
  - '.claude/skills/test-architecture-guard/**'
---

# verification

## Docs-only changes

- MUST 校验提到的路径与命令真实存在。
- 可不跑代码；交付中 MUST 明确一致性检查结果与未运行项。

## Code changes

- MUST NOT 在未验证行为前宣告完成。
- MUST 先跑最窄相关验证，优先使用 scoped task：`bun run test:path -- <path ...>`、`bun run fmt:check:path -- <path ...>`、`bun run lint:check:path -- <path ...>`。
- `check` 当前使用项目级 `tsc --project tsconfig.json`；命中代码改动时 SHOULD 运行 `bun run check`。
- 共享入口与高影响边界改动收尾前 MUST 运行全量 `bun run test`；典型边界包括 `package.json`、`bun.lock`、`scripts/run-paths.sh`、`src/main.ts`、`src/container_entrypoint.ts`、`src/db/*`、`src/test_runtime.ts`、`src/sources/xquery.ts`。
- 按改动影响 SHOULD 追加 `bun run check`、`bun run lint:check:path -- <path ...>`、`bun run fmt:check:path -- <path ...>`。

## Final review output

- 最终交付 SHOULD 明确：改动内容、已运行验证、未运行验证、剩余风险或后续事项。
