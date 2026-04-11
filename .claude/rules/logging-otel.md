# logging-otel

这些规则只覆盖高确定性、长期有效的 OTel 结构化日志约束。

## 严格 OTel JSON 模型

- 单条日志记录 MUST 保持 OTel Log Record 语义对应的 JSON 结构。
- 顶层字段 MUST 只承载日志记录自身字段与标准结构容器；业务上下文、资源上下文、trace 关联信息 MUST NOT 任意扁平铺开到顶层。
- 缺失的可选字段 SHOULD 直接省略；MUST NOT 用空字符串、占位 ID、伪造对象、空语义枚举或“unknown”之类占位值冒充真实字段。此条是规则目标，即使当前运行时尚未完全对齐，也应按此收敛。
- `body` 用于人类可读的事件描述；需要被筛选、聚合、统计的机器字段 MUST 放在结构化字段中，而不是只写进 `body`。
- `resource.attributes` 表示资源级上下文：对同一运行实体的大量日志都稳定成立、且不应随单次事件变化的事实。
- `attributes` 表示事件级上下文：仅对当前这条日志成立，或会随请求、任务、重试、来源、投递等事件变化的事实。
- trace 字段只表示这条日志与当前 trace/span 的真实因果关联；没有真实关联时 MUST NOT 伪造、缓存复用或写入占位值。
- 当前仓库非 OTLP JSON 输出在顶层 trace 字段命名上 MUST 使用 `trace_id` / `span_id` / `trace_flags`；MUST NOT 混用 `traceId` / `spanId` / `traceFlags` 作为并行 shape。
- `scope` 只表示产生日志的 instrumentation scope；`scope.name` MUST 表示日志生产者身份，而不是业务实例、请求实例、运行结果或自由文本。

## 严重级别模型

- OTel `severityNumber` band MUST 按以下范围理解：
  - `TRACE`: 1-4
  - `DEBUG`: 5-8
  - `INFO`: 9-12
  - `WARN`: 13-16
  - `ERROR`: 17-20
  - `FATAL`: 21-24
- `severityNumber` 是严重级别的 canonical 排序、过滤与比较信号；`severityText` 是文本标签。两者在同一条记录上 SHOULD 表达同一严重级别。
- 当前仓库原生日志器使用 band-start 值：`TRACE=1`、`DEBUG=5`、`INFO=9`、`WARN=13`、`ERROR=17`。
- 若未来需要引入 `FATAL`，SHOULD 对齐到 `21` 作为 band-start，而不是挪用 `ERROR` 表达进程级致命场景。
- 级别选择 MUST 先看“当前事件对运行正确性与运维注意力的要求”，而不是“这条文案看起来重不重”。

## 本仓库 level 策略

| level   | 使用原则                                                       | Knock 例子                                                                         |
| ------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `trace` | 极细粒度、高频、逐步骤的诊断信息；默认应极少使用。             | 单次抓取流程里逐步展开的临时诊断、逐条 entry 的细碎判定轨迹。                      |
| `debug` | 默认诊断级别；对排障有帮助，但不是日常运行必须持续关注的事件。 | 请求参数摘要、模板选择细节、某一步内部决策分支。                                   |
| `info`  | 生命周期里程碑、正常成功事件，以及“预期内且高频”的非成功结果。 | source 抓取完成、delivery 成功、filter hit、dedupe-hit、skip、empty-result。       |
| `warn`  | 流程还能继续，但已明显次优且需要关注。                         | 正在重试、走降级路径、部分 delivery 失败、异常频率的 skip/filter/empty。           |
| `error` | 当前操作失败，或正确性已受影响。                               | source 抓取失败、delivery 最终失败、数据库写入失败、配置错误导致当前流程无法完成。 |
| `fatal` | 进程或核心运行面无法继续，只能立即退出或即将崩溃。             | 仅用于真正的进程级致命场景，不用于普通单次操作失败。                               |

