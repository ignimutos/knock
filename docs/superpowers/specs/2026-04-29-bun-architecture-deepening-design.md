# Bun 迁移后架构加深与收口设计

## 背景

Knock 已从 Deno 迁到 Bun，当前主痛点不再是运行时兼容，而是迁移后留下的浅 Module、分散 orchestration、以及仍按“兼容层思维”保留的部分 adapter。当前仓库的对外契约已经基本稳定，接下来应优先把复杂度收回到更深的 Module 里，而不是继续通过更多 wrapper 分摊复杂度。

本设计采用一个总 spec，分 3 个可独立停止、可独立验证的 phase 推进：

1. 启动 / 运行时收口
2. Web orchestration 收口
3. `src/platform/*` adapter 清理

## 目标

- 保持 CLI 参数 shape、配置 shape 与主要失败路径语义稳定。
- 允许内部模块重组、文件搬家、命名调整。
- 允许 Web 管理面的内部 API 与内部 orchestration seam 重构。
- 优先提升以下两类收益：
  - **locality**：理解一个概念时，来回跳转的文件更少。
  - **leverage**：调用方面对更小的 Interface，更多行为被压进实现内部。
- 删除已经不再提供真实运行时隔离价值的浅 adapter。

## 非目标

- 不修改 `deliveries.<id>` canonical + `sources.<id>.deliveries` keyed override 契约。
- 不恢复 `templates` / `destinations` 等旧结构。
- 不变更 `${ENV_VAR}` 展开语义。
- 不改变数据库 schema、source/delivery pipeline 业务行为、或日志 OTel 契约。
- 不做一次性全目录重画；每个 phase 都必须可单独落地并停下。

## 设计原则

1. **先收口 orchestration，再清扫表层 wrapper。**
   若先做 adapter 删除，核心复杂度仍分散在启动链路与 Web action 链路里，收益有限。
2. **只在存在真实 seam 时保留 adapter。**
   一个 adapter 若只剩 re-export 或包一层 import，不再自动保留。
3. **对外契约稳定，内部 Interface 允许变小。**
   CLI、配置与 Web 响应 shape 继续稳定；内部模块之间的调用面应主动缩小。
4. **phase 之间单向依赖。**
   Phase 2 可以复用 Phase 1 的更深 runtime seam；Phase 3 只能清理由前两 phase 已稳定下来的 import 与 seam。

## 当前摩擦概览

### 启动 / 运行时

以下概念被拆在多个文件里：

- CLI 参数解析：`src/interfaces/cli/parse_cli_command.ts`
- 主入口分流：`src/main.ts`
- container 默认参数注入：`src/container_entrypoint.ts`
- Web 启动与 ready check：`src/interfaces/web/start_web.ts`
- production runtime 组装：`src/composition/create_production_runtime.ts`
- runtime support / kernel：`src/composition/production_runtime_support.ts`、`src/composition/create_runtime_kernel.ts`

结果是“应用如何启动”这个概念没有单一 Module 承担，调用侧和维护侧都需要跨多个 seam 理解同一件事。

### Web orchestration

以下流程存在重复：

- 解析 JSON body
- 同源写请求校验
- classify error → HTTP response
- 记录 log meta
- 加载 runtime config context
- 重建 reader/workbench overview
- 为单次 action 临时创建 runtime / DB

这些逻辑散在：

- `src/interfaces/web/create_config_action_handler.ts`
- `src/interfaces/web/create_source_action_handler.ts`
- `src/interfaces/web/create_playground_evaluate_handler.ts`
- `src/interfaces/web/config_management.ts`
- `src/interfaces/web/source_management.ts`
- `src/web/config_workbench_overview.ts`
- `src/web/reader_overview.ts`

### Platform adapters

`src/platform/*` 里同时存在两类东西：

- 真实 seam：如 `process.ts`、`env.ts`、`serve.ts`
- 近乎纯透传 adapter：如 `luxon.ts`、`preact.ts`、`preact_hooks.ts`、`preact_render_to_string.ts`、`preact_types.ts`

迁到 Bun 后，如果某个 adapter 既不隔离运行时差异，也不承载额外语义，它的 Interface 成本已经高于它提供的 leverage。

