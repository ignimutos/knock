# Knock

Knock 是一个基于 Deno + TypeScript 的订阅抓取与投递守护进程。

它按计划抓取 RSS / Atom / JSON Feed，或通过 XQuery 从 HTML/XML 提取条目；随后统一 feed 与 entry 字段，执行 Liquid 过滤与渲染，并将结果投递到 file、push(HTTP)、email(SMTP) 通道，同时把状态与去重信息写入 SQLite。

## 功能概览

- 输入能力：RSS / Atom / JSON Feed、XQuery 页面提取、summary 窗口汇总。
- 处理链路：字段统一、Liquid 过滤、模板渲染。
- 投递通道：file、push、email。
- 运行模式：`all`、`web`、`daemon`，支持 `--immediate` 一次性执行。
- 状态存储：SQLite 记录 feed、entry、delivery 去重状态。
- 日志：按 sink 配置输出；console 支持 `pretty|jsonl`，file 第一版支持 `jsonl`。

## 架构概览

### 主干结构

```text
src/main.ts                  CLI 入口与 mode 分流
src/config/                  配置契约、加载、校验与解析
src/definitions/             canonical delivery/source/binding 定义编译
src/composition/             生产/预览运行时组合根
src/application/             用例、pipeline 与 stage 编排
src/infrastructure/          SQLite、source gateway、delivery executor 适配层
src/core/                    通用 runtime（日志、Liquid、AI、调度、HTTP）
src/sources/                 syndication / xquery / summary 解析能力
src/deliveries/              file / push / email 通道能力
src/interfaces/              CLI、daemon、web 等入口适配面
src/db/                      SQLite 客户端、schema 与状态存储
web/                         网页调试页与 API 路由
config.example.yml           完整参考配置
deno.json                    任务脚本入口
```

## 快速开始

### 1) 准备环境

```bash
deno --version
```

```bash
git clone <你的仓库地址> knock
cd knock
```

### 2) 基于参考配置创建配置文件

`config.example.yml` 是仓库内完整参考配置；请基于它裁剪出你的配置文件 `<your-config.yml>`。

### 3) 先落地最小 file 链路

```yml
sqlite:
  path: knock.db

deliveries:
  local:
    file:
      path: outputs/releases.md
      content: |
        ## [{{ entry.title }}]({{ entry.link }})

        {{ entry.content | strip_html }}

        ---

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      local: {}
```

### 4) 先跑一次即时执行

```bash
deno task daemon --config <your-config.yml> --immediate
```

### 5) 启动常驻模式

```bash
deno task start --config <your-config.yml>
```

## 配置设计原则

1. `deliveries.<id>` 是 canonical delivery 定义区，`sources.<id>.deliveries` 是 keyed override 区；source 通过 delivery ID 引用并覆写消息子树。
2. `deliveries.<id>.enabled` 可控制该 canonical delivery 是否参与装配；默认 `true`，设为 `false` 后不会生成 source 侧 resolved delivery/binding。
3. `sources.<id>.deliveries` 只允许覆写 `file.content`、`push.request.payload`、`email.message`。
4. 覆写合并语义：对象 deep merge、数组整体替换、标量直接替换，v1 不支持 null-delete。
5. 每个 source 选择一种抓取入口：`http` 或 `byparr`。
6. 每个 source 选择一种解析器：`syndication` 或 `xquery`；当两者都省略时，运行时语义等价于 `syndication: {}`。
7. `summary` source 采用互斥模型：启用 `summary` 后，source 进入汇总模式，并使用独立窗口语义。
8. 配置加载阶段先展开 `${ENV_VAR}`，运行阶段再渲染 Liquid 模板；同一字符串中两者并存时，执行顺序保持为“先 ENV，后 Liquid”。
9. `sqlite.path` 与 `deliveries.*.file.path` 的相对路径都相对 `runtime_dir` 解析。

## 完整配置模型长这样：

