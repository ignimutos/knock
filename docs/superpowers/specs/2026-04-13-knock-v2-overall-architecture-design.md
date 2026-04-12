# Knock v2 总体架构设计

## 摘要

本设计将 Knock 从“围绕配置与运行时 helper 串联的守护进程”重构为“围绕一次 `SourceRun` 事务组织的领域驱动执行内核”。v2 的第一性对象固定为 `SourceRun`、`PipelineItem`、`DeliveryAttempt`：一次 source 执行是总事务，条目是处理单元，投递尝试是副作用单元。`config` 降级为声明式装配输入，`application` 成为流程编排真相，`domain` 成为语义与状态边界真相，`infrastructure` 只负责适配外部世界，`interfaces` 只负责 CLI / daemon / web / config file 的输入输出翻译。

本轮设计接受大范围重构和不兼容改动，优先级为：先重建核心领域模型，再重画模块边界，最后为后续演进铺设稳定骨架。因此首份 spec 聚焦 **全仓 v2 总体架构**，不是局部修补，也不是先从现有 `startApp` 或单个 runtime 文件做机械拆分。目标是先定义最终方向，再据此拆解后续实施计划与迁移切片。

## 背景与问题

当前仓库虽然已经具备抓取、解析、过滤、渲染、投递、状态存储、web playground、AI 处理与日志等完整能力，但主架构仍然以“配置 shape + 一串 runtime/service/helper”组织，而不是以稳定领域对象组织。用户已明确接受整体优化、允许大范围重构与 breaking change，只要求最终方向正确，因此本设计不再以“最小兼容增量”为约束。

当前主要问题可归纳为三类，并且用户确认三类都成立：

1. **缺少稳定领域骨架**
   - 现有代码更像围绕 source / delivery / config / runtime helper 自然生长。
   - 系统到底在处理什么实体、每层到底在表达什么事实，没有被稳定建模。
   - 同一业务状态往往在 source runtime、processor、delivery runtime、数据库、日志中各保留一部分。

2. **组合根失控**
   - `src/core/app.ts` 既装配依赖，又承担 daemon 主流程的业务编排与阶段决策。
   - 入口层、编排层、基础设施层互相渗透，模块边界虚化。
   - `startApp` 一类重函数天然倾向继续吞并更多逻辑，导致测试只能穿透大入口验证行为。

3. **配置驱动过深**
   - `schema`、resolved types、runtime semantics 与实际执行逻辑耦合较深。
   - 很多运行期分支更像是配置 shape 的投影，而不是领域模型的显式规则。
   - 一旦继续在配置层堆能力，领域模型会进一步被配置 DSL 反向绑架。

同时，web playground 与 daemon 主链路虽然已经开始复用部分运行时能力，但整体仍更像两套接口面共享局部工具，而不是共用同一个应用内核。

## 目标

1. 以 `SourceRun` 作为 Knock v2 的第一性事务，重建稳定领域骨架。
2. 明确 `SourceRun`、`PipelineItem`、`DeliveryAttempt` 三类核心对象的职责、状态边界与关系。
3. 将系统拆分为清晰的 `domain` / `application` / `infrastructure` / `interfaces` 四层。
4. 让 `config` 降级为声明式输入与装配模型，而不是系统核心模型。
5. 让 daemon、CLI、web playground 共用同一套 application/domain 内核。
6. 让 source、delivery、db、logging、AI、scheduler 等能力都通过 port / adapter 接入。
7. 让状态存储、日志、测试都围绕统一领域事实展开，而不是各自维护半套真相。
8. 为后续实施计划提供稳定目标图，允许后续按切片逐步落地，而非继续围绕现有 `core/*runtime.ts` 零敲碎打。

## 非目标

