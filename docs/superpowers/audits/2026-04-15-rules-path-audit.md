# Rules Path Audit

日期：2026-04-15  
范围：`.claude/rules/*.md`

## 审计口径

- 语法：Claude Code `paths:` frontmatter 是否有效
- 语义：命中范围是否与 rule 主题一致
- 策略：偏收紧，优先减少无关命中

## 审计总表

| rule                       | 当前 paths                                                                                                                                                                                                 | 语法判断 | 语义判断                | 主要问题                                                                                                                | 建议 paths                                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| execution.md               | `src/**`<br>`web/**`<br>`CLAUDE.md`<br>`.claude/**`                                                                                                                                                        | 正确     | 应收紧（过宽）          | `.claude/**` 会命中 `.claude/settings.json` 等本地运行器配置，超出执行规则主题；`CLAUDE.md` 命中合理。                  | `src/**`<br>`web/**`<br>`scripts/**`<br>`deno.json`<br>`CLAUDE.md`<br>`.claude/rules/**`                                                                                                                                                                 |
| verification.md            | `src/**`<br>`web/**`<br>`CLAUDE.md`<br>`.claude/**`<br>`README.md`<br>`config.example.yml`                                                                                                                 | 正确     | 应收紧 + 应放宽（错位） | `.claude/**` 过宽并命中 `.claude/settings.json`；同时遗漏 `scripts/**` 与 `deno.json`，与规则内“高影响边界”不一致。     | `src/**`<br>`web/**`<br>`scripts/**`<br>`deno.json`<br>`README.md`<br>`config.example.yml`<br>`CLAUDE.md`<br>`.claude/rules/**`                                                                                                                          |
| naming-and-dependencies.md | `src/**`<br>`web/**`<br>`README.md`<br>`config.example.yml`<br>`CLAUDE.md`                                                                                                                                 | 正确     | 正确                    | 样本命中与规则主题一致；`CLAUDE.md` 作为术语规范表面命中合理。                                                          | 保持不变：`src/**`、`web/**`、`README.md`、`config.example.yml`、`CLAUDE.md`                                                                                                                                                                             |
| docs-sync.md               | `README.md`<br>`config.example.yml`<br>`src/**`<br>`web/**`<br>`CLAUDE.md`                                                                                                                                 | 正确     | 应收紧（轻度过宽）      | `src/**` 过宽，命中大量与“文档同步”弱相关的内部实现；`web/**` 保留合理；`.claude/settings.json` 未命中。                | `README.md`<br>`config.example.yml`<br>`src/main.ts`<br>`src/application/**`<br>`src/interfaces/**`<br>`src/config/**`<br>`src/sources/**`<br>`src/deliveries/**`<br>`web/**`                                                                            |
| config-contract.md         | `src/config/**`<br>`config.example.yml`<br>`README.md`<br>`src/**`                                                                                                                                         | 正确     | 应收紧（过宽）          | `src/**` 覆盖面过大并稀释“配置契约”主题；`src/config/**` 已覆盖核心契约定义面。                                         | `src/config/**`<br>`src/interfaces/**`<br>`src/main.ts`<br>`config.example.yml`<br>`README.md`                                                                                                                                                           |
| gitnexus.md                | `src/**`<br>`web/**`<br>`CLAUDE.md`<br>`.claude/**`                                                                                                                                                        | 正确     | 应收紧（过宽）          | `.claude/**` 会命中 `.claude/settings.json` 等本地设置；`CLAUDE.md` 作为指令入口面合理；`README.md` 不命中合理。        | `src/**`<br>`web/**`<br>`CLAUDE.md`<br>`.claude/rules/**`                                                                                                                                                                                                |
| logging-otel.md            | `src/main.ts`<br>`src/application/**`<br>`src/core/**`<br>`src/db/**`<br>`src/deliveries/**`<br>`src/interfaces/**`<br>`src/sources/**`<br>`src/web/**`<br>`web/**`<br>`README.md`<br>`config.example.yml` | 正确     | 应放宽（过窄）          | 命中样本正确，但遗漏 `src/config/**` 与 `src/infrastructure/**`；这两处存在真实日志调用点，改动会绕过 OTel 规则审计。   | `src/main.ts`<br>`src/application/**`<br>`src/config/**`<br>`src/core/**`<br>`src/db/**`<br>`src/deliveries/**`<br>`src/infrastructure/**`<br>`src/interfaces/**`<br>`src/sources/**`<br>`src/web/**`<br>`web/**`<br>`README.md`<br>`config.example.yml` |
| logging-console.md         | `src/main.ts`<br>`src/core/**`<br>`src/interfaces/**`<br>`src/web/**`<br>`web/**`<br>`README.md`<br>`config.example.yml`                                                                                   | 正确     | 应收紧（过宽）          | `src/core/**` 与 `web/**` 覆盖大量与“控制台展示层”弱相关文件；`README.md`/`config.example.yml` 作为展示契约文档合理。   | `src/main.ts`<br>`src/core/logger.ts`<br>`src/core/logger_test.ts`<br>`src/interfaces/daemon/**`<br>`src/interfaces/web/**`<br>`web/routes/**`<br>`README.md`<br>`config.example.yml`                                                                    |
| testing-architecture.md    | `src/**/*test.ts`<br>`web/**/*test.ts`<br>`web/**/*test.tsx`<br>`docs/testing/**`<br>`.claude/settings.json`<br>`scripts/run-paths.sh`                                                                     | 正确     | 应放宽（过窄）          | 规则命中测试与风险矩阵样本正确，但遗漏测试门禁实现面：`.claude/skills/test-architecture-guard/**` 与 `src/testing/**`。 | `src/testing/**`<br>`src/**/*test.ts`<br>`web/**/*test.ts`<br>`web/**/*test.tsx`<br>`docs/testing/**`<br>`.claude/settings.json`<br>`.claude/skills/test-architecture-guard/**`<br>`scripts/run-paths.sh`                                                |

