# Knock 全链路 OTel 日志重构 Design Spec

## 背景

Knock 当前已经拥有一套自研结构化 logger，核心实现在 `src/core/logger.ts`，并且已经输出 OTel 风格 JSON record、支持 `json` / `pretty` 两种控制台展示、具备 trace 字段合法性检查与基础脱敏能力。近期提交 `1e0a49e refactor(logging): align runtime logs with OTel contracts` 已把主链路拉回到较稳定的 OTel 结构。

但全项目日志面仍未完全收敛，主要问题是：

- 业务属性仍大量使用扁平键，如 `operation`、`outcome`、`reason`、`*_count`、`path`、`runtime_dir`
- AI 运行时仍使用顶层 `ai.*`，与规则中“固定 9 个业务根域”冲突
- `src/deliveries/http.ts` 失败日志仍记录 `response_body`，与“不得记录原始响应体/正文”冲突
- `filter` / `dedupe` 等预期内高频非成功结果仍多为 `debug`，而规则更倾向 `info`
- `src/sources/source_runtime.ts`、`src/deliveries/delivery_runtime.ts`、`src/db/source_state_store.ts` 等中间层可观测性不足
- web 日志、daemon 日志、config 日志虽已大体结构化，但字段归属和语义边界仍不一致

本次设计目标是：在**不引入 OTel SDK / OTLP sink / 查询后端**的前提下，把全仓库日志面收敛成一套与 `.claude/rules/logging-otel.md`、`.claude/rules/logging-console.md` 一致的单一契约，并同步测试、README、配置示例、rules 与相关 skill。

## 目标

1. 保持当前 OTel 风格 JSON record 核心形状稳定：
   - `timeUnixNano`
   - `observedTimeUnixNano`
   - `severityText`
   - `severityNumber`
   - `body`
   - `trace_id` / `span_id` / `trace_flags`
   - `resource.attributes`
   - `scope.name`
   - `attributes`
2. 把最终业务日志字段收敛到规则允许的既定业务域：
   - `app.*`
   - `config.*`
   - `db.*`
   - `scheduler.*`
   - `source.*`
   - `pipeline.*`
   - `template.*`
   - `delivery.*`
   - `web.*`
3. 统一非成功结果的 level policy、字段位置和错误表达方式。
4. 清理高泄漏风险字段，尤其是原始请求体/响应体、消息正文、模板渲染结果等。
5. 给当前缺少 direct logs 的关键中间层补足最小但有效的观测面。
6. 不制造双 shape，不保留旧字段兼容层，不回退到旧扁平契约。

## 非目标

本轮不做以下事项：

- 不接入 `@opentelemetry/*` SDK
- 不新增 OTLP / file / remote sink
- 不接 Axiom、Loki 或其他查询后端
- 不把 web 启动流程重构为读取 daemon runtime config
- 不为旧字段（如 `ai.*`、`response_body`、裸 `operation/outcome/reason`）保留兼容双写
- 不把日志重构扩展成无关的大型架构重写

## 已确认设计决策

### 1. trace 只表示真实 tracing 关联

日志顶层 trace 字段继续只使用：

- `trace_id`
- `span_id`
- `trace_flags`

没有真实 trace/span 上下文时直接省略，不使用占位值，也不允许把 `run_id`、业务主键、AI request-id 等临时关联字段借位写进 trace。

### 2. AI 字段不新增第 10 个业务根域

AI 相关属性采用 **`<owner>.ai.*`**，而不是新增顶层 `ai.*`。

规则如下：

- 当前 AI filter / content render 链路：`template.ai.*`
- 未来如果出现 AI source：`source.ai.*`
- 未来如果出现 delivery 侧 AI 能力：`delivery.ai.*`

这保证 AI 字段始终跟随所属子系统，既符合固定 9 个业务根域规则，也让“谁拥有这组字段”在查询和阅读上更清晰。

### 3. 业务字段所有权由调用点决定，不由 logger 猜测

`src/core/logger.ts` 继续只负责：

- 组装 OTel record
- 规范化标准 semconv 键
- 校验 trace 合法性
- 脱敏
- pretty/json 输出

`logger.ts` 不负责根据 `scope.name` 自动猜测 `operation/outcome/reason` 该落到哪个 namespace。字段所有权必须由日志调用点显式决定，以避免引入新的隐式双 shape 和隐藏规则。

### 4. 清理高泄漏字段，不保留兼容别名