1. 本设计不试图保留现有 CLI、config shape、模块 API 的兼容性。
2. 本设计不直接给出每个子模块的最终文件级 diff；那属于后续实施计划。
3. 本设计不要求一次实现完成全部迁移；它先定义目标结构与迁移原则。
4. 本设计不把某个单独 feature（如 summary source、delivery override、web playground）当成架构中心。
5. 本设计不继续沿用“旧内核 + 兼容层 + 双 shape 长期并存”的策略。

## 已确认决策

### 1. 目标优化顺序

用户已确认本轮整体优化顺序为：

1. **先 B：强领域模型**
2. **再 A：强模块边界**
3. **后 C：强可演进性**

含义是：先定义系统到底在处理什么，再定义模块分别由谁负责，最后才处理未来扩展骨架。避免在领域模型未稳定前先做大量工程层拆分，从而造成二次返工。

### 2. 总病根判断

用户确认当前系统的总病根并非单一症状，而是下列三类问题同时存在：

- 缺少稳定领域骨架
- 组合根失控
- 配置驱动过深

因此本设计不会以单点文件拆分或单点配置清理为主，而是以“重建内核权力结构”为主。

### 3. 主事务选择：`SourceRun`

用户接受以 **`SourceRun` 为主轴**。原因：

- 它最接近当前 daemon 调度的真实执行单元。
- 它能够自然包裹 `PipelineItem` 与 `DeliveryAttempt`。
- 它是最适合统筹 scheduler、run lifecycle、状态汇总、可观测性与后续 web/daemon 统一的中心对象。

因此 v2 不以 item 或 delivery 为最高事务对象，而是以“某个 source 在某次触发点的一次完整执行”为最高层事实。

### 4. 外部契约允许 breaking

用户明确选择：

- 只保产品能力
- CLI 用法、config shape、模块 API 都可以重做

因此本设计不以兼容现有调用方式为约束，也不为旧结构预留长期兼容壳。

### 5. 首份产物类型

用户要求首份产物为 **目标架构 spec**，先把最终结构讲透，再拆后续计划与实施。

因此本设计覆盖全仓 v2 总体架构，而不是局部蓝图，也不是直接开始写 v2 内核实现。

### 6. 首份 spec 范围

用户确认首份 spec 聚焦 **全仓 v2 总体架构**。原因：

- 当前可接受大范围 break，先定全图更重要。
- 若没有总图，后续各子计划容易再次按局部问题各拆各的。
- “方向对”优先于“先做一块落地快的局部修补”。

## 目标架构总图

### 1. 核心领域对象

Knock v2 的核心领域对象固定为：

#### `SourceRun`

表示某个 source 在某个触发点的一次完整执行上下文。

最小语义：

- `runId`
- `sourceId`
- `trigger`：`immediate` / `scheduled` / `preview` / `manual`
- `scheduledAt`
- `startedAt`
- `finishedAt`
- `status`：`success` / `partial` / `failed` / `skipped`
- 聚合计数：fetched / parsed / filtered / deduped / delivered / failed

`SourceRun` 不是日志壳、也不是单张数据库表的投影，而是整次执行的领域事实与聚合根。

#### `PipelineItem`

表示某次 run 内部被系统处理的一条标准化业务单元。

最小语义：

- `itemId`
- `sourceRunId`
- 标准化内容快照
- filter 判定结果
- dedupe 判定结果
- render 输入与抽象输出
- item 最终状态

`PipelineItem` 既不是 parser 原始 entry，也不是 delivery payload，而是 run 内部真正被处理的业务单位。

#### `DeliveryAttempt`

表示某个 item 面向某个 delivery 的一次尝试。

最小语义：

- `attemptId`
- `itemId`
- `deliveryId`
- `channel`
- `attemptNumber`
- `status`
- `reason`
- `startedAt`
- `finishedAt`

`DeliveryAttempt` 负责承载 per-delivery 的副作用语义。这样“部分成功”将由 attempt 聚合推导，而不是散落在日志与流程分支里。

### 2. 对象关系

