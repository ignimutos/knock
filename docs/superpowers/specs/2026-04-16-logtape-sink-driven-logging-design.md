# LogTape 接管 logging sink/formatter 的重构设计

日期：2026-04-16  
范围：`src/core/logger.ts`、`src/config/schema.ts`、`src/config/types.ts`、`src/config/resolve_config.ts`、`src/interfaces/daemon/create_daemon_runtime.ts`、`src/main.ts`、`web/main.ts`、playground/preview 运行时与相关测试/文档

## 1. 背景与目标

当前仓库的 logging 有 3 个根问题：

1. 配置模型仍是“全局 `logging.format` + 单 console sink”，无法表达“console 走 pretty、file 走 jsonl、未配置 sink 就不创建”。
2. 运行时主要靠 `src/core/logger.ts` 手写 sink 分发、级别过滤、stdout/warn/stderr 路由与 pretty 渲染，而这些本来属于 LogTape 的原生职责边界。
3. 当前 pretty 已经不是原始 timestamp，但展示仍然低密度：`resource` / `attributes` 整块展开，控制台可读性与扫描效率都不够。

本次设计目标是：

- 尽量把 **sink 创建、dispatch、formatter 挂接、file sink、rotation、redaction 主机制** 交给 LogTape。
- 把配置契约改成 **per-sink format**，且 **只有显式配置的 sink 才创建**。
- console 支持 `pretty | jsonl`；file 第一版支持 `jsonl`。
- `pretty` 继续只影响控制台展示层；文件输出保持结构化 JSONL。
- 保留仓库自己的 OTel 风格 JSON 契约、字段命名约束、trace 校验与高密度 pretty 样式策略。
- 本次按 **breaking change** 处理，不保留旧 `logging.format` 兼容层。

## 2. 已确认边界

### 2.1 不保留旧顶层 `logging.format`

新契约只认 `logging.sinks.<id>.format`。

- 删除顶层 `logging.format`
- 不做“自动映射到 `console.format`”的兼容逻辑
- 旧配置视为非法输入，直接在 schema 校验时报错

### 2.2 sink 只在显式配置时创建

运行时只创建用户显式声明的 sinks：

- 配了 `logging.sinks.console` 才创建 console sink
- 配了 `logging.sinks.file` 才创建 file sink
- 两者都没配时，不做任何输出

不再保留“默认总会有一个 console sink”的隐式行为。

### 2.3 继续保留仓库的 OTel 风格 JSON 契约

虽然底层 sink/formatter 机制尽量交给 LogTape，但仓库仍保留自己的最终输出契约：

- JSONL 输出继续使用当前仓库的 OTel 风格字段模型
- `pretty` 与 `jsonl` 必须来源于同一条**经过字段归一后的 LogTape record**
- 不把 file/jsonl 改成 LogTape 原始 `LogRecord` 直出

换句话说：**LogTape 负责输出基础设施；Knock 继续定义最终输出 shape。**

### 2.4 不混淆 delivery 文件滚动与 logging file sink rotation

`deliveries.<id>.file.rotation` 继续只表示业务 delivery 的文件输出滚动；本次新增的 `logging.sinks.file.rotation` 只表示日志文件 sink 的滚动。两者必须在命名、文档与测试里明确区分。

## 3. 方案比较

### 方案 A：继续保留当前自研 logger，只补多 sink fan-out

做法：

- 保留 `src/core/logger.ts` 现有 emit/format/dispatch 主体
- 仅在仓库内新增 console/file 多 sink 输出
- rotation 与 redaction 只做局部接入

优点：

- 改动面最小
- 现有测试迁移压力较低

缺点：

- 会继续维护一套与 LogTape 重叠的底层实现
- sink/rotation/redaction/formatter 的能力边界仍不清晰
- 很难彻底对齐“能用 LogTape 的全部用 LogTape”

### 方案 B：由 LogTape 接管 sink/formatter/rotation/redaction 主机制，Knock 只保留契约层（推荐）

做法：

- 运行时由 LogTape 创建 sinks、路由日志并做 formatter 分发
- file sink 与 rotation 使用 `@logtape/file`
- redaction 使用 `@logtape/redaction`
- 仓库层只保留：字段归一、OTel JSON 映射、trace 校验、高密度 pretty 样式

优点：

- 与 LogTape 原生心智一致
- 后续扩展 per-sink format / rotation 成本最低
- 更符合本次“底层尽量让 LogTape 接管”的目标

