# 日志接线与 pretty 展示收口设计

日期：2026-04-15  
范围：`src/main.ts`、`web/main.ts`、`src/core/logger.ts`、`src/interfaces/daemon/create_daemon_runtime.ts`、`src/interfaces/web/preview_runtime.ts`、`src/web/xquery_playground.ts`、`src/web/syndication_playground.ts`、相关测试

## 1. 背景与目标

当前仓库的结构化 logger 与 `@logtape/pretty` 底座已经存在，但运行入口与展示层还没有完全收口，主要问题有 4 类：

1. web 启动没有统一 startup log；当前只有 Fresh 自带 banner 打印地址，host / port / url 没进入仓库自己的结构化日志。
2. web API logger 没有接入统一 logging 选项；`web/main.ts` 当前硬编码 logger，`logging.format=pretty`、时区、时间格式与颜色设置不会在 web 侧生效。
3. playground / preview 运行时使用手工拼装的临时 config，对 logging shape 的表达与正式 runtime 不一致。
4. pretty 展示层虽然已经接入 `@logtape/pretty`，但还没有仓库级的字段裁剪策略，导致“时间统一、只显示调试有意义字段、按级别展示差异化上下文”没有完整落地。

本次设计目标是：

- 在 **不改 CLI 契约** 的前提下，把 web、daemon、playground/preview 的日志接线收口到一致行为。
- 为 web 增加统一 startup log，让 host / port / url 进入仓库自己的结构化日志面。
- 让 pretty 真正成为可用的本地调试展示层：时间统一、颜色生效、字段按级别裁剪。
- 保持底层 JSON record 契约不变，只调整接线与 pretty 展示层。

## 2. 已确认边界

### 2.1 不改 CLI 契约

本次 **不** 放开 web 模式的 `--config` / `--runtime_dir` / `--immediate`。

继续保持当前边界：

- `web` 模式只支持 `--web_host`、`--web_port`
- `daemon` 模式支持 `--config`、`--runtime_dir`、`--immediate`
- web 启动不读取用户的 `runtime/config.yml`

这意味着“统一 logging 行为”不等于“让 web 也读取 daemon 的外部 config”。本次只统一日志行为，不统一 CLI 输入面。

### 2.2 不重写 logger 核心契约

`src/core/logger.ts` 继续是底层日志 record 组装器：

- JSON 输出仍保持当前 OTel 风格字段模型
- pretty 仍基于同一条已脱敏 record 渲染
- 不引入第二套日志 shape
- 不为了收口入口行为而改掉全局默认语义

### 2.3 不把镜像拆分纳入本次范围

web / daemon 分开打包不是这次日志收口的一部分。

另外，按当前代码结构，单纯拆镜像不会显著降低体积，因为 web playground 仍会复用 preview 执行链并带入大部分 source/parser/runtime 依赖。若未来要做镜像瘦身，需要另开任务做依赖拆分。

## 3. 现状问题分层

### 3.1 入口接线不一致

- `src/interfaces/daemon/create_daemon_runtime.ts` 已经会把 `config.logging.format`、`config.logging.level`、`timezone`、`timestampFormat` 传给 logger。
- `web/main.ts` 当前直接硬编码 `createLogger({ enabled: true, level: 'info', module: 'web.api', component: 'web' })`，没有 format / timezone / timestampFormat。
- `src/main.ts` 的 web 启动路径只调用 `app.listen()`，没有发出仓库自己的 startup log。

结果是：daemon 能读到配置化日志选项，web 不能；daemon 有结构化 runtime logger，web 启动只有框架 banner。

### 3.2 playground / preview 的临时 config 表达不一致

`src/web/xquery_playground.ts` 与 `src/web/syndication_playground.ts` 会构造临时 `AppConfigResolved`，但 logging 相关内容目前只是最低限度拼装，容易和正式 resolved config 的 logging shape 漂移。

这不会直接影响 CLI 契约，但会让同一仓库内部出现两套“看起来都像 resolved config，实际约束却不完全一致”的表达。

### 3.3 pretty 展示未完成仓库级策略

`@logtape/pretty` 已接入，颜色开关也已存在，但目前 pretty 只是“能格式化”，还没有明确实现以下策略：