- 一个 `SourceRun` 产出 `0..n` 个 `PipelineItem`
- 一个 `PipelineItem` 触发 `0..n` 个 `DeliveryAttempt`
- filter / dedupe / render / deliver / persist 都应围绕这三类对象发生

这样 source、delivery、db、log、web 都围着同一套事实转，而不是各自维护局部真相。

### 3. 四层分层

#### A. `domain`

负责稳定业务概念、值对象、规则、状态转移、结果语义。

例：

- `SourceRun`
- `PipelineItem`
- `DeliveryAttempt`
- `RunPlan`
- `DeliveryPlan`
- `classifyOutcome`
- `shouldFilter`
- `shouldDeduplicate`
- `shouldDeliver`

#### B. `application`

负责 use case 编排、调用 ports、推进领域生命周期。

例：

- `RunSourceUseCase`
- `PreviewSourceUseCase`
- `RunDueSourcesUseCase`
- `PruneStateUseCase`
- run / item / delivery coordinators

#### C. `infrastructure`

负责适配外部世界。

例：

- fetch / parser adapters
- file / http / email delivery adapters
- sqlite repositories
- scheduler adapter
- logger adapter
- AI provider adapter

#### D. `interfaces`

负责输入输出翻译，不持有业务真相。

例：

- CLI
- daemon bootstrap
- web handlers
- config file loading

### 4. 模块边界重画

v2 不再让 `src/core/` 继续充当“剩余物收纳箱”。推荐的目标方向：

- `src/domain/`
- `src/application/`
- `src/infrastructure/`
- `src/interfaces/`
- `src/shared/`（仅保留真正跨层稳定的纯工具）

其中：

- `config` 不再主导运行时结构，只负责声明与装配输入
- `sources` / `deliveries` 不再是架构中心，而应下沉为 infrastructure adapters
- web playground 不再拥有另一套业务真相，而应调用相同 application/domain 核心

### 5. 组合根原则

`src/main.ts` 与 daemon/web 入口最终只做：

- 组装依赖
- 创建 container / wiring
- 调用 use case
- 返回结果或错误

入口层不再承担业务阶段推进与流程真相。现有 `startApp` 这类超重函数应被拆成：

- bootstrapping
- dependency wiring
- use case invocation

## `SourceRun` 生命周期模型

### 1. 生命周期阶段

`SourceRun` 的领域生命周期固定为：

1. **Plan**
   - 解析 source 定义
   - 生成 run plan
   - 此阶段不做外部 IO

2. **Fetch**
   - 拉取原始内容
   - 记录 fetch outcome 与摘要元信息

3. **Parse**
   - 将原始内容转为统一 feed + candidate entries
   - 生成候选 `PipelineItem`

4. **Filter**
   - 对每个 item 做规则判定
   - 结果为 `pass` / `filtered`

5. **Deduplicate**
   - 对每个 item 做去重判定
   - 结果为 `new` / `duplicate`

6. **Render**
   - 为每个目标 delivery 生成抽象的 rendered intent
   - 该阶段产出“准备发送什么”，但尚未触发副作用

7. **Deliver**
   - 执行各个 `DeliveryAttempt`
   - 记录 per-attempt outcome

8. **Persist**
   - 保存 run / item / attempt 状态与必要快照

9. **Finalize**
   - 汇总 run 结果
   - 产出最终统计与可观察事件

这些阶段是领域语义顺序，不应再次退化为一串混杂 helper 的隐式调用顺序。

### 2. 结果语义

#### `partial`

`partial` 不是底层神秘状态，而是聚合态：

- run 中存在成功 attempt
- 同时也存在失败 attempt 或 item failure

#### `skipped`

跳过原因必须可枚举，例如：

- `source_disabled`
- `no_schedule_trigger`
- `filter_hit`
- `dedupe_hit`
- `no_deliveries`
- `empty_result`

#### `failed`

失败应按层级区分：

- run failure
- item failure
- attempt failure