`src/deliveries/http.ts` 的 `response_body` 将从日志契约中移除。本轮不保留任何兼容字段，也不把原始响应体转成另一个近义键继续记录。需要诊断时，优先保留：

- 标准状态码字段
- 安全的错误摘要
- 有限枚举的结果/原因分类
- 长度、布尔值、计数等低泄漏信号

### 5. pretty 仍只是展示层

`pretty` 继续基于同一条底层已脱敏 record 渲染，可以重排或拍平高频字段，但不能改变底层 JSON 契约，也不能发明占位字段。

## 现状与问题分层

### A. 共享 logger 层

关键文件：

- `src/core/logger.ts`
- `src/core/logger_test.ts`

现状：

- 已有稳定的 OTel-like 顶层结构
- 已对齐 severity band-start
- 已有 `method` / `route` / `http_status` / `error_*` / `stack` 的标准化 remap
- 已有 `trace_id` 合法性校验与脱敏逻辑

问题：

- `null` 当前会被归一化为空字符串，违背“缺失字段应省略”
- 业务字段没有 owner namespace，需要调用点统一收敛

### B. 主链路生产者层

关键文件：

- `src/core/source_processor.ts`
- `src/core/app.ts`
- `src/config/load_config.ts`
- `src/core/ai_runtime.ts`
- `src/core/liquid_runtime.ts`
- `src/deliveries/http.ts`
- `src/deliveries/email.ts`
- `src/deliveries/file.ts`
- `src/db/client.ts`
- `web/main.ts`

现状：

- 都已经通过 `createLogger()` 输出结构化日志
- 大部分路径已有相邻测试覆盖
- `source.id`、`source.run_id`、`pipeline.item_id`、`delivery.id`、`web.request_id` 等关联字段已经出现

问题：

- 仍普遍使用裸 `operation/outcome/reason`
- summary、count、duration、path 等字段归属不清
- AI 仍用顶层 `ai.*`
- HTTP delivery 仍记录原始响应体
- `filter` / `dedupe` / `skip` 的 level 策略和规则不完全一致

### C. 中间层观测缺口

关键文件：

- `src/sources/source_runtime.ts`
- `src/deliveries/delivery_runtime.ts`
- `src/db/source_state_store.ts`
- `src/core/content_runtime.ts`

现状：

- `content_runtime.ts` 已承担上下文透传职责
- source fetch/parse dispatch、delivery build/dispatch、db persist/dedupe/prune 等阶段日志不足

问题：

- 出问题时只能看到外围失败，难以快速判断故障位于 transport、parse、render、dedupe 还是 prune

## 方案比较

### 方案 A：调用点显式收敛 + 中间层最小补点（推荐）

做法：

- 保持 `logger.ts` 只负责 record/脱敏/标准 remap
- 在各模块调用点直接把字段改成 owner-scoped namespaced 键
- 在当前无 direct logs 的中间层补充最小事件日志
- 同步测试、规则、README 和 skill 示例

优点：

- 单一事实源清晰
- 行为可预测，测试改动可控
- 不引入新的隐藏推断逻辑
- 最符合仓库现有结构和 rules

缺点：

- 需要扫较多文件
- 前期测试改动量较大

### 方案 B：在 logger 层集中做 namespace 自动映射

做法：

- 保留现有调用点写法
- 在 `logger.ts` 根据 `scope.name` 或字段名自动把裸键映射成 namespaced 键

优点：

- 表面上改动调用点更少

缺点：

- 规则隐藏在 logger 内部，难以理解
- 很容易制造新的双 shape 或错误归属
- 后续新增 scope 时需要同步修改中心映射表
- 不符合“字段所有权由生产者决定”的原则

### 方案 C：只修高风险字段，不做全仓 sweep

做法：

- 只修 `ai.*`、`response_body`、`null -> ''`
- 暂时不统一大部分扁平业务键和中间层观测

优点：

- 工作量最小

缺点：

- 无法实现“全链路/全代码日志重构”的目标
- 仍会长期保留字段所有权不清的问题
- 容易让 rules / README / tests 再次漂移

### 结论

采用 **方案 A**。

它是唯一能在不引入新框架、不制造隐藏规则的前提下，把这轮目标收敛完整的路径。

## 目标架构

### 1. 核心 logger 边界

`src/core/logger.ts` 只做 4 件事：

1. 把日志调用组装成 OTel 风格 record
2. 规范化标准语义键和 trace 字段
3. 执行脱敏
4. 根据 `json` / `pretty` 做最终展示

它不决定业务字段归属，也不承诺保留旧字段别名。

### 2. 生产者显式拥有业务字段