- `info` 以最小字段集为主
- `debug/trace` 暴露更多诊断属性
- `warn/error/fatal` 优先展示结果、原因与 trace 关联字段
- 时间统一按仓库时区与时间格式展示

所以现在的 pretty 更像底座，而不是仓库内已经定义清楚的人类可读控制台视图。

## 4. 方案比较

### 方案 A：改 CLI，让 web 也读取外部 config

做法：

- 放开 `web` 模式的 `--config` / `--runtime_dir`
- 让 web 与 daemon 共用外部配置加载路径

优点：

- 输入面上最统一
- web 可以直接继承 daemon 的 logging 配置

缺点：

- 改变 CLI 契约
- 扩大本次任务范围
- 与当前已确认边界冲突

### 方案 B：保持 CLI 分离，只统一日志接线与展示层（推荐）

做法：

- daemon 继续从 resolved config 读取 logging 选项
- web 继续只吃 host / port，但内部 logger 通过共享接线函数获得稳定默认 logging 行为
- playground / preview 的临时 config shape 与正式 runtime 契约对齐
- pretty 展示层补齐仓库级裁剪策略

优点：

- 不改 CLI
- 风险集中在日志行为本身
- 能精确修复当前缺口

缺点：

- web 与 daemon 的输入来源仍不同
- 需要补若干测试来锁定一致行为

### 方案 C：直接改 `createLogger()` 默认值，隐式修掉所有入口

做法：

- 通过更改 `createLogger()` 默认行为，让 web / daemon / playground 自动“看起来一致”

优点：

- 表面改动少

缺点：

- `createLogger()` blast radius 高
- 容易误伤现有 daemon / test 输出
- 隐式规则太多，不利于维护

### 结论

采用 **方案 B**。

## 5. 目标设计

### 5.1 新增共享的 runtime logger 接线层

新增一个很薄的共享接线层，用于把“运行面需要的 logger 选项”稳定传给 `createLogger()`。它只负责选项拼装，不负责生成第二套日志模型。

这层需要覆盖的输入维度：

- `enabled`
- `level`
- `format`
- `timezone`
- `timestampFormat`
- `module`
- `component`
- `baseFields`

调用关系设计：

- daemon：继续从 `AppConfigResolved` 取 logging/time 配置，再通过共享接线层生成 logger options
- web：不读外部 config，使用仓库内定义的默认 web logging 选项，再通过共享接线层生成 logger options
- playground / preview：继续使用内部临时 config，但 logging shape 与正式 resolved config 保持一致

这层的目标是统一“如何把选项喂给 logger”，不是统一“选项来自哪里”。

### 5.2 web 启动补统一 startup log

在 `src/main.ts` 的 web 启动路径补一条仓库自己的 startup log，至少包含：

- `body`：明确说明 web 已开始监听
- `scope.name`：稳定 startup scope
- `attributes.web.host`
- `attributes.web.port`
- `attributes.web.url`
- `attributes.web.operation=startup`
- `attributes.web.outcome=listening`

Fresh banner 保留；它是框架输出。

仓库自己的 startup log 作为统一观测面，用于：

- JSON 模式被采集
- pretty 模式以仓库格式显示
- 后续排查 web 监听地址时无需依赖 Fresh 自带 banner 文案

### 5.3 web API logger 改为走统一接线

`web/main.ts` 当前模块级的 web logger 改为经由共享接线层创建，目标行为：

- 默认仍保持 web 的独立启动语义
- pretty 模式在 web 侧真正生效
- 时区 / 时间格式不再依赖 `createLogger()` 的内部默认值碰运气
- `debug` 起始请求日志是否显示，由 web logger 自己的 level 控制，而不是被历史硬编码卡死

本次不引入新的外部配置入口；只改变 web 内部 logger 的构造方式。

### 5.4 playground / preview 的 logging shape 对齐

`src/web/xquery_playground.ts` 与 `src/web/syndication_playground.ts` 内部构造的临时 config 继续存在，但要满足两点：

1. shape 与正式 `AppConfigResolved.logging` 一致
2. 与仓库 logging 契约表达一致，不制造“看起来像 resolved config，但字段不完整或语义不同”的临时特例