## Phase 1：启动 / 运行时收口

### 范围

只处理启动链路与 production runtime 组合根，涉及：

- `src/main.ts`
- `src/container_entrypoint.ts`
- `src/container_main.ts`
- `src/interfaces/cli/parse_cli_command.ts`
- `src/interfaces/web/start_web.ts`
- `src/composition/create_production_runtime.ts`
- `src/composition/production_runtime_support.ts`
- `src/composition/create_runtime_kernel.ts`

### 目标形态

新增一个更深的 startup/runtime orchestration Module，统一表达“当前进程该如何启动”。

建议目标结构：

- `src/interfaces/cli/parse_cli_command.ts`
  - 继续作为 CLI 参数解析 seam。
  - 保持现有 flag、默认值与报错约束。
- 新的 startup orchestrator（文件名可调整）
  - 接收解析后的 command + env。
  - 决定是 `daemon`、`web` 还是 `all`。
  - 统一 child-process policy、env 透传、first-exit handling。
- Web startup adapter
  - 保留 `start_web.ts` 中真正属于 Web boot 的逻辑：构建前端产物检查、ready probe、Web logging runtime bootstrap、HTTP server 生命周期。
- Production runtime adapter
  - 对外只暴露“创建 daemon runtime”的深 seam。
  - `production_runtime_support.ts` 与 `create_runtime_kernel.ts` 继续存在，但尽量下沉为该 seam 的实现细节。
- `main.ts` / `container_entrypoint.ts`
  - 收缩成薄入口 adapter。
  - `container_entrypoint.ts` 只负责 raw argv 标准化与 container 默认值注入，不再自己承担启动策略。

### 职责切分

#### 应保留在 CLI seam 的职责

- `--mode` / `--config` / `--runtime_dir` / `--immediate` / `--web_host` / `--web_port` 的解析与约束。
- 当前 `daemon` / `web` / `all` 的命令模型。

#### 应收口到 startup orchestrator 的职责

- `all` 模式拆分 daemon/web 子进程。
- 子进程 env 透传与 ready-check skip 策略。
- 谁先退出、如何终止另一侧、如何向上抛 exit 状态。
- 以何种方式调用 Web adapter 或 daemon runtime adapter。

#### 明确不纳入 Phase 1 的职责

- Web 管理动作内部流程。
- 配置编辑 / source action / playground 逻辑。
- source 执行、delivery 执行、summary 逻辑本身。

### 预期收益

- “应用如何启动”有单一入口可读。
- `main.ts` 与 `container_entrypoint.ts` 的删除测试会通过：删掉其中一个薄入口时，复杂度不会四散回调用方。
- Web 与 daemon 的启动策略更容易做行为级测试，而不是跨文件拼接测试。

### 风险与约束

- `start_web.ts` 里与 env 相关的 logging runtime 透传必须保持一致。
- `all` 模式的 sibling termination 行为不能漂移。
- 不得顺手改变 CLI 默认值或错误文案的语义分类。

### 验证

最小验证应覆盖：

- `bun run test:path -- src/main_test.ts src/container_entrypoint_test.ts src/composition/create_production_runtime_test.ts src/interfaces/daemon/start_daemon_test.ts`
- `bun run test:startup`
- `bun run check`

如改动扩散到共享高影响启动边界，追加：

- `bun run test`

## Phase 2：Web orchestration 收口

### 范围

只处理 Web action 的 orchestration 与 handler 共性，涉及：

- `src/interfaces/web/create_config_action_handler.ts`
- `src/interfaces/web/create_source_action_handler.ts`
- `src/interfaces/web/create_playground_evaluate_handler.ts`
- `src/interfaces/web/config_management.ts`
- `src/interfaces/web/source_management.ts`
- `src/interfaces/web/source_management_context.ts`
- `src/config/runtime_config_context.ts`
- `src/web/reader_overview.ts`
- `src/web/config_workbench_overview.ts`
- `web/routes/api/**`

### 目标形态

形成两个内部 seam：

1. **web action executor**
   - 统一 handler 层的共性：JSON body parse、同源写校验、error classify、HTTP response 生成、log meta hook。
   - 由 config/source/playground 各自注入 domain action 与 error classifier。