```yml
language: zh-CN
timezone: Asia/Shanghai
timestampFormat: yyyy-MM-dd HH:mm:ss

sqlite:
  path: knock.db
  busyTimeout: 5s
  journalMode: WAL
  retention:
    maxAge: 180d
    maxEntriesPerSource: 1000
    vacuum: off

ai:
  defaultModel: openai_main/default
  providers:
    openai_main:
      type: openai
      apiKey: '${OPENAI_API_KEY}'
      models:
        default:
          model: gpt-4o-mini

deliveries:
  local:
    enabled: true
    file:
      path: outputs/releases.md
      content: |
        ## [{{ title }}]({{ link }})

        {{ content | strip_html }}

        ---
  telegram_webhook:
    push:
      http:
        method: POST
        url: '${TELEGRAM_WEBHOOK_URL}'
      request:
        type: body
        payload:
          chat_id: '${TELEGRAM_CHAT_ID}'
          parse_mode: 'HTML'
          text: |
            <b>{{ title }}</b>

            {{ content | to_telegram_html }}

            {{ link }}
  release_email:
    email:
      smtp:
        host: '${SMTP_HOST}'
        port: 587
        security: starttls
      message:
        from: bot@example.com
        to:
          - team@example.com
        subject: '[{{ source.id }}] {{ entry.title }}'
        text: |
          {{ entry.title }}

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    schedule: '0 */30 * * * *'
    deliveries:
      local: {}
      telegram_webhook:
        payload:
          parse_mode: 'HTML'
          text: |
            <b>[{{ source.id }}] {{ title }}</b>

            {{ content | to_telegram_html }}

            {{ link }}
      release_email:
        message:
          subject: '[release][{{ source.id }}] {{ entry.title }}'
  daily_summary:
    schedule: '0 0 8 * * *'
    deliveries:
      local: {}
    summary:
      sources:
        - deno
      feed:
        title: '{{ sources.deno.feed.title }} Daily Summary'
      entry:
        id: '{{ source.id }}:{{ source.runtime.window.previousCheckpoint }}..{{ source.runtime.window.scheduledAt }}'
        description: |
          窗口：{{ source.runtime.window.previousCheckpoint }} -> {{ source.runtime.window.scheduledAt }}
          条目数：{{ sources.deno.entries | size }}

logging:
  level: info
  sinks:
    console:
      type: console
      format: pretty
    file:
      type: file
      format: jsonl
      path: logs/app.jsonl
      rotation:
        type: time
        interval: daily
        maxAge: 7d
```

## 完整键索引

### 顶层键

- `language`
- `timezone`
- `timestampFormat`
- `sqlite.path`
- `sqlite.busyTimeout`
- `sqlite.journalMode`
- `sqlite.retention.maxAge`
- `sqlite.retention.maxEntriesPerSource`
- `sqlite.retention.vacuum`
- `ai`
- `deliveries`
- `sources`
- `logging.level`
- `logging.sinks.console.type`
- `logging.sinks.console.format`
- `logging.sinks.file.type`
- `logging.sinks.file.format`
- `logging.sinks.file.path`
- `logging.sinks.file.rotation.type`
- `logging.sinks.file.rotation.maxSize`
- `logging.sinks.file.rotation.maxFiles`
- `logging.sinks.file.rotation.interval`
- `logging.sinks.file.rotation.maxAge`

### `ai` 键路径

- `ai.defaultModel`
- `ai.providers.<providerId>.type`
- `ai.providers.<providerId>.apiKey`
- `ai.providers.<providerId>.baseURL`
- `ai.providers.<providerId>.headers.<headerKey>`
- `ai.providers.<providerId>.options.organization`
- `ai.providers.<providerId>.options.project`
- `ai.providers.<providerId>.options.authToken`
- `ai.providers.<providerId>.models.<modelId>.model`
- `ai.providers.<providerId>.models.<modelId>.context`
- `ai.providers.<providerId>.models.<modelId>.temperature`
- `ai.providers.<providerId>.models.<modelId>.maxOutputTokens`
- `ai.providers.<providerId>.models.<modelId>.options.reasoningEffort`
- `ai.providers.<providerId>.models.<modelId>.options.json`
- `ai.providers.<providerId>.models.<modelId>.variants.<variantId>.temperature`
- `ai.providers.<providerId>.models.<modelId>.variants.<variantId>.maxOutputTokens`
- `ai.providers.<providerId>.models.<modelId>.variants.<variantId>.options.reasoningEffort`
- `ai.providers.<providerId>.models.<modelId>.variants.<variantId>.options.json`