这样不同模块才能共用稳定语义，而不是各自定义“失败”。

### 3. 架构约束

该生命周期会直接约束后续设计：

- config 只能生成 run plan，不能越权定义流程结构
- parser 只能产出 candidate items，不能偷带投递语义
- delivery adapter 只能执行 attempt，不能偷带领域判定
- 持久化围绕 run/item/attempt 事实组织，而非零散状态碎片
- 日志也应围绕这些事实表达事件

## Application 层与 Use Cases

### 1. 主 use cases

#### `RunSourceUseCase`

真实 source 执行主链路。

输入：

- `sourceId`
- `trigger`
- `scheduledAt`
- 运行上下文

输出：

- `SourceRunResult`

负责编排 plan/fetch/parse/item pipeline/delivery/persist/finalize 全链路。

#### `PreviewSourceUseCase`

供 web playground / 调试场景使用。

原则：

- 尽量复用 fetch / parse / render 主逻辑
- 不做正式 dedupe/persist，或只做显式受控的 preview persistence
- 输出面向 UI 的 preview result

#### `RunDueSourcesUseCase`

供 daemon/scheduler 使用。

职责：

- 查找当前应执行的 sources
- 为每个 source 调用 `RunSourceUseCase`

它只负责调度维度，不持有 source 处理细节。

#### `PruneStateUseCase`

负责 retention、状态清理、历史裁剪等后处理。

这样 retention 不再混在主运行链中。

### 2. 协调器策略

可以保留 orchestrator 思路，但必须收缩为 **薄协调器**，避免再次出现万能 `sourceProcessor` / `app.ts`：

- `SourceRunCoordinator`
- `ItemPipelineCoordinator`
- `DeliveryCoordinator`

每个 coordinator 只编排一个稳定阶段，不同时知道业务推进与底层技术细节。

### 3. Ports 设计原则

Ports 必须按 application 需要的能力定义，而不是按现有文件树定义。推荐至少包括：

#### Source side

- `SourceDefinitionRepository`
- `SourceFetcher`
- `SourceParser`

#### Pipeline side

- `FilterEvaluator`
- `DeduplicationRepository`
- `ContentRenderer`

#### Delivery side

- `DeliveryDefinitionRepository`
- `DeliveryExecutor`

#### State side

- `RunRepository`
- `ItemRepository`
- `DeliveryAttemptRepository`

#### Platform side

- `LoggerPort`
- `ClockPort`
- `IdGenerator`
- `SchedulerPort`

关键原则：

- port 名称表达能力，而非技术实现
- `sqlite`、`http`、`email`、`xquery`、`Drizzle`、`fetch` 等只出现在 infrastructure
- application 不应知道底层用什么库与协议

## Config、Runtime Semantics、Interfaces 的新位置

### 1. Config 的权力降级

v2 的硬原则：

**config 不是系统核心模型，config 只是声明式装配输入。**

因此不再让运行时真相直接从 config shape 倒推出去，而是：

- 先定义 domain/application
- 再定义 config 如何投影到它们

### 2. Config 三层模型

#### A. Raw Config

负责：

- YAML/JSON 解析
- `${ENV_VAR}` 展开
- schema 校验
- 错误定位

只回答“文件写得对不对”，不回答“系统如何运行”。

#### B. Resolved Config

负责：

- 引用解开
- 默认值补齐
- source / delivery 关联整理
- 静态装配视图形成

仍不是领域对象。

#### C. Runtime Assembly

负责将 resolved config 转为 application 可消费的定义对象，例如：

- `SourceDefinition`
- `DeliveryDefinition`
- `RunPolicy`
- `LoggingPolicy`

这里开始贴近运行时，但依旧只是定义，不是执行事实。

### 3. Runtime Semantics 分流

#### 留在 config/assembly 的语义

- duration string 解析
- timezone / timestamp format 默认值
- source / delivery 引用解析
- preview mode 的声明约束