缺点：

- 相比方案 A 是更大的结构性重构
- 需要重做 `src/core/logger.ts` 的职责划分与测试基线

### 方案 C：全面切 LogTape，且直接使用默认 `getPrettyFormatter()`

做法：

- sink/formatter/rotation/redaction 都交给 LogTape
- console pretty 直接使用默认 `getPrettyFormatter()` 或少量调参

优点：

- 最接近上游默认用法
- 实现最少

缺点：

- 无法保证满足本仓库对高密度控制台展示的要求
- 用户当前不满的正是默认 pretty 风格的信息密度

### 结论

采用 **方案 B**。

即：**LogTape 接管底层输出机制；Knock 保留记录契约与展示策略。**

## 4. 配置契约设计

### 4.1 新的 `logging` shape

```yml
logging:
  level: info
  sinks:
    console:
      type: console
      format: pretty # pretty | jsonl

    file:
      type: file
      format: jsonl
      path: runtime/logs/app.jsonl
      rotation:
        type: size # size | time
        maxSize: 10m
        maxFiles: 5
```

时间滚动时：

```yml
logging:
  level: info
  sinks:
    file:
      type: file
      format: jsonl
      path: runtime/logs/app.jsonl
      rotation:
        type: time
        interval: daily # hourly | daily | weekly
        maxAge: 7d
```

### 4.2 字段规则

- `logging.level`：继续是顶层公共级别。
- `logging.sinks.console.type`：固定 `console`。
- `logging.sinks.console.format`：支持 `pretty | jsonl`。
- `logging.sinks.file.type`：固定 `file`。
- `logging.sinks.file.format`：第一版只支持 `jsonl`。
- `logging.sinks.file.path`：canonical 文件路径。
- `logging.sinks.file.rotation`：二选一联合类型，不允许同时给 size/time 两套配置。

### 4.3 rotation 语义

#### size rotation

```yml
rotation:
  type: size
  maxSize: 10m
  maxFiles: 5
```

- 对应 LogTape rotating file sink 的 size 模式。
- `maxSize` 控制单文件上限。
- `maxFiles` 控制保留数量。

#### time rotation

```yml
rotation:
  type: time
  interval: daily
  maxAge: 7d
```

- 对应 LogTape time rotating file sink。
- `interval` 支持 `hourly | daily | weekly`。
- `maxAge` 控制旧日志保留时间。

### 4.4 `path` 在 time rotation 下的解释

即使是 time rotation，也继续以 `path` 作为 canonical 输入，而不是另造 `directory` / `filename` 双 shape。

例如：

```yml
path: runtime/logs/app.jsonl
rotation:
  type: time
  interval: daily
```

运行时按以下规则派生：

- 目录：`runtime/logs`
- 前缀：`app`
- 扩展名：`.jsonl`
- daily 文件名：`app-YYYY-MM-DD.jsonl`
- hourly 文件名：`app-YYYY-MM-DD-HH.jsonl`
- weekly 文件名：`app-YYYY-WNN.jsonl`

这样可以保持单一事实源，同时仍贴近 LogTape 的 time rotating sink 模型。

## 5. 运行时架构设计

### 5.1 LogTape 接管输出基础设施

运行时新增统一 logging bootstrap，职责是：

1. 读取 resolved logging config
2. 基于显式配置创建 LogTape sinks
3. 为每个 sink 绑定对应 formatter
4. 把 redaction 包在 sink/formatter 上
5. 统一在 runtime 入口处完成 configure

入口收口范围：

- `src/interfaces/daemon/create_daemon_runtime.ts`
- `src/main.ts`
- `web/main.ts`
- playground / preview 相关运行时

目标是消除“某些入口硬编码 logger 行为、某些入口读配置”的不一致状态。

### 5.2 `src/core/logger.ts` 收缩为契约层

`src/core/logger.ts` 不再负责底层 sink dispatch，而是收缩为薄适配层：

- 保留 `Logger` 接口，尽量减少调用点改动
- 保留 `child(fields)` 语义
- 保留业务字段归一与 OTel JSON 映射
- 保留 trace 校验与必要的 code/context 注入
- 把 `warn` 映射到 LogTape `warning`

可以删除或迁出的职责：

- 手写 `LEVEL_WEIGHT` 过滤
- 手写 stdout/warn/stderr 路由
- 手写 formatter 分发
- 手写 file sink 选择
- 手写 rotation 逻辑