### `deliveries` 键路径

- `deliveries.<deliveryId>.enabled`
- `deliveries.<deliveryId>.file.path`
- `deliveries.<deliveryId>.file.content`
- `deliveries.<deliveryId>.file.rotation.enabled`
- `deliveries.<deliveryId>.file.rotation.size`
- `deliveries.<deliveryId>.file.rotation.age`
- `deliveries.<deliveryId>.file.rotation.backups`
- `deliveries.<deliveryId>.push.http.method`
- `deliveries.<deliveryId>.push.http.url`
- `deliveries.<deliveryId>.push.http.timeout`
- `deliveries.<deliveryId>.push.http.headers.<headerKey>`
- `deliveries.<deliveryId>.push.http.proxy`
- `deliveries.<deliveryId>.push.http.retry.limit`
- `deliveries.<deliveryId>.push.http.retry.statusCodes[]`
- `deliveries.<deliveryId>.push.http.retry.retryOnTimeout`
- `deliveries.<deliveryId>.push.http.retry.backoffLimit`
- `deliveries.<deliveryId>.push.request.type`
- `deliveries.<deliveryId>.push.request.payload`
- `deliveries.<deliveryId>.push.response.predicate`
- `deliveries.<deliveryId>.push.response.message`
- `deliveries.<deliveryId>.email.smtp.host`
- `deliveries.<deliveryId>.email.smtp.port`
- `deliveries.<deliveryId>.email.smtp.security`
- `deliveries.<deliveryId>.email.smtp.auth.username`
- `deliveries.<deliveryId>.email.smtp.auth.password`
- `deliveries.<deliveryId>.email.message.from`
- `deliveries.<deliveryId>.email.message.to[]`
- `deliveries.<deliveryId>.email.message.cc[]`
- `deliveries.<deliveryId>.email.message.bcc[]`
- `deliveries.<deliveryId>.email.message.replyTo[]`
- `deliveries.<deliveryId>.email.message.subject`
- `deliveries.<deliveryId>.email.message.text`
- `deliveries.<deliveryId>.email.message.html`
- `deliveries.<deliveryId>.email.message.headers.<headerKey>`

### `sources` 键路径

- `sources.<sourceId>.name`
- `sources.<sourceId>.enabled`
- `sources.<sourceId>.schedule`
- `sources.<sourceId>.filter`
- `sources.<sourceId>.deliveries.<deliveryId>`
- `sources.<sourceId>.deliveries.<deliveryId>.content`（file override）
- `sources.<sourceId>.deliveries.<deliveryId>.payload`（push override）
- `sources.<sourceId>.deliveries.<deliveryId>.message`（email override）
- `sources.<sourceId>.http.url`
- `sources.<sourceId>.http.timeout`
- `sources.<sourceId>.http.headers.<headerKey>`
- `sources.<sourceId>.http.proxy`
- `sources.<sourceId>.http.retry.limit`
- `sources.<sourceId>.http.retry.statusCodes[]`
- `sources.<sourceId>.http.retry.retryOnTimeout`
- `sources.<sourceId>.http.retry.backoffLimit`
- `sources.<sourceId>.byparr.endpoint`
- `sources.<sourceId>.byparr.cmd`
- `sources.<sourceId>.byparr.url`
- `sources.<sourceId>.byparr.maxTimeout`
- `sources.<sourceId>.byparr.proxy`
- `sources.<sourceId>.syndication.feed.<fieldKey>`
- `sources.<sourceId>.syndication.entry.<fieldKey>`
- `sources.<sourceId>.xquery.locate`
- `sources.<sourceId>.xquery.feed`
- `sources.<sourceId>.xquery.entry`
- `sources.<sourceId>.xquery.namespaces.<prefix>`
- `sources.<sourceId>.summary.sources[]`
- `sources.<sourceId>.summary.feed.title`
- `sources.<sourceId>.summary.feed.link`
- `sources.<sourceId>.summary.feed.description`
- `sources.<sourceId>.summary.feed.generator`
- `sources.<sourceId>.summary.feed.language`
- `sources.<sourceId>.summary.feed.published`
- `sources.<sourceId>.summary.entry.id`
- `sources.<sourceId>.summary.entry.title`
- `sources.<sourceId>.summary.entry.link`
- `sources.<sourceId>.summary.entry.description`
- `sources.<sourceId>.summary.entry.content`
- `sources.<sourceId>.summary.entry.published`
- `sources.<sourceId>.summary.entry.updated`