#### 进入 domain/application 的语义

- 什么算 skipped / partial / failed
- dedupe 的业务含义
- render / deliver 的阶段边界
- run trigger 语义
- preview 与正式执行的行为差异

原则：

- “怎么读配置”属于 config
- “系统怎么判断与执行”属于 domain/application

### 4. Interfaces 降位

v2 的 interface 层只保留四类入口：

- CLI interface
- daemon interface
- web interface
- config file interface

它们都不持有业务真相，只负责将输入翻译为 use case request，再把结果翻译为输出。

### 5. 兼容策略

由于用户明确允许 breaking，本设计不建议长期保留旧 config shape 兼容层。更好的策略是：

- spec 直接定义 v2 config 原则
- 后续实施时若需要，可提供一次性迁移脚本或短期转换器
- 但 runtime 不长期背负双 shape

否则 config 仍会继续绑架新内核。

## 状态存储、日志、测试的重排

### 1. 存储模型

v2 的持久化不再是“给当前实现擦屁股的状态仓库”，而应围绕领域事实组织：

- `SourceRun`
- `PipelineItem`
- `DeliveryAttempt`
- `Deduplication`

推荐 repository 边界：

- `RunRepository`
- `ItemRepository`
- `DeliveryAttemptRepository`
- `DeduplicationRepository`

其中 dedupe repository 只负责去重判定所需的稳定接口，不与其他状态管理杂糅。

这样 summary、历史回看、未来 web 查询面、保留策略都能建立在统一事实之上。

### 2. 日志模型

日志不再承担“拼出系统真实状态”的职责；系统真实状态应先在 run/item/attempt 上成立，日志只是可观察投影。

因此日志事件应围绕：

- `SourceRun`
- `PipelineItem`
- `DeliveryAttempt`
- 生命周期阶段
- 结果语义

这与仓库现有 OTel 规则兼容，并且能更稳定地满足：

- 真实 trace only
- 统一 outcome 语义
- daemon / web / db / delivery / source 口径统一

### 3. 测试金字塔

v2 推荐四层验证：

#### A. Domain tests

验证纯规则：

- 生命周期状态汇总
- skip / partial / failure 分类
- item / attempt 判定
- policy 规则

#### B. Application tests

验证 use case 编排：

- `RunSourceUseCase`
- `PreviewSourceUseCase`
- `RunDueSourcesUseCase`

使用 fake ports，不依赖真实外部 IO。

#### C. Infrastructure adapter tests

验证适配器契约：

- parser adapter
- sqlite repositories
- http/file/email executors
- config loader / resolver

#### D. End-to-end slice tests

只保留少量关键真实链路：

- daemon 主执行链
- preview/web 核心链
- config -> bootstrap -> use case 链
- 关键 source/delivery 组合链

目标是“少而硬”，而不是继续把大量细规则堆进大集成测试。

### 4. 架构可测性约束

若某个规则必须：

- 从 CLI/HTTP 入口打进来
- 穿透很多层
- 才能验证一个小语义

那说明该规则放错层了。

这条约束用于持续防止系统再次长回“只有大入口能证明行为”的结构。

## 对现有代码的映射方向

本节不定义最终 diff，只给迁移方向。

### 1. `src/core/app.ts`

现有 `src/core/app.ts` 同时承担：

- config 装载后的依赖组装
- logger / db / runtime / scheduler / delivery wiring
- 主执行链阶段推进

在 v2 中它应被拆成：

- interfaces/bootstrap wiring
- application use case 调用
- infrastructure adapter 构造

不再作为业务编排中心。

### 2. `fetchAndParseSource`

现有 `src/sources/source_runtime.ts` 中 `fetchAndParseSource` 同时承担：

- source fetch
- parser 选择
- 部分 summary 分支选择
- 运行日志

v2 应拆成：

- `SourceFetcher` adapter
- `SourceParser` adapter
- application 层的 run-stage orchestration