2. **runtime session / context seam**
   - 统一读取当前 runtime config context、复用 reader/workbench 重建路径。
   - source/config 继续保留各自的 domain loader，但不再各自散落相同的 context orchestration。

### 职责切分

#### 应属于 action executor 的职责

- request → payload 解析
- 写请求 same-origin gate
- success payload 直接透传
- error → `{ status, code, category, message }`
- 可选 log meta 采集

#### 应继续留在 domain action 的职责

- `updateGlobalConfig` 的配置更新与 schema 约束
- `updateSourceConfig` / `runSourceNow` / `clearSourceHistory` 的 source 领域行为
- playground 的 fetch / parse / warning 结果生成

#### 应属于 runtime session seam 的职责

- 读取 `loadConfigRuntimeContext({ envMode: 'preserve_unknown' })`
- 在一次操作里复用已加载的 compiled config / raw document
- 为 reader/workbench overview 提供统一重建路径

### 关键收口点

#### Source action

`runSourceNow` 当前会动态导入 `createProductionRuntime` 并临时创建 runtime；这一行为可以保留，但 runtime 的创建入口应来自统一 seam，而不是 action 自己拼装。

#### Config workbench

`loadConfigWorkbenchContext()` 与 `buildCurrentReaderOverview()` 之间已经形成真实组合关系，应保留为 workbench 专属 domain seam，而不是把两者硬塞进通用 handler。

#### Playground

playground 与 config/source 最大区别是不走 same-origin write gate，也不重建 reader/workbench；因此应复用 executor 的基础能力，但仍保持独立 action 类型。

### 明确不纳入 Phase 2 的职责

- 不改变 Web route path、HTTP method、成功响应 shape、错误 `code/category/message` shape。
- 不改变 config contract、secret redaction 语义、或 runtime_dir 路径约束。
- 不把 CLI、daemon、container 启动逻辑拉回 Web 模块。

### 预期收益

- handler 文件变成真正的薄 adapter。
- source/config/playground 共性被压进更深实现，不再有 3 套近似重复的 request orchestration。
- reader/workbench 的重建路径更明确，减少未来再出现“每个 action 自己 reload 一套”的倾向。

### 风险与约束

- config/source/playground 当前错误语义并不完全相同，收口时不能把消息细节抹平。
- source action 的 log meta 字段比 config 更丰富；共性 seam 必须允许 domain-specific meta，而不是强迫统一字段集。
- same-origin gate 只能用于需要写入的 action。

### 验证

最小验证应覆盖相关 route 与 domain 测试：

- `bun run test:path -- src/interfaces/web src/web web/routes/api`
- `bun run check`

若 action executor 的共性层影响面扩到多数 Web route，再追加：

- `bun run build:web`
- `bun run test:path -- web`

## Phase 3：`src/platform/*` adapter 清理

### 范围

只处理 platform adapter 的删除测试、内联与保留策略，不引入新的行为逻辑。

### 保留的 seam

以下 adapter 继续保留：

- `src/platform/process.ts`
  - 包含 `spawn` 包装、stdio 映射、main module 判定、spawn self / command 统一入口。
  - 已经是实际的 Node/Bun 进程边界 seam。
- `src/platform/env.ts`
  - 集中 `process.env` 读写语义，也被测试 runtime 与启动链路复用。
- `src/platform/serve.ts`
  - 封装 Bun `serve` 能力与关闭语义，是真实运行时 seam。

### 第一批优先删除 / 内联候选

这些文件默认应进入删除测试：

- `src/platform/luxon.ts`
- `src/platform/preact.ts`
- `src/platform/preact_hooks.ts`
- `src/platform/preact_render_to_string.ts`
- `src/platform/preact_types.ts`

这些 adapter 当前主要是 import 透传，删除后复杂度不会回流到调用方。

### 第二批条件删除候选

以下文件需要先验证 interop，再决定删除：

- `src/platform/ky.ts`
- `src/platform/yaml.ts`
- `src/platform/croner.ts`
- `src/platform/liquidjs.ts`

判断标准：

