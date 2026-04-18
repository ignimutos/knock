# Knock Final Rewrite Design

## 摘要

本设计以当前代码为起点，定义 Knock 的唯一最终重构方向。目标不是继续修补 `runtime/pipeline` 局部中间态，而是把系统收成一套围绕 `SourceRun` 事务根组织的单内核执行架构：内部以 `DefinitionSet` 作为唯一装配输入，以 `SourceRun / PipelineItem / DeliveryAttempt` 作为唯一运行事实源，以统一的 application use cases 作为 daemon / CLI / web / playground 的唯一业务入口。

本轮接受完全重构，不承担兼容负担；允许重画 CLI 与 config 外部契约，但当前 web/playground 外部输入输出面先冻结为迁移边界，避免在内核尚未稳定前把对外 surface 一起打散。当前仓库中已经落地的 v2 种子（`RunSourceUseCase` 的 `plan/collect/execute` 边界、runtime-definition consistency tests、canonical email payload、full-pipeline fail-fast、query service 不变式）全部视为可复用资产，而不是推倒重来。

## 背景与问题

当前代码已经明显离开旧 runtime/helper 串联结构，但仍停留在半收口状态：

1. `RunSourceUseCase` 已形成 `plan/collect/execute` 边界，但 `execute()` 仍可在缺 pipeline 依赖时退化为 collect-only，语义上仍混合了“完整执行”和“轻路径采集”。
2. daemon、preview、playground 已共享部分 runtime helper，但组合根仍分散在 `src/interfaces/create_source_execution_core.ts`、`src/interfaces/daemon/create_daemon_runtime.ts`、`src/interfaces/web/preview_runtime.ts` 与 `src/core/app.ts`，入口之间仍可能漂移。
3. `src/interfaces/config/load_definitions.ts` 已承担事实上的 definitions 编译职责，但仍处于过渡态：它一边消费 resolved config，一边生成内部 definition/binding，尚未升级为唯一正式 compiler。
4. `src/config/types.ts` 仍同时承载外部配置解析结果与运行时装配中间态，使 config shape 继续反向塑造内部模型。
5. `src/infrastructure/sqlite/source_run_query_service.ts` 已提供 run/item/attempt 反序列化与不变式校验，但 query layer 仍未被提升为正式读取边界。
6. preview 语义仍不够硬：现有 preview runtime 可走到真实 delivery executor 装配，副作用边界并未被系统级冻结。
7. daemon 调度与 source 执行虽已通过 `RunDueSourcesUseCase` 部分收敛，但 daemon 侧仍持有 due-source 判定、循环与执行细节，存在“调度真相”和“执行真相”双源风险。

因此，本轮不再把 `runtime/pipeline` 视作单独局部重构，而是把它升级为一份覆盖 definitions、composition、use case、facts/query、CLI/config、daemon/preview/web 边界的最终总设计。

## 目标

1. 以 `SourceRun` 为唯一执行事务根，重写并收紧运行内核。
2. 以 `DefinitionSet` 为唯一内部装配输入，终止 config → resolved config → transient binding/runtime model 的多重投影链。
3. 让 daemon / CLI / web / playground 共享同一 application 内核，只在 interface 与 policy 层区分。
4. 让 `ExecuteRun`、`CollectSource`、`PreviewRun` 成为显式语义，不再依赖隐式降级或 wiring 缺省。
5. 把运行期真相固定为 `SourceRun / PipelineItem / DeliveryAttempt` facts 与其 query views。
6. 把组合根单独提升为 `composition` 层，移除散落在 interfaces/core 中的半业务化装配逻辑。
7. 在接受完全重构的前提下，重画 CLI/config 外部协议，使其只表达用户意图，不再泄漏内部 wiring 细节。
8. 最终删除过渡层、旧 helper 与中间态双 shape，避免半旧半新长期共存。

## 非目标

1. 本轮不保留历史 CLI、config、runtime helper、旧 schema 的兼容层。
2. 本轮不做长期双写、双 schema、双 query surface。
3. 本轮不把 web/playground 的外部 surface 一起大范围改写；它们在内核切稳前先作为迁移边界冻结。
4. 本轮不把日志当成状态真相；日志只负责轨迹，facts/query 负责状态。
5. 本轮不把“现有 batch 计划未完成项”原样延续为新的 canonical 计划结构；旧计划仅作背景。

