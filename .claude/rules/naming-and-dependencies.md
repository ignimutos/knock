---
paths:
  - 'src/**'
  - 'web/**'
  - 'README.md'
  - 'config.example.yml'
  - 'CLAUDE.md'
---

# naming-and-dependencies

- 同一概念在 config / types / tests / docs / CLI / error 中 MUST 使用稳定术语。
- 注释与 TODO SHOULD 保持最小化；自然语言注释 MUST 使用中文；保留 TODO/FIXME 时 MUST 写明延期原因与移除条件。
- 新增依赖优先级 SHOULD 为：原生 JS/TS API → `@std/*` → `remeda` → 领域库。
- 新的不可信结构化输入边界 SHOULD 在边界处一次性用 `zod` 校验。