- 若 direct import 在 Bun 下可稳定工作，且不会破坏类型或默认导出形态，则删除。
- 若 direct import 会再次引入 CJS/ESM 兼容噪音，保留 adapter，但应让它承担清晰的 interop 责任，而不是假装通用 seam。

### 删除策略

Phase 3 必须按小批次推进，而不是一次性删除全部 adapter：

1. 先删除一组纯透传 preact/luxon adapter。
2. 跑 scoped check 与相关 web/test。
3. 再处理 `yaml` / `ky` / `croner` / `liquidjs` 这组可能带 interop 风险的 adapter。
4. 任一批次若暴露运行时或类型层兼容噪音，即停在该批次，不继续扩大范围。

### 明确不纳入 Phase 3 的职责

- 不借机改写调用侧业务逻辑。
- 不把 config/schema/core/web 的职责重新搬运。
- 不为了“目录整齐”而移动无关模块。

### 预期收益

- `src/platform/*` 更接近真实边界，而不是“所有第三方包都要包一层”。
- 导航成本下降。
- Bun 迁移后的真实 interop 约束会被显式化，而不是隐藏在一堆浅 Module 后面。

### 风险与约束

- `yaml`、`ky`、`croner` 可能仍然依赖当前 `createRequire`/导出形态。
- `liquidjs` 当前通过 `class Liquid extends LiquidBase {}` 提供一个很轻的命名锚点；若删除，调用点类型与扩展姿势要一起确认。
- preact 类型导入与默认/命名导出差异可能导致 TS 层回归。

### 验证

建议按批次运行：

第一批（preact/luxon）：

- `bun run check`
- `bun run build:web`
- `bun run test:path -- web src/web`

第二批（yaml/ky/croner/liquidjs）：

- `bun run check`
- `bun run test:path -- src/config src/core src/main_test.ts src/container_entrypoint_test.ts
- `bun run test:startup`

如第二批影响面扩大，再追加：

- `bun run test`

## 跨 phase 约束

### 契约稳定边界

以下表面在整个设计里都视为稳定：

- CLI 参数名与基本行为模型
- 配置 shape 与 keyed override 契约
- `${ENV_VAR}` 展开语义
- Web route path / method / 响应顶层 shape

### 允许变化的边界

以下表面允许在 phase 内部调整：

- 内部模块命名与目录结构
- `src/interfaces/*` 与 `src/web/*` 之间的内部调用方式
- runtime / session / executor 的内部 seam
- `src/platform/*` 中无真实边界价值的透传 adapter

### Phase 停止条件

每个 phase 结束时都必须满足：

- scoped verification 通过
- 对外契约无未声明漂移
- 下一 phase 可以延期而不导致当前结构处于半成品

## 推荐落地顺序

1. 先完成 Phase 1，稳定 startup/runtime seam。
2. 再完成 Phase 2，让 Web action 复用更深 runtime/context seam。
3. 最后完成 Phase 3，按删除测试清扫 adapter。

这个顺序的原因是：前两 phase 在“把复杂度收回去”，第三 phase 才在“删除不再需要的表层”。若顺序反过来，容易先制造一轮 import churn，再重新改 orchestrator，收益被稀释。

## 验证总览

### docs-only 当前阶段

本次只写设计文档，不改代码，因此当前只做以下一致性检查：

- 文中引用的文件路径均存在于仓库。
- 文中引用的验证命令均存在于 `package.json` scripts 或 Bun test 直接路径调用中。

### 后续实现阶段的最小基线

- Phase 1：`bun run test:startup` + 相关 startup tests + `bun run check`
- Phase 2：相关 web/domain tests + `bun run check`
- Phase 3：按批次 scoped tests/check；涉及广泛 import rewiring 时再上 `bun run test`

## 结论

本轮优化不追求“全仓库统一抽象”，而是按收益优先级收口三个真实摩擦面：

- 启动 / 运行时没有深 Module
- Web action orchestration 重复
- `src/platform/*` 混有大量浅 adapter

完成这三步后，Knock 在 Bun 时代的结构会更接近“少量深 seam + 薄入口 adapter”，后续再做功能开发时，理解成本、回归面与 AI 导航成本都会下降。
