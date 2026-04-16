# Runtime / Pipeline Refactor Design

## 摘要

本设计聚焦 Knock 当前主链路的结构性收敛，而不是一次性重写全仓。目标是先把 `RunSourceUseCase` 从“同时承担 collect + apply 的重编排中心”收成稳定边界，再把 item 级 pipeline、delivery payload 契约、runtime 装配骨架与 config 语义表达按顺序收紧。整个设计坚持两个原则：

1. 先稳 application 主链，再收 delivery 契约，再做 runtime 去重，最后收 config 表达。
2. 只收高价值边界，不引入万能 builder、兼容层、双写或新的历史包袱。

本设计接受分批实施，但每个批次都必须满足清晰的验证边界与停手条件。Spec 关注“做成什么样才算对”，不直接替代执行计划。

## 背景与问题

当前仓库已经完成抓取、解析、过滤、渲染、投递、状态存储、preview/web playground、AI 与日志等能力，但主架构仍存在几类持续摩擦：

1. **`RunSourceUseCase` 同时承担 collect + apply**
   - `plan`、`fetch`、`parse`、run/item 持久化、filter、双层 dedupe、render、dispatch、finalize、日志计数目前挤在同一主链中。
   - 真实风险主要落在编排顺序与副作用收口，而不是单个 stage 的局部逻辑。

2. **Pipeline 真实风险与测试重心错位**
   - 当前有若干 stage 级测试，但风险更多在 `filter -> dedupe -> render -> dispatch` 的串联缝隙。
   - 如果继续只增强 stage unit 覆盖，主链语义仍可能漂移而不被及时发现。

3. **Delivery payload 契约未完全收硬**
   - `RenderStage` 已基本产出 channel-specific 结构化 snapshot，但 executor 端仍残留旧兼容推断，尤其 email executor 的 legacy fallback。
   - 如果在 contract 未冻结前继续做 runtime 去重，旧 payload shape 会被继续传播。

4. **preview / daemon / playground 存在重复装配**
   - source config 解析、gateway 选择、source parser 装配、preview fallback 执行壳层存在重复。
   - 这些重复是真问题，但它们依赖上层 use case 边界与下层 payload 契约稳定后才能安全收敛。

5. **config 语义链存在重复概念与绕路表达**
   - `load_config -> validate_config -> resolve_config -> load_definitions` 四层边界本身有价值，但部分 delivery 语义和 definitions 投影存在重复表达。
   - 问题在于“概念绕路”，而不是“层数太多”。

## 目标

1. 明确 `RunSourceUseCase.plan()` / `collect()` / `execute()` 的边界。
2. 让 item 级 pipeline 成为稳定边界，围绕主链语义建立测试，而不是继续把复杂度散落在多个浅 stage 调用缝隙里。
3. 让 `RenderStage` 成为 canonical payload producer，executor 只消费明确结构。
4. 统一 runtime 共用 helper 与 source execution 骨架，但不统一 daemon / preview / playground 的运行语义。
5. 收敛 config 语义表达与 definitions 投影的绕路逻辑，不破坏现有 canonical delivery + source override 契约。
6. 为后续按 Batch 开新会话实施提供稳定目标边界。

## 非目标

1. 本轮不一次性重写整个类型系统。
2. 本轮不引入万能 runtime builder 或新的总装配中心。
3. 本轮不合并 `load` / `validate` / `resolve` / `definitions` 四层。
4. 本轮不为旧路径增加兼容层、双写、别名或迁移保留逻辑。
5. 本轮不引入并发 item/delivery 执行。
6. 本轮不把 preview / daemon / playground 的生命周期语义打平。

## 现有硬约束

### 1. Config 契约

以下约束必须保持稳定：

- `deliveries.<id>` 是 canonical delivery 定义。
- `sources.<id>.deliveries` 是 keyed override map。
- source 侧 override 只允许在既定 delivery 子树内生效。
- `${ENV_VAR}` 展开语义必须保留。

### 2. Pipeline 顺序语义

以下顺序必须保持：

- `filter -> item dedupe -> delivery dedupe -> render -> dispatch -> finalize`

本轮允许重构实现，但不允许改变主链语义。

### 3. 运行模式约束

- preview / playground 轻路径允许存在，但必须是显式设计结果，而不是 accidental fallback。
- production / daemon wiring 不允许依赖“缺少关键依赖时 quietly 只跑 collect”。

### 4. Definitions / 装配结果约束

- `load_definitions` 输出的 `sources` / `deliveries` / `bindings` shape 必须稳定。
- 同一份 config 输入下，daemon 与 preview 看到的 `SourceDefinition` / `DeliveryBinding` 结果必须一致。

## 目标架构边界

## 1. Application boundary

`RunSourceUseCase` 的目标边界为：

