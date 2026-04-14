# CLAUDE.md

## Canonical scope

- `CLAUDE.md` 是本仓库唯一的 **canonical tracked agent-instruction surface**。
- 关键字 `MUST` / `MUST NOT` / `SHOULD` / `SHOULD NOT` / `MAY` 按 RFC 2119 解释。
- 其他表面（如本地插件、skills、历史目录）可以存在并被使用，但 **MUST NOT** 与本文件形成竞争性规则源。

## Project snapshot

- Knock 是 Deno + TypeScript 的抓取与投递系统，支持 daemon 与 web 两个运行面。
- CLI 入口是 `src/main.ts`，通过 `--mode` 支持 `all` / `daemon` / `web`。
- 配置契约由 `src/config/schema.ts` 的 zod schema 定义，运行时配置加载与解析在 `src/config/`。
- source 类型包含 fetch source 与 summary source；fetch parser 使用 syndication / xquery。
- 投递链路覆盖 file / push / email（push 通过 HTTP 传输）；状态持久化由 SQLite 承担。

## Repository map

- `src/main.ts` - CLI 参数解析与进程模式启动入口
- `src/application/` - 用例编排（run source / run due sources / preview source）与 ports
- `src/interfaces/` - 配置、daemon、web 运行面装配
- `src/domain/` - 领域实体与运行计划模型
- `src/config/` - 配置加载、校验、解析、能力约束与类型
- `src/sources/` - syndication / summary / xquery 源处理实现
- `src/deliveries/` - file / push / email 投递实现
- `src/core/` - logger、scheduler、liquid、AI runtime、HTTP client 等共享运行时能力
- `src/db/` - SQLite client、schema、migrations
- `src/infrastructure/` - 仓储实现与支撑实现
- `src/web/` - web playground 运行逻辑
- `web/` - Fresh 入口、路由与组件
- `scripts/run-paths.sh` - task 的 scoped 路径分发脚本

## Common commands (`deno.json`)

- `deno task start` - 默认启动 web + daemon（默认 `--mode all`）
- `deno task web` - 只启动 web 进程
- `deno task daemon` - 只启动 daemon 进程
- `deno task dev` - 开发期启动别名（等同 `start`）
- `deno task check [path ...]` - 类型检查；默认检查 `src/main.ts`、`web/main.ts`、`web/routes/**/*.tsx`、`web/islands/**/*.tsx`，传入路径时按路径检查
- `deno task fmt [path ...]` / `deno task fmt:check [path ...]` - Prettier 格式化 / 校验
- `deno task lint [path ...]` / `deno task lint:check [path ...]` - Deno lint 修复 / 校验
- `deno task test [path ...]` - 测试；默认覆盖 `src` 与 `web`，传入路径时按路径执行
- 当标准 task 存在时，agents **MUST** 优先使用 task。

## Core contracts

### Errors and external contracts

- 多个测试断言精确中文错误信息；除非任务明确要求，否则 **MUST** 保持原文。
- CLI 与配置契约除非任务明确变更，否则 **MUST** 保持稳定。
- 失败路径 **MUST** 可见，**MUST NOT** 静默吞错。

### Config model

- 当前配置模型：`deliveries.<id>` 定义 canonical delivery，`sources.<id>.deliveries` 是 keyed map；key 为 delivery ID，value 为该 source 对对应 delivery 的 override。source 侧只允许按 delivery 类型覆写消息子树：file 覆写 `file.content`、push 的 canonical 消息子树是 `push.request.payload` 且 source override 键为 `payload`、email 覆写 `email.message`；空 override 使用 `{}`。
- **MUST NOT** 恢复 `templates` / `destinations` 等旧结构。
- **MUST** 保持单一事实源，**MUST NOT** 制造双 shape。
- 若任务未明确要求迁移兼容，**MUST NOT** 添加历史字段兼容层、别名或迁移提示。

### Secrets and runtime data

- **MUST** 保留 `${ENV_VAR}` 展开语义。
- **MUST NOT** 在代码或提交配置中硬编码 token/chatId/password 等 secrets。
- **MUST NOT** 在日志中输出敏感原始值。

### Docs sync

- 行为、配置 shape、命名、CLI 输出或错误文案变化时，**MUST** 同步检查 `README.md` 与 `config.example.yml`。
- **MUST NOT** 记录代码未实现的行为。

## Execution rules

- 修改前 **MUST** 先读目标模块及相邻上下文；行为改动前 **MUST** 先读相邻测试。
- 非平凡任务（多文件、接口/状态变化、重构）**MUST** 先有简短计划（目标 / 实现 / 验证）。
- **MUST** 保持原子变更，**MUST** 避免混入无关清理。
- 如前提缺失、假设失效或验证失败，**MUST** 停止并重新规划；必要时报告 `BLOCKED: <reason>`。
- 只有真实阻塞、高风险共享状态操作、或真实方案分叉时，**MAY** 请求用户参与。
- 实现取舍优先级 **SHOULD** 为：correctness → direct path to target structure → single source of truth → smallest complete fix → root-cause repair → maintainability。

## Naming, comments, observability, dependencies

- 同一概念在 config / types / tests / docs / CLI / error 中 **MUST** 使用稳定术语。
- 注释与 TODO **SHOULD** 保持最小化；自然语言注释 **MUST** 使用中文；保留 TODO/FIXME 时 **MUST** 写明延期原因与移除条件。
- 日志与可观测性改动 **MUST** 同步遵循 `.claude/rules/logging-otel.md` 与 `.claude/rules/logging-console.md`。
- 新增依赖优先级 **SHOULD** 为：原生 JS/TS API → `@std/*` → `remeda` → 领域库。
- 新的不可信结构化输入边界 **SHOULD** 在边界处一次性用 `zod` 校验。

## Testing Architecture

- 风险矩阵：`docs/testing/risk-matrix.yml`
- 规则：`.claude/rules/testing-architecture.md`
- 门禁 skill：`.claude/skills/test-architecture-guard/SKILL.md`

## Verification and review

### Docs-only changes

- **MUST** 校验提到的路径与命令真实存在。
- 可不跑代码；交付中 **MUST** 明确一致性检查结果与未运行项。

### Code changes

- **MUST NOT** 在未验证行为前宣告完成。
- **MUST** 先跑最窄相关验证，优先使用 scoped task：`deno task test <path>`。
- 对 `check` / `fmt:check` / `lint:check` / `test`，agents 直接调用时 **MUST** 传入受影响路径；需要基线验证时 **MAY** 无参调用。
- 共享入口与高影响边界改动收尾前 **MUST** 运行全量 `deno task test`；典型边界包括 `src/main.ts`、`src/core/app.ts`、`src/db/*`、`src/sources/xquery.ts`、`src/test_runtime.ts`、`deno.json`、`scripts/run-paths.sh`。
- 按改动影响 **SHOULD** 追加 `deno task check`、`deno task lint:check`、`deno task fmt:check`。

### Final review output

- 最终交付 **SHOULD** 明确：改动内容、已运行验证、未运行验证、剩余风险或后续事项。

## CI reality

- 当前仓库工作流：`.github/workflows/docker.yml`。
- CI 目前聚焦 Docker build / push。
- 本地验证基线仍由 `fmt:check`、`lint:check`、`check`、`test` 负责。