## 已确认前提

1. 用户接受完全重构，不要求兼容。
2. 当前已经落地的 v2 种子可以保留并演化，不需要为了“纯度”推倒重写。
3. 当前外部 web/playground surface 先尽量稳定，但不是长期硬约束。
4. 新的最终设计应覆盖 `runtime/pipeline` 主线及相邻的 config/runtime assembly/definitions 重构，而不是只补 Batch 5 尾项。

## 最终目标架构

### 1. 五层结构

#### A. Domain

只保留第一性业务对象、状态机与不变式：

- `SourceRun`
- `PipelineItem`
- `DeliveryAttempt`
- `DefinitionSet` 内部定义对象
- 运行 profile / trigger / effect policy
- query view DTO 的稳定语义

#### B. Application

只保留 use case 与业务编排：

- `CompileDefinitions`
- `PlanRun`
- `CollectSource`
- `ExecuteRun`
- `PreviewRun`
- `RunDueSources`
- `QueryRuns`
- `RecoverAttempts`
- `PruneFacts`

#### C. Infrastructure

只保留对外部世界的 adapters：

- SQLite facts / query repositories
- HTTP / byparr input gateways
- parsers
- AI / content runtime adapters
- file / push / email delivery adapters
- scheduler adapter
- logging sinks / formatters

#### D. Interfaces

只保留输入输出翻译：

- CLI command parsing
- daemon bootstrap
- web handlers
- playground request/response mapping
- config file loading

#### E. Composition Root

单独负责 wiring：

- 从 `DefinitionSet` 装配 application + infrastructure
- 为 production / preview / playground 注入不同 policy
- 不持有业务真相，不承载对外协议语义

### 2. 单一事实源

最终系统只保留三类单一事实源：

#### A. `DefinitionSet`

唯一内部装配输入。所有 runtime、use case、query、scheduler 都只吃它，不再各自拼 bindings、requestType、override merge 结果。

#### B. Execution Facts

唯一运行真相：

- `source_runs`
- `pipeline_items`
- `delivery_attempts`

不再混用 config snapshot、helper state、临时 DTO 来表达运行结果。

#### C. Query Views

所有 CLI/web/ops/debug 读取面都从 query service 出，不再各处手工拼接 run/item/attempt 状态。

## 核心执行内核

### 1. 显式 use cases

最终固定以下 use cases：

- `CompileDefinitions`
- `PlanRun`
- `CollectSource`
- `ExecuteRun`
- `PreviewRun`
- `RunDueSources`
- `QueryRuns`
- `RecoverAttempts`
- `PruneFacts`

### 2. 关键语义约束

#### `ExecuteRun`

`ExecuteRun` 永远表示完整执行。

- 只要叫 `execute`，就必须具备完整 pipeline/facts/delivery/logging wiring。
- 不允许“缺依赖就 quietly collect-only”。
- production 组合根与 preview 组合根都必须显式声明其 effect policy，不再借 wiring 缺省决定语义。

#### `CollectSource`

独立表示 `plan + fetch + parse` 的轻路径采集。

- collect-only 必须通过显式 use case 进入。
- playground 默认走 collect 或 preview，不再把 collect-only 隐藏在 execute 的退化分支里。

#### `PreviewRun`

不是另一套业务内核，只是同一内核在 preview-effect policy 下的显式包装。

- 复用同一套 definitions、planner、collector、pipeline。
- 使用 volatile facts / capture sink / no external side effects。
- 不允许直连真实 delivery executor。

### 3. 固定流水线

单次执行固定为：

`compile definitions -> plan run -> collect source -> parse -> normalize items -> filter -> item dedupe -> materialize delivery attempts -> render -> dispatch/capture -> finalize item/run -> persist facts -> expose query views`

此顺序可以由多个 use case 组合完成，但语义顺序不允许漂移。

## Definition Compiler 与外部输入面

### 1. 正式编译链

最终流程固定为：

`Raw Input -> Parse -> Validate -> CompileDefinitions -> DefinitionSet -> Composition Root -> Use Cases`

### 2. 各阶段职责

#### Raw Input

面向用户与外部系统：

- config file
- CLI flags / subcommands
- 未来管理 API 或其他输入面