- `info` 不等于“只有成功才可用”；像 `filter hit`、`dedupe-hit`、`skip`、`empty-result` 这类预期内、常见、且对正确性无害的非成功结果，SHOULD 默认使用 `info`。
- `warn` 不等于“看上去不成功就升级”；只有当状态明显次优、需要运维注意或异常频率已值得关注时，才 SHOULD 升到 `warn`。
- `error` MUST 表示当前操作确实失败，或结果已不足以维持正确性；MUST NOT 把仍可接受、可预期的流程分支泛化成 `error`。

## 顶层字段与结构容器的放置原则

### 顶层字段

- 顶层 SHOULD 只保留 OTel Log Record 自身字段，例如时间戳、严重级别、正文、trace 关联字段，以及 `resource` / `scope` / `attributes` 等结构容器。
- 若所用日志模型、API 或 semantic conventions 提供事件名承载位，它也只 SHOULD 承载稳定事件类别名，而不是业务上下文。
- 资源级或业务级事实 MUST NOT 伪装成新的顶层自定义字段。

### 字段归属边界

| 要表达的内容                                 | 优先归属              | 边界说明                                                                                                                                                       |
| -------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 这条日志给人的最短结论                       | `body`                | 写“发生了什么”，不是把所有机器字段拼回一句话。                                                                                                                 |
| 可选的稳定事件类别名                         | `event_name` 概念     | 它是可选事件命名概念，确切承载形式取决于所用模型、API 与 semantic conventions；除非运行时契约已明确，MUST NOT 把它表述成“当前仓库已经稳定输出的固定顶层字段”。 |
| 当前事件的结果、原因、计数、耗时、业务上下文 | `attributes`          | 只对当前这条日志成立，且需要筛选、聚合、统计。                                                                                                                 |
| 同一运行实体的大量日志都稳定成立的事实       | `resource.attributes` | 资源身份、部署、进程、运行时等长期稳定上下文。                                                                                                                 |
| 哪一个稳定日志生产者产出了记录               | `scope.name`          | 给生产者命名，不给结果、实例或请求命名。                                                                                                                       |
| 与当前 trace/span 的真实因果关联             | trace 字段            | 只放真实 trace/span ID 与 flags，不借位记录业务关联。                                                                                                          |

- `body` MUST 保持人类可读；若某字段需要做过滤、聚合、统计，MUST 给出对应的结构化字段，而不是只埋在 `body`。
- `event_name` 若被采用，SHOULD 短小、稳定、可枚举，用于表达事件类别名，而不是替代 `body`。
- `event_name` MUST NOT 承载自由文本、实例 ID、结果态、上下文细节、trace 信息或临时拼接串。

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

本轮仓库级约定：

- source 关联主键 SHOULD 使用 `source.id` 与 `source.run_id`
- 单条消息/entry 关联主键 SHOULD 使用 `pipeline.item_id`
- 单个投递目标 SHOULD 使用 `delivery.id`
- web 请求关联主键 SHOULD 使用 `web.request_id`
- 这些业务关联字段 MUST NOT 借位写进 trace 字段

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
- AI 相关字段 MUST 继续跟随所属业务域，而不是单独新增顶层 `ai.*`；例如模板链路用 `template.ai.*`，source 链路用 `source.ai.*`，delivery 链路用 `delivery.ai.*`。
- 业务字段 SHOULD 优先使用稳定名词层级；只有动作语义不可避免时才使用动作段。
- 没有明确批准前，MUST NOT 新增第 10 个业务域根前缀。

## `scope.name` 稳定点分命名

