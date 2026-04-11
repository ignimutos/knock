# CLAUDE.md

## Canonical scope

- `CLAUDE.md` 是本仓库唯一的 **canonical tracked agent-instruction surface**。
- 关键字 `MUST` / `MUST NOT` / `SHOULD` / `SHOULD NOT` / `MAY` 按 RFC 2119 解释。
- 其他表面（如本地插件、skills、历史目录）可以存在并被使用，但 **MUST NOT** 与本文件形成竞争性规则源。

## Project snapshot

- Knock 是 Deno + TypeScript 守护进程：抓取 RSS / Atom / JSON Feed / XQuery 定义源，统一 feed 与 entry 字段，用 Liquid 过滤与渲染，投递到 file / Telegram / HTTP，用 SQLite 保存状态与去重信息。
- Entry: `src/main.ts`；参考配置: `config.example.yml`；Toolchain: Deno + TypeScript (ES modules) + `zod` + SQLite + Drizzle ORM。
- `runtime/` 可作本地手工测试沙箱；它 **MAY** 不存在，且 **MUST NOT** 被视为规范文档来源。

## Repository map

- `src/main.ts` - CLI 解析与启动入口
- `src/core/` - 编排、调度、日志、模板执行、HTTP 传输
- `src/config/` - 配置加载、校验、解析、运行时语义
- `src/sources/` - syndication 与 XQuery 解析器
- `src/deliveries/` - file / telegram / http 投递适配器
- `src/db/` - SQLite 客户端、schema、保留策略

## Common commands (`deno.json`)

- `deno task start` - 运行守护进程
- `deno task check` - 类型检查；无参数时使用默认入口，传入文件/目录时仅检查对应范围
- `deno task fmt` / `deno task fmt:check` - 格式化 / 校验
- `deno task lint` / `deno task lint:check` - lint 修复 / 校验
- `deno task test` - 测试；无参数时全量，传入文件/目录时仅运行对应范围
- `deno task build` - 编译二进制
- 当标准 task 存在时，agents **MUST** 优先使用 task，而不是 ad hoc 命令。

## Core contracts

### Errors and external contracts

- 多个测试断言精确中文错误信息；除非任务明确要求，否则 **MUST** 保持原文。
- CLI 与配置契约除非任务明确变更，否则 **MUST** 保持稳定。
- 失败路径 **MUST** 可见，**MUST NOT** 静默吞错。

### Config model

- 当前配置模型：`deliveries.<id>` 定义投递，`sources.<id>.deliveries` 引用投递 ID 数组，并允许内联 `file` / `telegram` / `push` 投递块。
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

## Worktree policy

- 功能开发前 **SHOULD** 优先使用本地 `/workflow-init` 入口开始 workflow，并进入目标 worktree。
- 将 workflow 结果合回 `main` 的收尾操作（如 `merge` / fast-forward / `cherry-pick`）**MAY** 保留，并 **SHOULD** 使用 `/workflow-finish` 入口完成收尾。
- 非 worktree 环境 **MAY** 进行只读检查、计划阶段工作与其他不依赖 worktree 隔离的操作。
- `/exit` **MUST NOT** 被描述为自动删除 worktree 或自动合并改动。

## Execution rules

- 修改前 **MUST** 先读目标模块及相邻上下文；行为改动前 **MUST** 先读相邻测试。
- 非平凡任务（多文件、接口/状态变化、重构）**MUST** 先有简短计划（目标 / 实现 / 验证）。
- 当只有一个选项时，**MUST** 直接继续执行；只有存在多个合理选项且会改变实现范围或方案时，**MAY** 向用户提问确认。
- **MUST** 保持原子变更，**MUST NOT** 混入无关清理。
- 如前提缺失、假设失效或验证失败，**MUST** 停止并重新规划；必要时报告 `BLOCKED: <reason>`。
- 无真实阻塞、无高风险确认、无真实方案分叉时，**MUST NOT** 以“等你回复 / 等你确认 / 如果你要我继续 / 我先停在这里”这类等待式文案收尾。
- 若当前只有一个低风险、明显的下一步，**MUST** 直接继续执行，而不是把继续权交还用户。
- 只有在以下情况，agent **MAY** 停下并请求用户参与：
  1. 真实阻塞，继续执行无意义
  2. 高风险 / 不可逆 / 影响共享状态的操作需要确认
  3. 存在真实方案分叉，下一步取决于用户选择而不是执行惯性