#### Parse / Validate

只负责外部协议合法性，不掺入运行时真相与装配判断。

#### `CompileDefinitions`

把外部输入编译成唯一内部模型：

- source definitions
- delivery definitions
- run policies
- preview policies
- scheduler policies
- query/read model policies

#### `DefinitionSet`

成为唯一装配输入。daemon、CLI、preview、playground 都只读取它。

### 3. config / CLI 重画原则

- 允许完全重画。
- config 不再是运行时真相，只是可编译规格。
- CLI 不再直连 runtime helper，而是生成 command input，再交给 compiler/use case。
- 外部协议只表达意图，不表达内部 wiring 细节。
- 不再保留 `DeliveryConfig | ResolvedDeliveryConfig` 这种内部双语义中间态。

## preview / daemon / web / playground 统一方式

### 1. 统一点

四类入口全部：

- 先产出同一个 `DefinitionSet`
- 调用同一批 application use cases
- 共享同一 facts/query 模型
- 通过 composition root 注入不同 policy

### 2. 隔离点

#### production

- 真实 facts
- 真实 dedupe
- 真实 delivery
- 真实 recovery/prune 可见性

#### preview

- volatile facts
- capture sink
- no external side effects
- 不写 production dedupe

#### playground

- 默认 collect-only 或 preview-effect
- 不知道 parser/gateway/wiring 细节
- 保持现有 request/response shape 为冻结边界

#### web API

- 保持当前外部 response shape
- 内部不再携带运行时装配判断

## 副作用矩阵

在任何实现推进前，必须先冻结以下矩阵：

| 场景                             | facts 持久化          | dedupe 写入 | 真实 delivery         | recovery/prune 可见 |
| -------------------------------- | --------------------- | ----------- | --------------------- | ------------------- |
| `CollectSource`                  | 否                    | 否          | 否                    | 否                  |
| `PreviewRun`                     | 仅 volatile           | 否          | 否，改为 capture sink | 否                  |
| `ExecuteRun` + preview-effect    | 可选 volatile，默认否 | 否          | 否，改为 capture sink | 否                  |
| `ExecuteRun` + production-effect | 是                    | 是          | 是                    | 是                  |

硬规则：

1. `ExecuteRun` 只允许 preview-effect 与 production-effect 两种显式 policy。
2. `PreviewSourceUseCase` 不得再装配真实 delivery executor。
3. playground 默认不进入真实副作用路径。
4. 若未来需要“手工真投递”，必须显式走 production-effect。

过渡期硬门槛：

- 在任何 compiler/composition 重构开始前，必须先把 preview/playground 路径强制切到 capture sink，并禁止装配真实 delivery executor。
- 在这一步完成并由自动化测试锁住之前，不得推进后续更大范围的 runtime/CLI/config 重构。
- 这条门槛优先级高于目录整理、compiler 引入与接口层重画，因为它直接关系到误发外部副作用风险。

## 调度、并发与幂等

### 1. 调度真相

`RunDueSourcesUseCase` 成为唯一 due-source 执行入口。

daemon 最终只负责：

- 时钟 / cron 触发
- 进程生命周期
- source 级串行锁
- 把触发请求交给 application

daemon 不再持有 due-source 判定与 source 执行细节的业务真相。

### 2. 并发规则

- 同一 `sourceId` 默认禁止并发 production 执行。
- scheduled 触发命中运行中 source 时，必须显式 skip/merge 并记录原因。
- manual / immediate 命中运行中 source 时，必须返回显式冲突，不得隐式排队或重入。
- preview 不占 production source 锁，但也不写 production facts。

### 3. 幂等边界

- `SourceRun` 是事务根。
- `DeliveryAttempt` 的核心幂等边界是 `(runId, itemId, deliveryId)`。
- dedupe 写入只发生在 production-effect。
- query 面必须能解释为什么没跑、为什么跳过、为什么没投递。

## 数据与查询模型

### 1. 写模型

写模型固定围绕 execution facts：

- `source_runs`
- `pipeline_items`
- `delivery_attempts`

### 2. 读模型

读模型通过正式 query layer 暴露，不直接暴露底表拼接细节。