每个日志生产者必须在调用点决定自己的字段归属：

- app 启动与守护进程：`app.*`
- config load/validate/resolve：`config.*`
- source fetch/parse/run：`source.*`
- pipeline filter / item-level decisions：`pipeline.*`
- template/liquid/AI：`template.*` 与 `template.ai.*`
- delivery push/rotation/build：`delivery.*`
- db init/persist/dedupe/prune：`db.*`
- scheduler register/run-skip：`scheduler.*`
- web request 处理：`web.*`

### 3. 关联字段保持横向稳定

以下关联字段继续跨模块稳定传播：

- `source.id`
- `source.run_id`
- `pipeline.item_id`
- `delivery.id`
- `web.request_id`

它们继续作为全链路查询和关联的主键，但不借位到 trace。

### 4. 缺失字段直接省略

无论顶层字段还是 `attributes` 内部字段，缺失值和无意义空值都应省略，不能再用空字符串、空对象、占位 ID 等冒充存在。

## 数据流设计

### daemon 主链

1. `src/core/app.ts` 创建根 logger
2. child logger 分发到 app/config/source/template/delivery/db/scheduler
3. `src/core/source_processor.ts` 为单次 source run 生成 `source.run_id`
4. `src/core/content_runtime.ts` 使用 `attachLogFields()` 把 `source.id` / `source.run_id` / `pipeline.item_id` 继续透传到模板和 delivery
5. delivery / db / AI / template 侧继续复用这些字段
6. 所有调用最终回到 `src/core/logger.ts` 组装 record 并输出

### web 链

1. `web/main.ts` 创建 web logger
2. request 生命周期生成 `web.request_id`
3. route handler 把 HTTP 标准字段和业务字段写入 `attributes`
4. 底层仍由同一 `createLogger()` 输出 JSON/pretty

## 字段归属准则

### 标准语义键继续优先

以下仍由现有 `logger.ts` remap 负责：

- `method` / `http_method` -> `http.request.method`
- `route` -> `http.route`
- `http_status` -> `http.response.status_code`
- `error_name` -> `exception.type`
- `error_message` -> `exception.message`
- `stack` -> `exception.stacktrace`

### 业务字段显式 namespaced

以下类别应从裸键迁到所属域：

- 生命周期与结果：例如 `app.outcome`、`scheduler.outcome`、`delivery.outcome`
- 原因分类：例如 `pipeline.reason`、`delivery.reason`
- 计数：例如 `source.item_count`、`pipeline.passed_count`、`delivery.pushed_count`
- 耗时：例如 `source.fetch_duration_ms`、`template.duration_ms`、`web.duration_ms`
- 路径与稳定运行上下文：例如 `config.path`、`db.path`
- AI：例如 `template.ai.provider`、`template.ai.model_ref`、`template.ai.error.status_code`

### resource.attributes

仍只放稳定资源级事实，例如：

- `service.name`
- `deployment.environment.name`
- `knock.component`

不把单次 source run、单次 request、单次 delivery 的事实挪进 `resource.attributes`。

## level 设计

### `info`

用于：

- 生命周期里程碑
- 成功事件
- 预期内且高频的非成功结果

重点包括：

- filter hit / filtered
- dedupe-hit
- skip（当其属于预期分支而非异常频率）
- empty-result

### `warn`

用于：

- 流程还能继续，但已经明显次优
- 需要运维注意
- 语义损失、重试、降级、部分失败

### `error`

用于：

- 当前操作失败
- 正确性已经受影响
- 最终 delivery 失败、source fetch/parse/run 失败、config load 失败等

### `fatal`

继续只用于真正的进程级或核心运行面致命场景，本轮不扩张其含义。

## 错误处理设计

### 统一原则

- `body` 写简短且稳定的结论
- 标准错误键优先使用 `exception.*`
- 必要时再补 owner-scoped 的安全错误摘要字段
- 不记录未经脱敏的原始响应体、请求体、正文、模板输出、entry 全量内容

### AI 失败

`src/core/ai_runtime.ts` 保持现有安全策略：

- `exception.message` 使用固定安全文案
- owner-scoped 补充状态码、retryable、safe message
- 不泄露 provider 原始 body

### HTTP delivery 失败

失败日志只保留：

- `http.response.status_code`
- `exception.*`
- 必要的 `delivery.*` 结果/原因字段

不再保留 `response_body`。

### file / email / db 失败

- file：补齐失败日志，不只记录成功
- email：保留标准错误字段，避免完全丢失原始失败上下文
- db：persist/dedupe/prune/vacuum 失败路径明确打点