- 实现取舍优先级 **SHOULD** 为：
  1. correctness
  2. direct path to target structure
  3. single source of truth
  4. smallest complete fix
  5. root-cause repair
  6. maintainability

## Naming, comments, observability, dependencies

### Naming and observability

- 同一概念在 config / types / tests / docs / CLI / error 中 **MUST** 使用稳定术语；外部可见命名变化 **MUST** 联动检查相关表面。
- 运行时流程、重试、过滤、降级、投递改动时，**MUST** 保持或提升可观测性。

### Comments and TODOs

- **SHOULD** 优先用命名与结构表达语义，而非堆注释。
- 自然语言注释 **MUST** 使用中文。
- TODO / FIXME 仅在真实延期时保留，并写明延期原因与移除条件。

### Dependency choices

- 新增依赖优先级 **SHOULD** 为：1. 原生 JS/TS API；2. `@std/*`；3. `remeda`；4. 领域库（仅当前三者不足时）。
- **MUST NOT** 为引入依赖而加无价值包装层。
- 新的不可信结构化输入边界 **SHOULD** 在边界处一次性用 `zod` 校验。

## Verification and review

### Shared / high-risk boundaries

- 这些区域改动需要额外谨慎，并优先检查相邻测试：
  - `src/main.ts` / `src/main_test.ts`
  - `src/config/*`
  - `src/core/app.ts` / `src/core/*_test.ts`
  - `src/deliveries/*`
  - `src/sources/*`

### Docs-only changes

- **MUST** 校验提到的路径与命令真实存在，或明确标记为可选本地路径。
- 可不跑代码，但 **MUST** 完成最小闭环：一致性检查 + 影响面回顾 + 明确报告未运行项。

### Code changes

- **MUST NOT** 在未验证行为前宣告完成。
- **MUST** 先跑最窄相关验证，优先使用 `deno task test <file-or-dir>`。
- 对 `fmt` / `fmt:check` / `lint` / `lint:check` / `check` / `test` 这类支持 scoped 输入的 task，agent 直接调用时 **MUST** 传入实际需要检查的文件或目录；只有明确需要默认基线验证时，才 **MAY** 无参调用。
- 对共享入口、测试基础设施、数据库基础设施、共享运行时边界，或影响面无法可靠枚举的改动，收尾前 **MUST** 运行一次全量 `deno task test`。
- 对影响面可枚举的局部改动，**SHOULD** 按受影响文件、目录与直接调用边界扩大验证，**MUST NOT** 机械追加全量 `deno task test`；若影响共享边界但不足以要求全量，agent **SHOULD** 显式补跑关联测试文件或目录，**MUST NOT** 依赖 workflow 脚本隐式推断慢测组。
- 调用 `workflow-finish` 脚本时，agent **MUST** 先显式整理并传入 `--path`；这些路径除了直接改动文件外，**SHOULD** 包含需要补跑的关联测试文件或目录。
- 典型全量触发项：`deno.json`、`scripts/run-paths.sh`、`src/test_runtime.ts`、`src/main.ts`、`src/core/app.ts`、`src/db/client.ts`、`src/db/schema.ts`、`src/db/migrations/**`、`src/sources/xquery.ts`、`src/sources/source_runtime.ts`。
- 按改动影响 **MUST / SHOULD** 运行 `deno task check`、`deno task lint:check`、`deno task fmt:check`，以及 `deno task build`（仅 build 受影响时）。

### Final review output

- 最终交付 **SHOULD** 明确：改了什么、通过了哪些验证、哪些未运行、剩余风险或后续事项。

### CI reality

- 当前工作流文件：`.github/workflows/docker.yml`。
- 该工作流当前主要执行 Docker build / push。
- CI 目前不强制执行 `fmt` / `check` / `lint` / `test`；本地验证基线仍应按本文件执行。