## 配置说明

### `sqlite`

- `sqlite.path` 默认 `knock.db`。
- `sqlite.busyTimeout` 默认 `5s`。
- `sqlite.journalMode` 支持 `WAL` / `DELETE`，默认 `WAL`。
- `sqlite.retention.maxAge` 默认 `180d`，`maxEntriesPerSource` 默认 `1000`，`vacuum` 支持 `off` / `afterPrune`。

### `logging`

- `logging.level` 支持 `trace|debug|info|warn|error|fatal`，默认 `info`。
- `logging.sinks.console.format` 支持 `pretty|jsonl`。
- `logging.sinks.file.format` 第一版固定为 `jsonl`。
- sink 仅在显式配置后才创建；不再保留顶层 `logging.format`。
- `logging.sinks.file.rotation.type=size` 时使用 `maxSize` / `maxFiles`。
- `logging.sinks.file.rotation.type=time` 时使用 `interval` / `maxAge`。

### `deliveries`

- 每个 delivery 选择一种目标：`file`、`push`、`email`。
- `deliveries.<id>.enabled` 默认 `true`；设为 `false` 时，该 delivery 不参与 source 侧装配。
- `file` 负责本地追加写入，支持 `rotation`。
- `push` 负责 HTTP 投递，分为 `push.http`（传输层）与 `push.request`（负载层），支持 `response.predicate` 自定义成功判定。
- `sources.<id>.deliveries` 仅覆写消息子树：file 覆写 `content`，push 覆写 `payload`，email 覆写 `message`。

### `sources`

- `schedule` 使用 Croner 语法，支持秒级表达式。
- `filter` 需返回 `true/false` 字符串。
- `syndication` 用于 RSS/Atom/JSON Feed 映射。
- `xquery` 用于 HTML/XML 提取，`entry.id` 作为稳定主键。
- `summary` source 不抓外部输入。
- `summary` source 必须配置 `schedule`。
- 窗口前界取该 summary source 自身上次成功写入的 feed/checkpoint。
- 窗口内上游 entries 取自 `(previousCheckpoint, scheduledAt]` 区间内已交付 facts。
- 模板窗口变量包含 `source.runtime.window.previousCheckpoint` 与 `source.runtime.window.scheduledAt`。
- 上游汇总对象包含 `sources.<id>.name`、`sources.<id>.feed`、`sources.<id>.entries`。
- 当前实现里的 `sources.<id>.name` 也来自最近保存的 `feed.title`，若缺失则为空串。

### 高频 Liquid 过滤器

- `match_regex`：正则匹配，适合 source 侧 `filter`。
- `extract_regex`：提取正则命中或捕获组，适合先抽值再比较；例如 `{% assign amount = title | extract_regex: "([0-9]+)(?=元)" %}{% if amount > 1800 %}true{% else %}false{% endif %}`。
- `strip_html`：去标签与空白归一，适合生成文本摘要。
- `to_telegram_html`：将 HTML 规范化为 Telegram HTML 可发送子集。
- `to_telegram_markdown_v2`：将 Markdown/纯文本转换为 Telegram MarkdownV2 可发送文本。

## AI 配置

### 用途

`ai` 为 `ai_translate` 和 `ai_summarize` 提供 provider / model 元数据、默认模型与预算参数。

### 最小示例

```yml
language: zh-CN

ai:
  defaultModel: openai_main/default
  providers:
    openai_main:
      type: openai
      apiKey: '${OPENAI_API_KEY}'
      models:
        default:
          model: gpt-4o-mini
```

### 关键约束

- provider 类型：`openai`、`anthropic`、`gemini`。
- `defaultModel` 支持 `providerId/modelId` 与裸 `modelId`；裸引用在重名场景需改为全引用。
- `models.<id>.model` 使用静态字面量。
- `variants.<id>` 覆写 `temperature`、`maxOutputTokens`、`options`。
- `anthropic` 的 `apiKey` 与 `options.authToken` 采用互斥关系。