## 风险分类

- `正确`
- `应收紧`
- `应放宽`
- `应移除某些路径`
- `应拆分`

风险标签：`过宽` / `过窄` / `错位` / `重复`

## 单项审计记录

### execution.md

- 应命中：`src/application/run_source_use_case.ts`（命中 `src/**`）；`web/routes/index.tsx`（命中 `web/**`）。
- 不应命中：`docs/testing/risk-matrix.yml`（不命中，符合预期）。
- 边界样本：`.claude/settings.json`（被 `.claude/**` 命中，语义过宽）；`CLAUDE.md`（被 `CLAUDE.md` 命中，语义合理）。
- 结论：语法正确；语义应收紧。
- 建议：将 `.claude/**` 收紧为 `.claude/rules/**`，并补入 `scripts/**`、`deno.json` 以覆盖执行规则涉及的共享入口。

### verification.md

- 应命中：`src/config/load_config.ts`（命中 `src/**`）；`README.md`；`config.example.yml`。
- 不应命中：`docs/superpowers/specs/2026-04-15-rules-path-audit-design.md`（不命中，符合预期）。
- 边界样本：`.claude/settings.json`（被 `.claude/**` 命中，语义过宽）。
- 结论：语法正确；语义同时存在过宽与漏覆盖。
- 建议：将 `.claude/**` 收紧为 `.claude/rules/**`；补入 `scripts/**`、`deno.json`，与规则内“共享入口与高影响边界”保持一致。

### naming-and-dependencies.md

- 应命中：`src/core/logger.ts`（命中 `src/**`）；`web/routes/index.tsx`（命中 `web/**`）；`README.md`（显式命中）。
- 不应命中：`docs/testing/risk-matrix.yml`（不命中，符合预期）。
- 边界样本：`CLAUDE.md`（显式命中，承载跨 surface 术语约束，语义合理）。
- 结论：语法正确；语义范围适中。
- 建议：保持现有路径集合，不收紧。

### docs-sync.md

- 应命中：`README.md`、`config.example.yml`（均显式命中）。
- 边界样本：`src/config/schema.ts`（命中 `src/**`，合理）；`web/routes/index.tsx`（命中 `web/**`，合理）。
- 不应命中：`.claude/settings.json`（不命中，符合预期）。
- 结论：语法正确；语义轻度过宽，主要来自 `src/**`。
- 建议：收紧为“docs + 配置/入口/运行面相关代码”。推荐 `README.md`、`config.example.yml`、`src/main.ts`、`src/application/**`、`src/interfaces/**`、`src/config/**`、`src/sources/**`、`src/deliveries/**`、`web/**`。

### config-contract.md

- 应命中：`src/config/schema.ts`（命中 `src/config/**`）；`config.example.yml`、`README.md`（显式命中）。
- 边界样本：`src/deliveries/http.ts`（被 `src/**` 命中，语义偏离配置契约中心）。
- 不应命中：`web/routes/index.tsx`（不命中，符合预期）。
- 结论：语法正确；语义过宽，`src/**` 建议移除。
- 建议：以 `src/config/**` 为核心，补最小必要入口：`src/interfaces/**`、`src/main.ts`、`config.example.yml`、`README.md`。

### gitnexus.md

- 应命中：`src/core/logger.ts`（命中 `src/**`）；`web/routes/index.tsx`（命中 `web/**`）。
- 边界样本：`CLAUDE.md`（显式命中，作为顶层指令入口合理）；`.claude/settings.json`（被 `.claude/**` 命中，过宽）。
- 不应命中：`README.md`（不命中，符合预期）。
- 结论：语法正确；语义过宽集中在 `.claude/**`。
- 建议：保留 `src/**`、`web/**`、`CLAUDE.md`，将 `.claude/**` 收紧为 `.claude/rules/**`。