### 5.3 统一的底层记录流水线

单条日志的处理顺序设计为：

1. 调用点通过仓库 Logger API 发起日志
2. 适配层合并 `child/baseFields`
3. 适配层构造 LogTape record properties，并完成字段归一：
   - snake case
   - 业务键 remap
   - HTTP/exception 标准键映射
   - trace 字段校验
4. LogTape 将这条已归一的 record 分发到已配置 sinks
5. 各 sink formatter 基于同一条 record 输出最终形态：
   - console pretty → 高密度文本
   - console jsonl → 仓库 canonical OTel JSONL
   - file jsonl → 仓库 canonical OTel JSONL

### 5.4 为什么不直接输出 LogTape 原始 `LogRecord`

因为本仓库已有明确的长期契约：

- OTel 风格 JSON 字段结构
- `scope.name` / `resource.attributes` / `attributes` 的职责边界
- 业务 namespace 规则

因此本次不是“把最终日志 JSON 改成 LogTape 默认 shape”，而是“让 LogTape 承担 record 分发与 sink 基础设施，同时由仓库 formatter 输出既定 JSON 契约”。

## 6. pretty 展示策略设计

### 6.1 不直接使用默认 `getPrettyFormatter()` 作为最终输出

虽然 console `pretty` 仍然建立在 LogTape formatter 机制之上，但最终不直接采用默认 `getPrettyFormatter()` 输出，因为当前目标是高密度、单行优先的控制台体验，而默认 pretty 已被证明不满足这个目标。

因此本次设计为：

- 使用 LogTape 的 formatter 接口
- 由 Knock 实现一个 **high-density pretty formatter**
- formatter 输入为同一条 canonical 记录，输出为高密度文本

### 6.2 主行形态

默认主行：

```text
time level scope message k=v k=v
```

规则：

- `time`：按 `timezone + timestampFormat` 渲染
- `level`：短文本，不以装饰为主
- `scope`：默认只显示 `scope.name` 最后一段
- `message`：沿用 `body`
- 业务字段以内联 `k=v` 追加在尾部

### 6.3 资源字段策略

默认不再整块展开 `resource`，只保留一个高价值短字段：

- `component=daemon|web`

除非某条记录级别或上下文特殊，否则不展示整块 `resource.attributes`。

### 6.4 长 ID 截断

- `source.run_id`、`web.request_id` 等长 ID 超过阈值时，默认显示前 8 位加省略号。
- 只有在 `debug` 或高价值诊断路径下，才允许显示更完整值。

### 6.5 各级别字段显示策略

#### info

默认只展示高价值、低噪声字段，例如：

- `component`
- `source.id`
- `source.run_id`（截断）
- `pipeline.item_id`
- `delivery.id`
- `web.request_id`（截断）
- `http.response.status_code`
- `*.duration_ms`

默认隐藏：

- 整块 `resource`
- 整块 `attributes`
- 低价值计数
- `code.*`
- 调试型 template 细节

#### debug

仍以单行为优先，但允许展示更多真实诊断字段，例如：

- `code.*`
- `template.*`
- 额外计数
- parser/filter 等决策字段

#### warn / error / fatal

仍优先单行，但应优先展示：

- `*.reason`
- `exception.type`
- `exception.message`
- `http.response.status_code`
- retry / fallback / degraded 相关键

若字段数量过多，允许补第二行详情，但 **不再退回当前整块对象 dump**。

### 6.6 pretty 与 jsonl 的关系

- pretty 只影响 console 文本展示
- jsonl 是结构化采集面
- 两者必须表达同一条底层记录
- pretty 不得发明不存在的字段，也不得隐藏最关键语义

## 7. redaction 与敏感信息策略

### 7.1 优先使用 LogTape redaction 能力

本次 redaction 主机制迁到 LogTape：

- 结构化字段使用 field-based redaction
- 文本/URL/自由文本路径使用 pattern-based redaction

### 7.2 仓库层保留的职责

仓库层仍保留：

- 敏感字段名清单
- URL/token/chat id 等模式规则
- 业务上禁止落日志的高泄漏字段约束

### 7.3 一致性要求

必须验证：

- console pretty 已脱敏
- console jsonl 已脱敏
- file jsonl 已脱敏
- 不存在“jsonl 脱敏了但 pretty 反泄漏”或反向情况

## 8. 迁移步骤设计

### 8.1 配置层