summary 与普通 source 的差异也应由 definition/use case 层显式表达，而不是继续藏在 runtime helper 分支里。

### 3. `createDeliveryRuntime`

现有 delivery runtime 应下沉为 delivery executors/adapters 集合，application 只看 `DeliveryExecutor` port。

### 4. `createSourceProcessor`

现有 source processor 的职责应分裂为：

- `RunSourceUseCase`
- `ItemPipelineCoordinator`
- `DeliveryCoordinator`

避免继续保留一个同时知道 item pipeline、delivery、state、日志的中心对象。

### 5. web playground

现有 web playground 未来应只通过 preview/query use cases 访问核心逻辑，而不是持有独立 runtime 真相。其差异只应存在于：

- request/response DTO
- preview mode policy
- UI 特有组合层

## 迁移原则

### 1. 目标优先，不保留旧骨架

本轮是架构方向重建，不是旧结构外围补层。实施时应优先形成 v2 骨架，而不是在现有 `core/*runtime.ts` 外再包更多 façade。

### 2. 分阶段落地，但单阶段内部保持原子

虽然首份 spec 是总体架构，但实施计划应拆成有限阶段，每一阶段都对目标结构形成真实推进，而不是长期停在半抽象中间层。

### 3. 兼容只做迁移辅助，不做长期负担

可接受：

- 一次性迁移脚本
- 短期转换器
- 受控桥接层

不可接受：

- 双 config shape 长期并存
- 旧内核与新内核双真相长期共存
- 为保持旧模块 API 而扭曲 v2 边界

### 4. 优先把真相上移

若实现阶段出现取舍，应优先保证：

1. 真正的流程真相上移到 domain/application
2. interface 与 infrastructure 降位
3. config 权力收缩
4. storage / logs / tests 围绕统一事实重排

## 风险与取舍

### 1. spec 大、后续实施复杂

这是全仓总体架构设计，天然比局部设计更大。风险不是 spec 太大，而是后续计划若切片不清，会演变为无边界大爆改。因此需要后续 implementation plan 明确阶段与收口点。

### 2. 一次性 break 会带来短期迁移成本

用户已接受 breaking change，因此短期迁移成本可接受。但需要在计划中明确：哪些 break 一次切、哪些通过短期迁移脚本辅助。

### 3. 旧测试资产会有较大重写

测试体系将从“跟着实现结构走”转向“按 domain/application/infrastructure 分层”。这会带来短期重写成本，但属于架构重排的必要代价。

## 成功标准

本设计完成后，v2 目标架构应满足：

1. 可以用 `SourceRun` 讲清一次执行的完整生命周期。
2. 可以用 `PipelineItem` 讲清条目处理语义，而不依赖 parser 或 delivery 细节。
3. 可以用 `DeliveryAttempt` 讲清投递语义与部分成功汇总方式。
4. 可以明确区分 domain / application / infrastructure / interfaces 的责任边界。
5. 可以说明 config 只是 declaration/assembly，不再是系统核心模型。
6. 可以说明 daemon、CLI、web 如何共享同一套 use cases。
7. 可以说明存储、日志、测试如何围绕统一领域事实组织。
8. 可以据此继续拆出分阶段实施计划，而不会再次回到局部修补思路。

## 后续计划入口

本 spec 是总图，不直接等于施工顺序。后续 implementation plan 需要至少回答：

1. 先搭哪一层骨架，才能最快形成 v2 真相中心。
2. 现有 `startApp` / `sourceProcessor` / `source_runtime` / delivery runtime 如何分阶段迁移。
3. preview/web 与 daemon 何时汇流到同一 use case 集。
4. config 三层模型如何从现有 schema/resolved/runtime semantics 迁移过去。
5. storage / tests / logs 的迁移顺序如何避免中途双真相失控。

该 implementation plan 应以本 spec 为唯一目标结构依据，而不是重新回到旧文件树上做局部整理。