- `plan(input)`：生成稳定 `RunPlan`
- `collect(input)`：执行 `plan + fetch + parse`
- `execute(input)`：执行 `collect + optional apply`

其中：

- `collect()` 不触发 run/item/attempt 持久化，不处理 delivery 副作用。
- `execute()` 在 full wiring 下进入 apply，在显式轻路径下只返回 collected result。

本轮不要求一开始就把所有 caller 都改为显式 mode，但最终 production wiring 必须显式 full-execute。

## 2. Pipeline boundary

item 级 pipeline 的目标边界是一个稳定编排单元，而不是一组松散 stage 的偶然组合。其职责包括：

- filter 命中与短路
- item-level dedupe
- delivery-level dedupe
- rendered snapshot 生成
- delivery attempt 计划/执行/完成态推进
- item status 收口
- run counts / logs 收口

允许保留现有 stage 文件，但主测试与主心智必须转向 pipeline 边界。

## 3. Delivery payload contract

`RenderStage` 作为 canonical producer，必须产出按 channel 区分的稳定结构：

- **file**: `path`, `content`, `rotation?`
- **push**: `http`, `requestType`, `payload`, `response?`
- **email**: `smtp`, `message`

executor 不应再猜测 payload shape；如果缺少 channel 所需字段，必须显式失败。

## 4. Runtime assembly boundary

runtime 收敛的目标不是“统一所有入口”，而是统一真正共用的骨架：

- `resolveSourceConfig(...)`
- `selectSourceInputGateway(...)`
- source execution core（ai/content runtime、http client、summary query、gateways、parser）
- playground preview 执行壳层

以下语义必须保留各自 owner，不进入统一骨架：

- daemon lifecycle / scheduler / recovery
- preview 的 in-memory / 轻路径语义
- playground request schema / error classify / mapping 规则

## 5. Config semantic boundary

`load_config`、`validate_config`、`resolve_config`、`load_definitions` 四层边界继续保留。

本轮只收敛：

- definitions 对 resolved config 的投影方式
- delivery 语义 helper 的重复表达
- path / 外部术语映射中真正高价值的共性

不把四层打平，也不把 config 重新设计成新 DSL。

## 必要 Gate

### Gate A：冻结 `load_definitions` 输出契约

在 runtime 去重前，必须锁住：

- `sources`
- `deliveries`
- `bindings`
- push requestType 默认值

这保证 Batch 4 不会在 definitions 输出层悄悄漂移。

### Gate B：冻结 daemon / preview 装配一致性

在 runtime 去重前，必须锁住：

- 同一 config 输入下，daemon 与 preview 生成一致的 `SourceDefinition`
- 同一 config 输入下，daemon 与 preview 生成一致的 `DeliveryBinding`
- 至少覆盖 fetch/summary 与 file/push/email

### Gate C：production wiring fail-fast

在 runtime 去重阶段，production / daemon wiring 必须显式 full-execute：

- 缺少关键 pipeline 依赖时启动即失败
- 不允许 production 继续使用静默 collect-only 退化路径

## 验证模型

1. 每个批次先跑最窄相关测试。
2. 命中共享入口或装配骨架时，再补更广范围验证。
3. 先建立新的边界测试，再考虑收缩旧浅测试。
4. `config.example`、`README` 只有在外部行为确实变化时才同步更新；文档不得记录未实现行为。

## 风险

1. **过早删 stage tests**
   - deduplication/render/delivery 仍承载高信息密度的局部契约，不应在边界测试完全到位前删除。

2. **runtime helper 去重导致 daemon / preview 漂移**
   - 这是 Batch 4 的主要风险，因此必须先上两道 gate。

3. **payload 契约收硬后暴露旁路 legacy shape**
   - 这是预期风险，应该通过 executor contract tests 与主链路 contract tests 接住。

4. **config 语义收敛反冲 runtime 装配**
   - 因此 `load_definitions` 的输出边界必须先冻结。

5. **production wiring 继续静默降级**
   - 这是最危险的假阳性来源，必须通过 fail-fast 收口。

## 验收标准

满足以下条件才算本轮设计目标落地：

1. `RunSourceUseCase` 已形成 `plan` / `collect` / `execute` 的稳定边界。
2. item 级 pipeline 已有稳定主链边界测试。
3. email legacy payload fallback 已移除，delivery payload canonical shape 已锁定。
4. preview / daemon 的共用 helper 与 source execution core 已去重，但运行语义仍分离。
5. `load_definitions` 输出契约与 daemon / preview 装配一致性 gates 全部通过。
6. production wiring 已显式 fail-fast，不再静默 collect-only。
7. config semantic simplification 完成，且 canonical delivery + source override + `${ENV_VAR}` 契约均未漂移。