- 修改 `src/config/schema.ts`：新增 per-sink schema，删除顶层 `logging.format`
- 修改 `src/config/types.ts`：resolved logging type 改为多 sink shape
- 修改 `src/config/resolve_config.ts`：输出新的 canonical resolved logging config
- 更新 `config.example.yml` 与 README

### 8.2 运行时层

- 新增统一 logging bootstrap
- daemon / web / preview / playground 入口统一走 bootstrap
- 删除入口上的旧 logger format 硬编码

### 8.3 logger 契约层

- 收缩 `src/core/logger.ts` 的职责
- 保留调用点接口稳定性
- 把底层 dispatch/formatter 路由迁给 LogTape

### 8.4 formatter 与 sink

- console pretty：自定义 high-density formatter
- console jsonl：canonical OTel JSONL formatter
- file jsonl：canonical OTel JSONL formatter + LogTape file sink
- file rotation：接 LogTape size/time rotating sink

## 9. 测试与验证设计

### 9.1 配置契约测试

至少新增/调整：

- 顶层 `logging.format` 应报错
- `logging.sinks.console.format=pretty|jsonl` 应通过
- `logging.sinks.file.format=jsonl` 应通过
- file rotation 的 `size|time` 联合校验应正确生效
- 未配置 sinks 时 resolved config 允许为空对象

### 9.2 运行时接线测试

至少新增/调整：

- 只配 console → 只输出 console
- 只配 file → 只写 file
- console pretty + file jsonl 可同时工作
- 不配 sink → 不输出
- web / daemon / preview / playground 都走同一 logging shape

### 9.3 pretty 展示测试

至少新增/调整：

- `info` 应为高密度单行
- `scope` 只显示最后一段
- `component=daemon|web` 应内联
- 长 ID 应截断
- 不再整块输出 `resource` / `attributes`
- `warn/error` 在高信息量时允许第二行，但不得回退为块状 dump

### 9.4 jsonl 契约测试

至少新增/调整：

- 每行都是可解析 JSON
- 结构仍满足仓库 OTel 风格契约
- pretty 与 jsonl 来源于同一条底层记录
- redaction 在 console/file 两边都成立

### 9.5 入口回归测试

重点命中：

- `src/interfaces/daemon/create_daemon_runtime.ts`
- `src/main.ts`
- `web/main.ts`
- preview/playground 相关运行时

命中共享高影响入口时，收尾需要按仓库规则补全量 `deno task test`。

## 10. 风险与控制

### 风险 1：breaking change 影响现有配置

控制方式：

- 在 schema 层直接报错，不做半兼容半迁移
- README 与 `config.example.yml` 同步更新
- 用 focused contract tests 锁住新 shape

### 风险 2：LogTape 接管后 JSON 契约漂移成原始 `LogRecord`

控制方式：

- jsonl 使用仓库自己的 canonical formatter
- 明确禁止直接把原始 `LogRecord` 当最终 JSON 契约

### 风险 3：pretty 与 jsonl 的脱敏行为不一致

控制方式：

- redaction 统一挂在 LogTape 路径上
- console/file 同时做成功/失败路径脱敏断言

### 风险 4：日志 file sink rotation 与 delivery file rotation 混淆

控制方式：

- 在 schema、README、测试名中明确写出 `logging.sinks.file.rotation`
- 不借用 delivery 的 rotation shape

### 风险 5：退出时 file sink 未 flush，丢尾日志

控制方式：

- 在 runtime stop/shutdown 路径补 sink close/flush 验证
- 增加 focused regression tests

## 11. 结论

本次 logging 重构采用以下最终方向：

- **底层输出机制尽量交给 LogTape**：sink、dispatch、formatter 挂接、file sink、rotation、redaction 主机制都使用 LogTape 原生能力。
- **仓库层只保留契约能力**：OTel 风格 JSON 映射、业务字段归一、trace 校验与高密度 pretty 样式。
- **配置改成 per-sink**：删除顶层 `logging.format`，仅保留 `logging.sinks.*`。
- **sink 只有显式配置才创建**。
- **console pretty 使用基于 LogTape formatter 机制的 Knock 自定义 high-density formatter**。
- **file 输出第一版统一为 jsonl，并支持 size/time 二选一 rotation**。

最终结果应满足：

- console 可高密度调试
- file 可稳定采集
- pretty 与 jsonl 同源
- 配置模型与 LogTape 心智一致
- 仓库原有 OTel/命名契约继续成立