- `scope.name` MUST 使用稳定的小写英文点分命名。
- 新增 `scope.name` SHOULD 优先采用 3 段，以表达“日志表面或入口 / 子系统或能力域 / 稳定生产单元”。
- 既有稳定的 2 段、3 段或 4 段命名 MAY 保留；MUST NOT 仅为了凑段数而做无业务价值的重命名。
- 无论是 2 段、3 段还是 4 段，`scope.name` 都 MUST 可长期复用，且同一生产者在不同结果、不同实例、不同环境下保持稳定。
- `scope.name` MUST NOT 包含：
  - source id / delivery id / request id / trace id / 用户输入
  - 环境名、地区名、租户名等实例化值
  - `success` / `failure` / `retry` / `skip` 等结果态
  - 自增序号、时间戳、临时 tag

正例：

- `source.fetch`
- `app.bootstrap.runtime`
- `pipeline.filter.engine`
- `app.console.pretty.renderer`
- `web.request.handler`

反例：

- `fetch`
- `source.rust.42.fetch`
- `delivery.telegram.retry`
- `web.request.handler.prod`
- `source.fetch.success`

## 非成功结果的字段与级别要求

当日志表示失败、跳过、过滤、重试、降级或其他非成功结果时：

- `body` MUST 明确写出发生了什么，以及直接原因或触发条件。
- `attributes` MUST 提供稳定、可机器查询的结果字段，放在对应业务域下。
- 若存在可枚举的原因分类，SHOULD 记录稳定原因字段，而不是只给自由文本。
- 像 `filter hit`、`dedupe-hit`、`skip`、`empty-result` 这类预期内且高频的非成功结果，SHOULD 通常使用 `info`。
- 重试、降级、部分失败、异常频率的跳过或过滤等“流程还能继续但明显次优”的结果，SHOULD 通常使用 `warn`。
- 当前操作失败，或正确性已经受影响的结果，MUST 使用 `error`。
- 只有当进程或核心运行面无法继续时，才 SHOULD 使用 `fatal`。
- 重试相关日志 SHOULD 记录当前次数、最大次数（若已知）以及下一步动作或等待信息。
- 跳过/过滤相关日志 SHOULD 记录发生在哪个阶段、由哪条规则或哪个条件触发。
- 降级相关日志 SHOULD 记录降级了什么能力、采用了哪条回退路径。
- 若存在错误对象，SHOULD 优先使用标准错误键表达错误类别；错误文本只有在已脱敏且确有运维价值时才记录。

## 脱敏与禁止记录内容

- token、password、secret、authorization、cookie、chat id、webhook secret、带凭据 URL、签名查询参数等敏感值 MUST 脱敏或省略。
- MUST NOT 记录可直接复用的原始凭据。
- MUST NOT 记录未经脱敏的请求体、响应体、模板渲染结果、消息正文、entry 全量内容或其他高泄漏风险原文。
- 若配置存在类似 `push.response.message` 的错误消息模板，它 MAY 决定对外抛出的错误文本，但这些模板渲染结果 MUST NOT 被原样复制进结构化日志。
- 需要诊断时，SHOULD 优先记录长度、计数、布尔状态、有限枚举、摘要值或已证明安全的截断预览。
- 脱敏 MUST 在任何展示层格式化之前完成。

## 观测验证要求

新增或重构结构化日志时，至少完成以下验证：

- 采样检查至少一个成功路径和一个非成功路径。
- 确认 JSON 可解析，且字段被放在正确的 OTel 结构位置。
- 确认 `severityNumber` / `severityText` 一致，且级别选择符合本仓库 level 策略。
- 确认标准键优先原则被满足，没有无必要的近义词自定义键。
- 确认 `scope.name` 满足稳定点分命名；新增命名优先 3 段，既有稳定 2/3/4 段不被误判为违规。
- 若采用事件名概念，确认它是稳定事件类别名，而不是自由文本或上下文拼接。
- 确认缺失可选字段被省略，而不是用占位值伪装成存在。
- 确认自定义业务字段落在既定 namespace，且命名稳定可查询。
- 确认敏感信息已被脱敏，且展示层不会绕过脱敏后的 record。
- 确认仅通过结构化字段就能回答：是谁产生日志、属于哪个资源、发生了什么、结果如何、为何如此、是否关联 trace。