### 常见坑

- 配置里使用 AI 过滤器时，`ai.providers.*.models` 需要可解析模型。
- `ai.defaultModel` 指向不存在模型会在配置阶段报错。
- 在 source/filter 或 delivery 模板中使用 AI 过滤器时，参数值使用静态字面量。

## 常用组合示例

### 1) webhook

```yml
deliveries:
  webhook:
    push:
      http:
        method: POST
        url: '${WEBHOOK_URL}'
        headers:
          Authorization: 'Bearer ${WEBHOOK_TOKEN}'
      request:
        type: body
        payload:
          text: '{{ entry.title }} => {{ entry.link }}'
      response:
        predicate: '{{ ok }}'
        message: 'webhook failed: {{ status }}'

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      webhook: {}
```

### 2) xquery

```yml
sources:
  website_news:
    http:
      url: https://example.com/news
    deliveries:
      local: {}
    xquery:
      locate: //article
      feed:
        title: string(//title)
      entry:
        id: string(@data-id)
        title: string(.//h2)
        link: string(.//a/@href)
        description: string(.//p)
```

### 3) summary

```yml
sources:
  daily_summary:
    schedule: '0 0 8 * * *'
    deliveries:
      local:
        content: |
          # {{ title }}

          {{ description }}

          {{ content }}

          ---
    summary:
      sources:
        - deno
      feed:
        title: '{{ sources.deno.feed.title }} Daily Summary'
      entry:
        id: '{{ source.id }}:{{ source.runtime.window.previousCheckpoint }}..{{ source.runtime.window.scheduledAt }}'
        title: '{{ sources.deno.feed.title }} Daily Summary'
        description: |
          窗口：{{ source.runtime.window.previousCheckpoint }} -> {{ source.runtime.window.scheduledAt }}
          条目数：{{ sources.deno.entries | size }}
```

## 网页调试页

- 首页：`/`
- XQuery Playground：`/xquery`
- Syndication Playground：`/syndication`
- API：`POST /api/xquery/evaluate`、`POST /api/syndication/evaluate`

启动方式：

```bash
deno task start --mode web
```

## 命令行用法

```bash
deno run --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-run src/main.ts \
  [--mode <all|web|daemon>] \
  [--config <path>] \
  [--runtime_dir <dir>] \
  [--immediate] \
  [--web_host <host>] \
  [--web_port <port>]
```

### 参数说明

- `--mode`：`all`（默认）/`web`/`daemon`
- `--config`：显式配置文件路径
- `--runtime_dir`：运行目录
- `--immediate`：daemon 立即执行一次后退出
- `--web_host` / `--web_port`：web 监听地址

### mode 参数约束

- `web` 模式：支持 `--web_host`、`--web_port`。
- `daemon` 模式：支持 `--config`、`--runtime_dir`、`--immediate`。
- `web` 模式与 `--config` / `--runtime_dir` / `--immediate` 组合会触发参数错误。
- `daemon` 模式与 `--web_host` / `--web_port` 组合会触发参数错误。

### `--config` 与 `--runtime_dir` 优先级与路径解析

`runtime_dir` 决策顺序：

1. CLI `--runtime_dir`
2. 环境变量 `KNOCK_RUNTIME_DIR`
3. `--config` 文件所在目录
4. `当前工作目录/runtime`

`config` 决策顺序：

1. CLI `--config`
2. `<runtime_dir>/config.yml`
3. `<runtime_dir>/config.yaml`

路径解析细节：

- CLI 传入的 `--config` 与 `--runtime_dir` 相对路径按当前工作目录解析为绝对路径。
- `sqlite.path`、`deliveries.*.file.path` 的相对路径按最终 `runtime_dir` 解析。
- `--config` 与 `--runtime_dir` 同时出现时，配置文件读取位置取 `--config`，运行期相对路径基准取 `--runtime_dir`。

## 容器部署

### 构建

```bash
docker build -t knock:local .
```

### 运行

