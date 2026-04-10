# logging-otel

这些规则只覆盖高确定性、长期有效的 OTel 结构化日志约束。

## 严格 OTel JSON 模型

- 单条日志记录 MUST 保持 OTel Log Record 语义对应的 JSON 结构。
- 顶层字段 MUST 只承载日志记录自身字段与标准结构容器；业务上下文、资源上下文、trace 关联信息 MUST NOT 任意扁平铺开到顶层。
- `body` 用于人类可读的事件描述；需要被筛选、聚合、统计的机器字段 MUST 放在结构化字段中，而不是只写进 `body`。
- `resource.attributes` 表示资源级上下文：对同一运行实体的大量日志都稳定成立、且不应随单次事件变化的事实。
- `attributes` 表示事件级上下文：仅对当前这条日志成立，或会随请求、任务、重试、来源、投递等事件变化的事实。
- trace 字段只表示这条日志与当前 trace/span 的因果关联；没有真实关联时 MUST NOT 伪造、缓存复用或写入占位值。
- `scope` 只表示产生日志的 instrumentation scope；`scope.name` MUST 表示日志生产者身份，而不是业务实例、请求实例、运行结果或自由文本。

## 顶层字段、resource、attributes、trace 的放置原则

### 顶层字段

- 顶层 SHOULD 只保留 OTel Log Record 自身字段，例如时间戳、严重级别、正文、事件名、trace 关联字段以及 `resource` / `scope` / `attributes` 等结构容器。
- 资源级或业务级事实 MUST NOT 伪装成新的顶层自定义字段。

### `resource.attributes`

以下信息 SHOULD 优先进入 `resource.attributes`：

- 服务、部署环境、服务版本、实例标识等资源身份信息
- 进程、运行时、主机、容器等运行实体信息
- 对同一进程生命周期内大多数日志都稳定不变的上下文

以下信息 MUST NOT 放进 `resource.attributes`：

- 单次请求、单次 source 执行、单次 delivery、单次调度触发的信息
- 会随重试、过滤、降级、结果变化而变化的信息
- 仅对少量单条日志成立的诊断字段

### `attributes`

以下信息 SHOULD 放进 `attributes`：

- 事件结果、原因、计数、耗时、批次、重试、过滤、降级等事件级字段
- source、pipeline、template、delivery、web 请求、数据库操作等与当前事件直接相关的信息
- 需要做筛选、聚合、告警、统计的机器字段

### trace 字段

以下信息 SHOULD 只放进 trace 字段：

- 当前日志真实关联的 trace id / span id / trace flags

以下信息 MUST NOT 放进 trace 字段：

- 业务主键、source id、delivery id、任务 id
- 只因“想串起来看”而临时伪造的关联值

## 标准键优先

- 有稳定标准键时 MUST 优先使用标准键。
- OTel semantic conventions 已覆盖的概念 MUST NOT 另造近义词。
- 只有在标准键无法准确表达语义时，才 MAY 引入自定义业务字段。
- 自定义字段 MUST 保持稳定、可枚举、可查询；MUST NOT 用同一概念并存多套命名。

## 业务字段 namespace

- 业务字段放在 `attributes` 时 MUST 采用按域分层命名。
- 第一版固定 9 个业务域：
  - `app.*`
  - `config.*`
  - `db.*`
  - `scheduler.*`
  - `source.*`
  - `pipeline.*`
  - `template.*`
  - `delivery.*`
  - `web.*`
- 新增业务字段时 MUST 先落到最贴近职责归属的域下，再继续细分层级。
- 业务字段 SHOULD 优先使用稳定名词层级；只有动作语义不可避免时才使用动作段。
- 没有明确批准前，MUST NOT 新增第 10 个业务域根前缀。

## `scope.name` 三段式命名原则

- `scope.name` MUST 恰好为三段，使用小写英文与点分隔。
- 三段分别表示：
  1. 日志表面或入口
  2. 子系统或能力域
  3. 稳定的日志生产单元
- `scope.name` MUST 可长期复用，且同一生产者在不同结果、不同实例、不同环境下保持稳定。
- `scope.name` MUST NOT 包含：
  - source id / delivery id / request id / trace id / 用户输入
  - 环境名、地区名、租户名等实例化值
  - `success` / `failure` / `retry` / `skip` 等结果态
  - 自增序号、时间戳、临时 tag

正例：

- `app.bootstrap.runtime`
- `source.fetch.runtime`
- `pipeline.filter.engine`
- `delivery.telegram.client`
- `web.request.handler`

反例：

- `fetch`
- `source.fetch`
- `source.rust.fetch`
- `delivery.telegram.retry`
- `web.request.handler.prod`

## 非成功结果的字段要求

当日志表示失败、跳过、过滤、重试、降级或其他非成功结果时：

- `body` MUST 明确写出发生了什么，以及直接原因或触发条件。
- `attributes` MUST 提供稳定、可机器查询的结果字段，放在对应业务域下。
- 若存在可枚举的原因分类，SHOULD 记录稳定原因字段，而不是只给自由文本。
- 重试相关日志 SHOULD 记录当前次数、最大次数（若已知）以及下一步动作或等待信息。
- 跳过/过滤相关日志 SHOULD 记录发生在哪个阶段、由哪条规则或哪个条件触发。
- 降级相关日志 SHOULD 记录降级了什么能力、采用了哪条回退路径。
- 若存在错误对象，SHOULD 优先使用标准错误键表达错误类别；错误文本只有在已脱敏且确有运维价值时才记录。

## 脱敏与禁止记录内容

- token、password、secret、authorization、cookie、chat id、webhook secret、带凭据 URL、签名查询参数等敏感值 MUST 脱敏或省略。
- MUST NOT 记录可直接复用的原始凭据。
- MUST NOT 记录未经脱敏的请求体、响应体、模板渲染结果、消息正文、entry 全量内容或其他高泄漏风险原文。
- 需要诊断时，SHOULD 优先记录长度、计数、布尔状态、有限枚举、摘要值或已证明安全的截断预览。
- 脱敏 MUST 在任何展示层格式化之前完成。

## 观测验证要求

新增或重构结构化日志时，至少完成以下验证：

- 采样检查至少一个成功路径和一个非成功路径。
- 确认 JSON 可解析，且字段被放在正确的 OTel 结构位置。
- 确认标准键优先原则被满足，没有无必要的近义词自定义键。
- 确认 `scope.name` 满足三段式且不含实例化值。
- 确认自定义业务字段落在既定 namespace，且命名稳定可查询。
- 确认敏感信息已被脱敏，且展示层不会绕过脱敏后的 record。
- 确认仅通过结构化字段就能回答：是谁产生日志、属于哪个资源、发生了什么、结果如何、为何如此、是否关联 trace。