- CLI、web、debug、ops 都通过 query service 读取。
- preview 可使用 volatile / in-memory facts，但查询协议保持一致。
- `RecoverAttempts`、`PruneFacts` 只操作 facts，不操作 config 或外部协议语义。

### 3. `QueryRuns` 最小合同

新的 query layer 至少必须稳定提供：

- `getRun(runId)`：返回 run + items + attempts 的完整视图
- run 级字段：trigger、profile、effectDomain、status、counts、时间戳
- item 级字段：status、skippedReason、normalized snapshot
- attempt 级字段：deliveryId、channel、status、reason、renderedSnapshot 摘要
- 对不存在对象返回明确 `undefined`/not-found 语义，不抛模糊错误

在更广 query surface 设计完成前，以上最小合同必须先被 contract tests 锁住，作为 CLI/web/debug 的共同读取基线。

## 目录重画

建议最终目录：

- `src/domain/`
- `src/application/`
- `src/infrastructure/`
- `src/interfaces/`
- `src/composition/`
- `src/definitions/`（或并入 `src/domain/definitions/`）
- `src/query/`（或并入 `src/application/queries/`）

### 当前目录的处理原则

1. `src/core/` 最终应被清空或只剩真正无业务共享能力。
2. `src/sources/`、`src/deliveries/` 下沉到 `src/infrastructure/`。
3. `src/interfaces/create_source_execution_core.ts` 迁入 `src/composition/` 并拆分。
4. `src/interfaces/config/load_definitions.ts` 升级为正式 compiler 入口或其输入 adapter。
5. `src/config/types.ts` 不再承载内部运行时真相。

## 对现有代码的取舍

### 保留并作为种子

- `src/domain/*`
- `src/application/run_source_use_case.ts`
- `src/application/preview_source_use_case.ts`
- `src/application/run_due_sources_use_case.ts`
- `src/application/stages/*`
- `src/infrastructure/sqlite/source_run_query_service.ts`
- `src/interfaces/runtime_definition_consistency_test.ts`
- canonical payload 路径：`src/application/stages/render_stage.ts`、`src/infrastructure/deliveries/email_delivery_executor.ts`
- `createRunSourceUseCaseForRuntime` 中的 `requireFullPipeline` fail-fast 机制

### 视为过渡物并准备替换

- `src/interfaces/config/load_definitions.ts`
- `src/interfaces/create_source_execution_core.ts`
- `src/interfaces/daemon/create_daemon_runtime.ts`
- `src/interfaces/web/preview_runtime.ts`
- `src/core/app.ts`
- `src/main.ts` 当前多模式 child-process orchestration
- `src/config/types.ts` 中把 resolved config 继续当内部模型使用的做法

## SQLite / facts cutover 策略

### 1. 默认策略

默认采用一次性切 schema / 切库，不保旧运行时兼容：

- 新内核使用新的 facts schema 版本。
- 不做长期双写。
- 不为旧 schema 保留长期兼容壳。

### 2. dedupe 策略

- 默认不迁移旧 dedupe 状态。
- 若业务确有需要，单独设计一次性 importer，作为独立任务，不反向污染新内核模型。

### 3. cutover 规则

- 切换前，新 schema 必须通过 contract/query/smoke tests。
- 切换后删除旧表、旧 repository、旧 query façade。
- 不保“旧 schema 继续跑，新代码顺手适配”的中间态。

## 观测等价标准

### 1. 观测主键

必须持续可用的业务主键：

- `source.id`
- `source.run_id`
- `pipeline.item_id`
- `delivery.id`

### 2. 重构后必须仍可回答的问题

1. 这次是谁触发的。
2. 这次 source 是否真的执行。
3. 抓到了什么，解析成了什么。
4. 哪些 item 被 filter / dedupe / skip，以及原因。
5. 哪些 delivery attempt 成功 / 失败，以及原因。
6. 最终 run 状态与 counts 是什么。

### 3. 规则

- logs 负责事件轨迹。
- facts/query 负责状态真相。
- web/CLI/debug 都通过 query service 拿状态，不从日志反推状态。
- 若重构后任一问题只能靠读源码或拼日志回答，则视为观测退化。

## 迁移策略与实施阶段

### Phase 0 — Freeze contracts