## 需要修改的文件范围

### 核心

- `src/core/logger.ts`
- `src/core/logger_test.ts`

### 高流量生产者

- `src/core/source_processor.ts`
- `src/core/app.ts`
- `src/config/load_config.ts`
- `src/core/ai_runtime.ts`
- `src/core/liquid_runtime.ts`
- `src/deliveries/http.ts`
- `src/deliveries/email.ts`
- `src/deliveries/file.ts`
- `src/db/client.ts`
- `web/main.ts`

### 中间层补点

- `src/sources/source_runtime.ts`
- `src/deliveries/delivery_runtime.ts`
- `src/db/source_state_store.ts`
- 必要时 `src/core/content_runtime.ts`

### 文档 / 规则 / 示例

- `.claude/rules/logging-otel.md`
- `.claude/rules/logging-console.md`
- `.claude/skills/otel-logging-design/SKILL.md`
- `README.md`
- `config.example.yml`

## 测试策略

### 1. 先改契约测试，再改实现

优先更新这些断言，让它们先表达目标契约：

- `src/core/logger_test.ts`
- `src/core/source_processor_test.ts`
- `src/core/ai_runtime_test.ts`
- `src/deliveries/http_test.ts`
- `web/main_test.ts`
- 与受影响行为直接相关的 delivery/db/config tests

### 2. 分层 scoped 验证

按改动面分组跑：

- core/logger/source/template/AI
- delivery/db/config/web
- source runtime 中间层（如补点）

### 3. 最终全量测试

由于会修改共享运行时边界，最终必须执行一次全量：

- `deno task test`

### 4. 静态校验

对触达路径执行：

- `deno task check <paths...>`
- `deno task lint:check <paths...>`
- `deno task fmt:check <paths...>`

### 5. 运行时 smoke

若本地有可用 `runtime/config.yml`：

- 采样 daemon 一条成功路径和一条非成功路径
- 采样 web `/api/xquery/evaluate` 路径
- 确认 JSON 可解析、字段归位正确、pretty 只改展示、不泄露敏感值

## 风险与缓解

### 风险 1：一次性 sweep 改动面大

缓解：

- 先让测试表达新契约
- 按“logger 核心 -> 高流量生产者 -> 中间层补点 -> 文档”顺序推进
- 每阶段跑 scoped tests，最后再跑全量

### 风险 2：字段归属过度抽象

缓解：

- 不在 logger 层引入自动 owner 推断
- 只在调用点显式改名
- 沿用现有 `attachLogFields()` / `getLogFields()` 做上下文透传

### 风险 3：泄漏边界回退

缓解：

- 保持 `sanitizeFields()` / `redactText()` 作为统一防线
- 在高风险路径增加测试：AI、HTTP delivery、pretty 输出
- 移除 `response_body` 契约和断言

### 风险 4：web 与 daemon 行为割裂

缓解：

- 本轮先统一 emitted fields 与规则，不扩大到 web bootstrap 配置重写
- 让 web 与 daemon 共享同一 logger contract，但允许启动方式暂时不同

## 迁移完成判定

当以下条件同时满足时，本轮设计视为落地完成：

1. 全仓库日志最终只保留一套 OTel-aligned shape
2. 顶层不再出现旧扁平业务字段回流
3. AI 字段已收敛为 `<owner>.ai.*`
4. 原始 `response_body` 等高泄漏字段已清理
5. source / delivery / db / web 至少各有成功与非成功路径测试覆盖
6. README、rules、spec、plan、skill 示例保持一致

## 推荐实施顺序

1. 先更新规则与测试，使目标契约可执行
2. 收紧 `src/core/logger.ts` 的缺失值与全局不变量
3. sweep 高流量生产者：source/app/config/AI/template/delivery/db/web
4. 补 source/delivery/db 中间层观测缺口
5. 最后同步 README、config.example.yml、rules 与 skill

## 结论

这轮重构应被视为一次**契约收敛工程**，而不是简单的 logger 修补。核心原则是：

- 顶层结构继续 OTel 化
- 业务字段必须 owner-scoped
- trace 只保留真实 trace
- pretty 只做展示
- 缺失字段直接省略
- 敏感原文不进日志
- 不保留旧 shape 兼容层

在这些边界之内，Knock 可以得到一套覆盖 daemon、web、source、pipeline、template、delivery、db、config 的统一日志契约，并为后续真正接入 tracing 或查询后端保留干净的演进空间。