### logging-otel.md

- 应命中：`src/core/logger.ts`、`src/deliveries/http.ts`、`README.md`（均命中当前 paths）。
- 边界样本：`config.example.yml`（命中且合理，包含 `logging.format` 与默认值）；`src/testing/risk_mapping_test.ts`（不命中，符合“非日志规则”边界）。
- 语法判断：frontmatter 与 glob 语法正确。
- 语义判断：主体命中正确，但覆盖偏窄。`src/config/load_config.ts` 与 `src/infrastructure/deliveries/*_delivery_executor.ts` 存在真实 logger 调用点，当前 paths 未覆盖。
- docs/config 路径判断：`README.md` 与 `config.example.yml` 合理且应保留，它们承载 OTel 字段与 `json|pretty` 契约说明。
- 结论：语法正确；语义应放宽（过窄）。
- 建议：在现有集合上补 `src/config/**` 与 `src/infrastructure/**`，其余保持不变。

### logging-console.md

- 应命中：`src/core/logger.ts`、`web/routes/index.tsx`（当前均命中）。
- 边界样本：`README.md`、`config.example.yml`（均命中，且含 `logging.format` 与 `pretty` 展示层说明）；`src/config/schema.ts`（当前不命中，符合预期）。
- 语法判断：frontmatter 与 glob 语法正确。
- 语义判断：存在过宽。当前 `src/core/**`、`src/interfaces/**`、`src/web/**`、`web/**` 会命中大量与控制台展示层无关文件。
- docs/config 路径判断：文档与示例配置路径合理，应保留。
- 代码面判断：当前过宽；建议收紧到 logger 实现与直接运行面入口，避免把无关业务实现纳入规则触发。
- 结论：语法正确；语义应收紧（过宽）。
- 建议：`src/main.ts`、`src/core/logger.ts`、`src/core/logger_test.ts`、`src/interfaces/daemon/**`、`src/interfaces/web/**`、`web/routes/**`、`README.md`、`config.example.yml`。

### testing-architecture.md

- 应命中：`src/testing/risk_mapping_test.ts`、`web/routes/index_test.ts`、`docs/testing/risk-matrix.yml`、`.claude/settings.json`（当前均命中）。
- 边界样本：`scripts/run-paths.sh`（命中且合理，属于测试 task 路径分发基础设施）；`src/core/logger.ts`（不命中，符合预期）。
- 语法判断：frontmatter 与 glob 语法正确。
- 语义判断：主干命中正确，但测试基础设施覆盖不足。当前遗漏 `src/testing/**`（如 risk loader 本体）与 `.claude/skills/test-architecture-guard/**`（门禁实现脚本）。
- 缺失路径判断：存在缺口，建议补齐上述两类基础设施路径。
- 结论：语法正确；语义应放宽（过窄）。
- 建议：在现有集合上补 `src/testing/**` 与 `.claude/skills/test-architecture-guard/**`。

## 样本路径基线

- `README.md`
- `config.example.yml`
- `CLAUDE.md`
- `.claude/settings.json`
- `.claude/hooks/fmt.sh`
- `docs/testing/risk-matrix.yml`
- `docs/superpowers/specs/2026-04-15-rules-path-audit-design.md`
- `src/config/schema.ts`
- `src/core/logger.ts`
- `src/testing/risk_mapping_test.ts`
- `web/routes/index.tsx`

## 总建议

### 无需修改

- `naming-and-dependencies.md`

### 建议修改

- `execution.md`
- `docs-sync.md`
- `config-contract.md`
- `gitnexus.md`
- `logging-console.md`

### 应立即修改

- `verification.md`
- `logging-otel.md`
- `testing-architecture.md`

## 额外说明

- 语法正确但语义过宽：`execution.md`、`verification.md`、`docs-sync.md`、`config-contract.md`、`gitnexus.md`、`logging-console.md` 当前都可被解析并触发，但存在无关面命中或职责稀释。
- 合理重叠：`logging-otel.md` 与 `logging-console.md` 同时命中 `README.md`、`config.example.yml` 属于契约与展示层并行约束；`execution.md` 与 `verification.md` 在 `src/**`、`web/**` 的部分重叠属于工程执行与验证链路的自然交集。
- 为避免漏触发而保留稍宽匹配：`testing-architecture.md` 保留 `.claude/settings.json` 与 `scripts/run-paths.sh`，`logging-otel.md` 保留 `web/**` 与 `src/main.ts` 入口面，用于覆盖测试门禁与日志输出入口的真实变更路径。
- 落地偏差说明：`gitnexus.md` 的审计建议是收紧为 `.claude/rules/**` 命中；最终按用户决定改为 repo-wide 常驻 rule，因此不再使用 `paths:` frontmatter。