- 冻结 web/playground response schema，并落成显式 contract tests，而不是只保文字描述
- 冻结 current facts/query contracts
- 冻结旧 definitions 输出的外部可观察行为基线，而不是把过渡 `load_definitions` 的内部 shape 升格为长期约束
- 补齐副作用矩阵测试
- 先完成 preview/playground capture sink cutover，禁止真实 delivery executor 进入 preview 路径

### Phase 1 — Introduce `DefinitionSet`

- 新建内部 definition model
- 新建 compiler
- 所有入口先能产出同一个 `DefinitionSet`
- 旧 `load_definitions` 仅作过渡桥
- 这一阶段结束前，`ExecuteRun` 的隐式 collect-only 退化路径必须被移除或被显式 gate 阻断，不得带着该语义进入后续阶段

### Phase 2 — Extract `composition/`

- 从 `src/interfaces/create_source_execution_core.ts` 抽出共享装配
- 从 `src/interfaces/daemon/create_daemon_runtime.ts` 抽出 daemon wiring
- 从 `src/interfaces/web/preview_runtime.ts` 抽出 preview wiring
- 从 `src/core/app.ts` 移除编排与装配职责

### Phase 3 — Consolidate the application kernel

- 显式化 `CompileDefinitions / PlanRun / CollectSource / ExecuteRun / PreviewRun / QueryRuns / RecoverAttempts / PruneFacts`
- 删除 `execute()` 的 collect-only 退化路径
- 让 `RunDueSourcesUseCase` 成为唯一 due-source 执行真相
- daemon 不得再直接持有 due-source 判定后自行调用 `runSourceUseCase.execute(...)`；一旦 application 入口收口完成，所有 due-source 执行必须经过 `RunDueSourcesUseCase`

### Phase 4 — Rebuild interfaces

- daemon 只保触发与生命周期
- CLI 只保命令解析
- web/playground 只保 request/response 与 error mapping
- 全部统一通过 application 内核

### Phase 5 — Redesign CLI / config

- 新 CLI 命令与 config 协议围绕 compiler 设计
- 外部协议只表达意图，不表达内部 wiring
- 删除 `ResolvedConfig -> runtime model` 直连路径

### Phase 6 — Cut over and delete

- 切新 facts schema
- 删除过渡 compiler/wiring/helpers
- 清空或极限收缩 `src/core/`
- 删除不再需要的 interfaces 过渡层

## 验证策略

每一阶段都必须配对应验证：

1. Definition compiler contract tests
2. daemon / preview / playground 一致性 tests
3. execute vs collect 显式模式 tests
4. payload contract tests
5. query service contract tests
6. migration / cutover smoke tests
7. 命中共享入口时运行全量 `deno task test`

## 风险

1. **调度双真相未清除**
   - 若 daemon 继续同时持有 due-source 判定与执行循环，application 真相会再次漂移。

2. **preview 副作用边界未冻结**
   - 若 preview 仍能走到真实 delivery executor，会出现误发风险。

3. **隐式降级残留**
   - 若 `ExecuteRun` 仍可能 collect-only，生产链路会继续出现假成功。

4. **compiler 边界不单一**
   - 若 definitions 继续在多个入口重复投影，config→runtime 分叉会再次出现。

5. **query 面被接口层旁路**
   - 若 web/CLI 各自手拼状态，运行真相会重新分裂。

6. **cutover 拖成长期中间态**
   - 若保留旧 schema/旧 helper/旧 wiring 共存，最终重构会再次失焦。

## 验收标准

以下全部满足，才算这份最终设计落地：

1. `DefinitionSet` 成为唯一内部装配输入。
2. `ExecuteRun` 不再允许隐式 collect-only。
3. `PreviewRun` 绝不触发真实外部副作用。
4. `RunDueSourcesUseCase` 成为唯一 due-source 执行真相。
5. daemon / CLI / web / playground 共享同一 application 内核。
6. query 面统一经 query service 暴露，不再各处拼状态。
7. `src/config/types.ts` 不再承载内部运行时真相。
8. `src/interfaces/create_source_execution_core.ts`、`src/interfaces/daemon/create_daemon_runtime.ts`、`src/interfaces/web/preview_runtime.ts` 的过渡装配逻辑被 composition root 取代。
9. 新 facts schema 与 cutover 策略明确落地。
10. 旧过渡层删除，无双写、无兼容壳、无半旧半新中间态。