这里的目标不是让 playground 读取用户的 runtime config，而是让仓库内部的“临时 resolved config”也 obey 同一份契约。

### 5.5 pretty 展示层增加按级别裁剪策略

底层 JSON 不变，只对 pretty 展示做策略化重排。

#### info

优先显示最小字段集：

- 时间戳
- severity
- `scope.name`
- `body`

仅在确实有助于理解事件时，附带少量高价值字段，例如：

- `source.id`
- `source.run_id`
- `delivery.id`
- `web.request_id`
- `http.request.method`
- `http.route`
- `http.response.status_code`

#### debug / trace

在保持最小字段集的前提下，允许显示更多真实诊断字段，以支持调试。

#### warn / error / fatal

优先显示：

- 结果字段
- 原因字段
- 错误类别 / 错误消息
- trace 关联字段（若真实存在）

若不存在则直接省略，不补占位值。

### 5.6 JSON 契约完全保持不变

本次任何裁剪、重排、着色都只发生在 pretty 展示层。

JSON 模式必须继续直接反映当前底层 record，确保：

- 采集面不受影响
- 现有 JSON 断言测试不需要被“展示层逻辑”污染
- pretty 与 json 表达同一条底层 record，而不是两套契约

## 6. 测试设计

本次必须按 TDD 推进。先补失败测试，再写实现。

### 6.1 `src/main_test.ts`

新增/调整测试覆盖：

- web 启动应输出统一 startup log
- startup log 应包含 host / port / url
- startup log 在 json / pretty 路径下都能被正确生成（可分别通过注入 writer 或抽出的构造函数断言）

### 6.2 `web/main_test.ts`

新增/调整测试覆盖：

- web logger 不再是硬编码历史行为
- web 请求日志可以接收共享 logging 选项
- pretty 模式下的 web 请求日志保留最小字段集与关键属性

### 6.3 `src/core/logger_test.ts`

新增/调整测试覆盖：

- pretty info 只展示最小字段集与少量高价值字段
- pretty debug / trace 能显示更多诊断属性
- pretty warn / error 会优先展示结果、原因与错误字段
- JSON 输出完全不受 pretty 裁剪影响

### 6.4 playground / preview 相关测试

新增/调整测试覆盖：

- xquery playground 临时 config 的 logging shape 正确
- syndication playground 临时 config 的 logging shape 正确
- preview runtime 在需要 logger 选项时与正式 runtime 契约一致

## 7. 验证计划

代码改动完成后，按以下顺序验证：

1. 最窄相关测试：
   - `deno task test src/main_test.ts web/main_test.ts src/core/logger_test.ts`
2. 若 playground 测试文件受影响，再追加对应 scoped test
3. 因为命中共享高影响边界 `src/main.ts`，收尾必须运行全量：
   - `deno task test`
4. 按影响追加：
   - `deno task check src/main.ts web/main.ts`
   - 如 logger 核心有改动，再补相关受影响路径的 `check`

## 8. 风险与控制

### 风险 1：误改 `createLogger()` 默认语义，影响 daemon 与既有测试

控制方式：

- 避免通过“修改全局默认值”来修入口行为
- 优先把变化限制在共享接线层与 pretty 展示裁剪逻辑

### 风险 2：pretty 裁剪把必要字段藏掉，导致调试信息不足

控制方式：

- 只裁剪展示，不裁剪底层 record
- `debug/trace` 显示更多字段
- `warn/error/fatal` 优先显示原因与错误上下文

### 风险 3：web / daemon 边界被错误拉平，演变成 CLI 变更

控制方式：

- 明确保持 CLI 分离
- web 不读取用户的 `runtime/config.yml`
- 共享层只统一 logger 选项拼装，不统一配置加载入口

## 9. 结论

本次收口采用“**不改 CLI，只统一日志接线与 pretty 展示层**”的方案。

最终结果应满足：

- web 与 daemon 保持各自启动契约
- web 启动拥有仓库自己的统一 startup log
- web / daemon / playground / preview 的 logger 接线行为一致
- pretty 真正完成时间、颜色、字段裁剪策略落地
- JSON 日志契约保持稳定不变