```bash
docker run --rm \
  -v "<宿主机持久化目录>:/app/runtime" \
  -e WEBHOOK_URL=https://example.com/webhook \
  -e WEBHOOK_TOKEN=xxx \
  knock:local --config /app/runtime/config.yml
```

将宿主机持久化目录挂载到容器内默认运行目录 `/app/runtime`，并通过容器环境变量注入密钥与令牌。

Docker Hub 镜像页说明文档维护在 `docker/README.md`，并在 `main` 镜像发布时由 `.github/workflows/docker.yml` 一并同步。

## 日志

日志按显式 sink 配置输出：console 支持 `pretty|jsonl`，file 第一版支持 `jsonl`。JSONL 字段遵循 OTel 风格结构：`severityText`、`severityNumber`、`body`、`attributes`、`resource.attributes`、`scope.name`、`trace_id/span_id/trace_flags`。

当前 v2 执行点：source 抓取/解析日志来自 `src/infrastructure/sources/http_source_input_gateway.ts`、`src/infrastructure/sources/byparr_source_input_gateway.ts`、`src/infrastructure/sources/source_parser_gateway.ts`；pipeline 的 filter/dedupe/delivery/finalize 日志来自 `src/application/run_source_use_case.ts` 与 `src/application/stages/delivery_stage.ts`。

Namespaced 关键字段示例：`source.id`、`source.run_id`、`pipeline.item_id`、`delivery.id`、`template.ai.provider`、`template.ai.model_ref`、`template.ai.outcome`。

HTTP failure 日志不记录原始 `response_body`；只记录如 `delivery.reason`、`http.response.status_code` 与安全错误摘要。

`pretty` 是控制台展示层，适合本地调试；`jsonl` 适合日志采集与检索。两种格式表达同一条底层记录语义，`pretty` 不改变底层字段归属；file sink 仅在显式配置后创建，并支持 size/time 二选一 rotation。

常用配置入口：

```yml
logging:
  level: info
  sinks:
    console:
      type: console
      format: pretty
    file:
      type: file
      format: jsonl
      path: logs/app.jsonl
      rotation:
        type: time
        interval: daily
        maxAge: 7d
```

## 去重与状态存储

- `source_runs`：记录每次 source 执行的触发方式、时间窗口、聚合计数与最终状态。
- `pipeline_items`：记录单次 source run 产出的标准化条目与处理结果。
- `delivery_attempts`：记录每条条目在每个 delivery 通道上的投递尝试快照与结果。
- `deduplications`：基于 `deduplication_key` 记录跨运行去重命中，避免重复处理与重复投递。

这四类状态共同保证“增量抓取 + 稳定去重 + 可追溯运行链路”。

## 生产使用建议

1. 先用 `--immediate` 验证配置与模板，再进入常驻调度。
2. 启动命令显式传入 `--config`，确保进程读取目标配置文件。
3. 将 SQLite 所在目录与 file delivery 输出目录挂载到宿主持久化存储，保证跨重启保留状态与产物。
4. 对外抓取源配置稳定 `User-Agent`、合理 `timeout` 与 `retry`。
5. 将 token、密码、chat id 统一走环境变量注入。

## 常见问题

### 1) 配置文件定位失败

优先检查启动命令里的 `--config` 路径是否存在且可读；依赖默认发现顺序时，按“命令行用法”章节的 `--config` 与 `--runtime_dir` 路径解析规则逐项核对。

### 2) 环境变量未注入

`${ENV_VAR}` 在加载阶段展开，缺失变量会直接触发配置错误。

### 3) source 入口或解析器冲突

source 使用互斥组合：`http | byparr` 选择其一，`syndication | xquery` 选择其一，`summary` 使用独立汇总模式。

### 4) filter 报错

`filter` 的渲染结果使用 `true/false` 字符串。
需要从字段中提取数值再比较时，可用 `extract_regex`，再配合 `assign + if` 做比较，例如 `{% assign amount = title | extract_regex: "([0-9]+)(?=元)" | default: "0" %}{% if amount > 1800 %}true{% else %}false{% endif %}`。

### 5) summary 首次运行没有 entry

首次窗口缺少历史 checkpoint，当前实现产出默认 feed；下一次运行会基于 checkpoint 生成 summary entry。
