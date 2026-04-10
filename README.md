# Knock

一个用 Deno + TypeScript 写的订阅抓取与投递守护进程。

它会按计划抓取 RSS / Atom / JSON Feed，或者用 XQuery 从 HTML/XML
页面里提取条目；然后把条目统一成一套字段，经过 Liquid
过滤与模板渲染后，投递到文件、HTTP 或 SMTP 邮件
接口，并把抓取状态与去重信息保存到 SQLite。

适合这几类场景：

- 盯 GitHub Releases、博客、公告页，并把新内容汇总到 Markdown 文件
- 把抓取结果推给 webhook、企业微信网关、自动化流程
- 通过通用 HTTP push 直连 Telegram Bot API
- 从没有标准 Feed 的网页中，用 XQuery 自己抽取列表项

## 功能概览

- **订阅抓取**
  - RSS
  - Atom
  - JSON Feed
  - XQuery 提取 HTML / XML
- **统一字段模型**
  - feed：`title` `link` `description` `generator` `language` `published`
  - entry：`id` `title` `link` `description` `content` `published` `updated`
- **模板与过滤**
  - Liquid 模板渲染
  - 自定义过滤器：`match_exact` `match_fuzzy` `match_regex` `strip_html`
    `to_html` `to_markdown` `to_telegram_html` `to_telegram_markdown_v2`
- **投递目标**
  - 文件追加写入
  - HTTP / Webhook 推送
  - SMTP 邮件发送
- **运行能力**
  - cron 调度
  - 一次性执行模式 `--immediate`
  - SQLite 去重与保留策略
  - 结构化 JSON 日志
  - Docker 运行

## 目录结构

```text
src/main.ts                 CLI 入口
src/core/app.ts             主流程：抓取、解析、过滤、去重、投递、调度
src/config/                 配置加载、校验、解析
src/sources/                syndication / xquery 数据源解析器
src/deliveries/             file / http / email 投递器
src/db/                     SQLite 客户端、schema、migration
runtime/config.yml          默认运行配置
config.example.yml          提交到仓库的完整参考配置
Dockerfile                  容器镜像构建
```

## Web Playground

- 首页：`/`
- Playground：`/xquery`
- API：`/api/xquery/evaluate`

说明：

- Playground 默认 URL 为空，需要手动输入。
- Playground 由服务端发起目标 URL 抓取请求，请仅在可信网络环境使用。
- `/api/xquery/evaluate` 失败时会返回更明确的错误 `message`，便于区分请求非法、抓取失败与表达式执行失败等场景。
- 界面支持主题切换（跟随系统 / 浅色 / 深色），默认跟随系统并在浏览器本地记住你的选择。
- 若浏览器不支持系统主题检测能力，会自动回退为浅色。

## 工作原理

一次 source 执行时，Knock 大致会做这些事：

1. 读取 `runtime/config.yml`
2. 抓取 `source.http.url`
3. 用 `syndication` 或 `xquery` 解析内容
4. 统一成 feed / entry 字段
5. 用 `filter` 决定是否跳过条目
6. 按 delivery 类型渲染内容或请求字段
7. 检查 SQLite 去重状态
8. 发送到文件 / HTTP / SMTP 邮件
9. 记录已投递状态、抓取内容和 entry 元数据
10. 按 retention 规则清理旧记录

## 快速开始：从零跑起来

下面按**完全从零**的方式写。先做最简单、最容易验证的一种：

- 数据源：GitHub Releases Atom
- 投递方式：写入本地 Markdown 文件
- 运行方式：一次性执行

### 1) 安装 Deno

先确认你有 Deno：

```bash
deno --version
```

如果没有，按 Deno 官方方式安装。安装完成后重新执行上面的命令。

### 2) 克隆项目

```bash
git clone <你的仓库地址> knock
cd knock
```

### 3) 看一下配置入口

项目默认使用：

- 配置文件：`runtime/config.yml`
- 运行目录：`runtime/`
- 默认启动命令：`deno task start`（同时启动 web + daemon）
- 完整参考配置：`config.example.yml`

其中：

- `config.example.yml` 是仓库内提交的完整参考配置，包含 file /
  HTTP / xquery / syndication 示例
- `runtime/config.yml` 是你本地真正要运行的配置入口

如果你不传 `--config` 和 `--runtime_dir`，程序会优先按下面的顺序找运行目录：

1. CLI 参数 `--runtime_dir`
2. 环境变量 `KNOCK_RUNTIME_DIR`
3. `--config` 所在目录
4. 当前工作目录下的 `runtime/`

### 4) 先准备一个最小可用配置

如果你想先看完整参考配置，直接打开仓库根目录下的 `config.example.yml`。

然后再把 `runtime/config.yml` 改成下面这样：

```yml
sqlite:
  path: knock.db

deliveries:
  local:
    file:
      path: outputs/releases.md
      content: |
        ## [{{ title }}]({{ link }})

        {{ content | strip_html }}

        ---

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      - local
```

这份配置的意思：

- 把 SQLite 数据库放在 `runtime/knock.db`
- 把抓到的新条目追加写到 `runtime/outputs/releases.md`
- 数据源是 Deno 的 GitHub Releases Atom
- 不写 `schedule`，所以它只会在你手动执行时跑一次
- 不写 `syndication` 也没关系，Knock 会默认按 syndication 源解析

> [!TIP]
> 如果你要配置 HTTP webhook、XQuery、过滤表达式或更完整的字段映射，
> 请直接参考仓库根目录下的 `config.example.yml`。

### 5) 运行一次

```bash
deno run --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-run src/main.ts --mode daemon --config runtime/config.yml --immediate
```

或者用项目自带 task：

```bash
deno task daemon --config runtime/config.yml --immediate
```

> [!NOTE]
> `deno task start` 实际执行的是
> `deno run --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-run src/main.ts`。
> 默认模式是 `--mode all`（同时启动 web + daemon）。
> 如果你要做一次性 daemon 验证，请用 `deno task daemon --immediate`。

### 6) 验证结果

你应该能看到这些东西：

- `runtime/knock.db`
- `runtime/outputs/releases.md`

再打开文件确认内容：

```bash
ls runtime/data runtime/outputs
```

如果 `releases.md` 里已经有抓到的标题、链接和正文摘要，说明最小链路已经通了。

### 7) 切换成守护进程模式

给 source 加上 `schedule`：

```yml
sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    schedule: '0 */30 * * * *'
    deliveries:
      - local
```

然后启动：

```bash
deno task daemon --config runtime/config.yml
```

程序会常驻，根据 cron 周期抓取。

> [!TIP]
> 这里使用的是 `Croner` 语法，支持秒级 cron。上面的 `0 */10 * * * *` 表示“每 10
> 分钟执行一次，在第 0 秒触发”。

---

## Docker 部署

项目自带 `Dockerfile`，镜像同时包含 daemon 与 web 代码（`src/` + `web/` + `vite.config.ts`）。

### 构建镜像

```bash
docker build -t knock:local .
```

### 运行容器

```bash
docker run --rm \
  -v "$PWD/runtime:/app/runtime" \
  -e WEBHOOK_URL=https://example.com/webhook \
  -e WEBHOOK_TOKEN=xxx \
  -e WEBHOOK_TAG=news \
  knock:local
```

容器里默认：

- 工作目录：`/app`
- 运行目录环境变量：`KNOCK_RUNTIME_DIR=/app/runtime`
- 默认命令：`deno task start`

所以你只要把宿主机的 `runtime/` 挂进去，配置和 SQLite 数据就会持久化。

> [!IMPORTANT]
> 如果你在配置里用了 `${WEBHOOK_URL}`、`${WEBHOOK_TOKEN}`
> 之类的占位符，就必须把这些环境变量传进容器、systemd、PM2
> 或你自己的进程管理器里。这个项目**不会自动读取 `.env`
> 文件**，它只读取进程环境变量。

---

## CLI 用法

入口文件是 `src/main.ts`，支持这些参数：

```bash
deno run ... src/main.ts [--mode <all|web|daemon>] [--config <path>] [--runtime_dir <dir>] [--immediate] [--web_host <host>] [--web_port <port>]
```

### 参数说明

#### `--mode <all|web|daemon>`

运行模式。

- `all`：同时启动 web + daemon（默认）
- `web`：仅启动 web
- `daemon`：仅启动 daemon

模式约束：

- `web` 模式只接受 `--web_host` / `--web_port`
- `daemon` 模式只接受 `--config` / `--runtime_dir` / `--immediate`

#### `--config <path>`

指定配置文件路径。

例如：

```bash
deno task daemon --config runtime/config.yml
```

#### `--runtime_dir <dir>`

指定运行目录。相对路径文件（SQLite、file delivery
输出文件）都会相对于这个目录解析。

例如：

```bash
deno task daemon --config configs/prod.yml --runtime_dir runtime-prod
```

#### `--immediate`

立即执行一次所有已启用 source，然后退出，不进入常驻调度模式（仅 `daemon` 模式可用）。

适合：

- 首次验证配置
- 配合 crontab / CI 外部调度
- 调试模板和过滤逻辑

#### `--web_host <host>` / `--web_port <port>`

Web 服务监听地址与端口（仅 `web` / `all` 模式可用）。

默认监听 `127.0.0.1:8000`。

### 错误处理

CLI 对未知参数和缺少值会直接报错，例如：

- `未知参数: --unknown`
- `--config 缺少路径参数`
- `--runtime_dir 缺少目录参数`

---

## 配置总览

完整配置模型长这样：

```yml
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

deliveries:
  local:
    file:
      path: outputs/releases.md
      content: |
        ## [{{ title }}]({{ link }})

        {{ content | strip_html }}

        ---
      rotation:
        enabled: true
        size: 10m
        age: 7d
        backups: 3

  telegram_webhook:
    push:
      http:
        method: POST
        url: 'https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage'
      request:
        type: body
        payload:
          chat_id: '${TELEGRAM_CHAT_ID}'
          text: |
            <b>{{ title }}</b>

            {{ content | strip_html }}

            {{ link }}

  webhook:
    push:
      http:
        method: POST
        url: '${WEBHOOK_URL}'
        timeout: 10s
        headers:
          Authorization: 'Bearer ${WEBHOOK_TOKEN}'
      request:
        type: body
        payload:
          text: '{{ entry.title }} => {{ entry.link }}'
          meta:
            source: '{{ source.id }}'
            note: '${WEBHOOK_TAG}: {{ entry.published }}'
            tags:
              - release
              - '${WEBHOOK_TAG}'
      response:
        predicate: '{{ ok }}'
        message: 'webhook failed: {{ status }} {{ body }}'

sources:
  deno:
    name: Deno releases
    enabled: true
    http:
      url: https://github.com/denoland/deno/releases.atom
      timeout: 5s
      headers:
        User-Agent: knock-example
    schedule: '0 */30 * * * *'
    deliveries:
      - local
      - telegram_webhook
      - webhook
      - release_email
    filter: '{{ title | match_regex: "release", "i" }}'
    syndication:
      entry:
        id: '{{ id }}'
        title: '{{ title }}'
        link: '{{ link }}'
        description: '{{ description }}'
        content: '{{ content }}'
        published: '{{ published }}'
        updated: '{{ updated }}'

  website_news:
    http:
      url: https://example.com/news
    deliveries:
      - local
    xquery:
      locate: //article
      feed:
        title: string(//title)
      entry:
        id: string(@data-id)
        title: string(.//h2)
        link: string(.//a/@href)
        description: string(.//p)

logging:
  level: info
  format: json
  sinks:
    console:
      type: console
```

下面逐块解释。

## 顶层配置

### `language`

可选的语言标签，要求符合 BCP 47，并会在校验阶段做规范化。

示例：

```yml
language: zh-CN
```

例如输入 `ZH-cn` 会在配置校验后规范化为 `zh-CN`。

### `timezone`

时区名称。用于日期字段格式化和日志时间。

示例：

```yml
timezone: Asia/Shanghai
```

如果不写，默认使用系统时区；再不行就回退到 `UTC`。

### `timestampFormat`

统一时间格式，使用 Luxon 的格式字符串。

默认值：

```yml
timestampFormat: yyyy-MM-dd HH:mm:ss
```

这个值会影响：

- feed / entry 默认日期字段的输出格式
- 结构化日志里的 `timestamp`

### `ai`

用于声明 AI provider / model 元数据，并在运行时为 `ai_translate` / `ai_summarize` 过滤器提供模型选择、预算与调用参数。

示例：

```yml
ai:
  defaultModel: openai_main/default
  providers:
    openai_main:
      type: openai
      apiKey: '${OPENAI_API_KEY}'
      baseURL: 'https://api.openai.com/v1'
      headers:
        X-Trace-Id: '${TRACE_ID}'
      options:
        organization: '${OPENAI_ORG_ID}'
        project: '${OPENAI_PROJECT_ID}'
      models:
        default:
          model: gpt-4o-mini
          temperature: 0.2
          variants:
            creative:
              temperature: 0.8
```

约束：

- `providers.<id>.type` 仅支持 `openai` / `anthropic` / `gemini`
- 共同字段收敛为 `type` / `apiKey` / `baseURL` / `headers` / `models` / `options`
- `openai.options` 仅支持 `organization` / `project`
- `anthropic.options` 仅支持 `authToken`，且不能与 `apiKey` 同时配置
- `gemini.options` 当前不支持任何 provider-specific 选项
- `models.<id>.model` 必须是静态字面量，不支持 `${ENV_VAR}` 或 Liquid
- `openai.models.<id>.options` / `openai.models.<id>.variants.<id>.options` 当前仅支持 `reasoningEffort` 与 `json`
- `anthropic` / `gemini` 的 `models.<id>.options` 与 `variants.<id>.options` 当前不支持；配置非空 options 会在配置期直接报错
- `variants.<id>` 只允许覆盖 `temperature` / `maxOutputTokens` / `options`
- `defaultModel` 可省略；省略时会按 provider 声明顺序与 model 声明顺序自动选择第一个模型
- model 引用支持 `providerId/modelId` 与裸 `modelId`；裸引用在跨 provider 重名时会直接报错

当前内置热门模型默认表只收敛 `context` 与 `maxOutputTokens`；未命中具体模型时回退到 provider 默认值。

---

## `sqlite` 配置

用于保存：

- 已投递记录（去重）
- 每个 source 最近抓取到的 feed 内容
- 每个 entry 的元数据和最近看到时间

### `sqlite.path`

SQLite 文件路径。

- 绝对路径：直接使用
- 相对路径：相对于 `runtimeDir`

示例：

```yml
sqlite:
  path: knock.db
```

默认值：

```yml
sqlite:
  path: knock.db
```

### `sqlite.busyTimeout`

SQLite busy timeout。

支持单位：

- `ms`
- `s`
- `m`
- `h`

示例：

```yml
sqlite:
  busyTimeout: 5s
```

默认值：`5s`

### `sqlite.journalMode`

可选值：

- `WAL`
- `DELETE`

默认值：`WAL`

### `sqlite.retention.maxAge`

保留多长时间的历史记录。

支持单位：

- `ms`
- `s`
- `m`
- `h`
- `d`

示例：

```yml
sqlite:
  retention:
    maxAge: 30d
```

默认值：`180d`

### `sqlite.retention.maxEntriesPerSource`

每个 source 最多保留多少条 entry 记录。

默认值：`1000`

### `sqlite.retention.vacuum`

可选值：

- `off`
- `afterPrune`

`afterPrune` 表示发生清理后自动执行 `VACUUM`。

默认值：`off`

---

---

## `logging` 配置

Knock 输出的是**结构化 JSON 日志**。

### `logging.level`

可选值：

- `trace`
- `debug`
- `info`
- `warn`
- `error`

默认值：`info`

### `logging.format`

当前只支持：

- `json`

### `logging.sinks.console.type`

当前只支持：

- `console`

示例：

```yml
logging:
  level: info
  format: json
  sinks:
    console:
      type: console
```

日志里会包含类似字段：

- `timestamp`
- `level`
- `component`
- `module`
- `operation`
- `outcome`
- `source_id`
- `run_id`
- `duration_ms`

其中 `component` 用于区分日志来源角色，当前会输出 `daemon` 或 `web`。

另外，日志会对 token、chat id、URL 中的敏感片段做脱敏。

---

## `deliveries` 配置

`deliveries` 是“投递方式定义区”。

每个 delivery 都有一个 ID，例如：

- `local`
- `webhook`
- `telegram_webhook`

source 通过 `sources.<id>.deliveries` 引用这些 delivery ID。

一个 delivery 只能配置一种投递目标（`file` / `push` / `email` 三选一）：

- `file`
- `push`（可配合 `http`）
- `email`（用于通用 SMTP 发信）

### 1) 文件投递：`deliveries.<id>.file`

示例：

```yml
deliveries:
  local:
    file:
      path: outputs/releases.md
      content: |
        ## [{{ title }}]({{ link }})

        {{ content | strip_html }}

        ---
```

字段说明：

#### `path`

输出文件路径。

- 绝对路径：直接写
- 相对路径：相对于 `runtimeDir`

#### `content`

写入内容模板。每次命中一个新
entry，就会把渲染结果**追加**到文件末尾，并额外加一个换行。

### 文件轮转：`rotation`

```yml
deliveries:
  local:
    file:
      path: outputs/releases.md
      content: |
        ## [{{ title }}]({{ link }})

        {{ content | strip_html }}

        ---
      rotation:
        enabled: true
        size: 10m
        age: 7d
        backups: 3
```

字段说明：

- `enabled`: 是否启用轮转
- `size`: 文件达到指定大小时轮转，支持 `b` `k` `m` `g`
- `age`: 文件达到指定年龄时轮转，支持 `ms` `s` `m` `h` `d`
- `backups`: 最多保留多少个轮转备份

轮转文件名格式类似：

```text
releases.20260402T110000123Z.md
```

如果 `enabled: true`，那么至少要配置 `size` 或 `age` 其中一个。

### 2) HTTP 投递：`deliveries.<id>.push`

HTTP delivery 分成两个块：

- `push.http`：HTTP 请求与传输层字段（`url` / `method` / `headers` /
  `timeout` / `proxy` / `retry`）
- `push.request`：负载编码字段（`type` / `payload`）

示例：

```yml
deliveries:
  webhook:
    push:
      http:
        method: POST
        url: '${WEBHOOK_URL}'
        timeout: 10s
        headers:
          Authorization: 'Bearer ${WEBHOOK_TOKEN}'
      request:
        type: body
        payload:
          text: '{{ entry.title }} => {{ entry.link }}'
      response:
        predicate: '{{ ok }}'
        message: 'webhook failed: {{ status }} {{ body }}'
```

#### `push.http.method`

可选值：

- `GET`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`
- `HEAD`

默认值：`POST`。

#### `push.http.url`

目标 URL。

#### `push.http.headers`

HTTP 请求头。

#### `push.http.timeout`

请求超时时间。当前实现会把它应用到 HTTP 客户端传输层。

#### `push.http.retry`

传输层重试配置。**未配置时默认禁用重试**。

字段：

- `limit`：重试次数，默认 `2`
- `statusCodes`：触发重试的 HTTP 状态码，默认 `[408, 429, 500, 502, 503, 504]`
- `retryOnTimeout`：超时是否重试，默认 `true`
- `backoffLimit`：退避上限，默认 `3s`

> [!NOTE]
> 这里的重试只覆盖 transport 失败（超时、网络异常、命中状态码）。
> `push.response.predicate` 判定失败不属于 transport retry。

#### `push.http.proxy`

可选，格式为 `protocol://url:port`，至少支持 `http://` 与 `socks5://`。

#### `push.request.type`

可选值：

- `query`：把 payload 编码到 query string
- `form`：`application/x-www-form-urlencoded`；对象与数组会先转成 JSON 字符串，再作为单个字段发送
- `body`：写进请求体；对象与数组会保留嵌套结构并整体 JSON 序列化

默认值：`body`。

#### `push.request.payload`

请求负载，可以是：

- 字符串
- 数字
- 布尔值
- `null`
- 数组
- 对象

`payload` 中的每个字符串值都会在运行时递归做 Liquid 渲染。

也就是说下面这些位置都可以写模板：

- 顶层字符串值
- 嵌套对象里的字符串值
- 数组里的字符串值

例如：

```yml
request:
  payload:
    text: '{{ entry.title }} => {{ entry.link }}'
    meta:
      source: '{{ source.id }}'
      note: '${WEBHOOK_TAG}: {{ entry.published }}'
      tags:
        - '{{ feed.title }}'
        - '${WEBHOOK_TAG}'
```

如果 `type: body`，上面的嵌套结构会作为 JSON 原样发送。

如果 `type: form`，则对象/数组值会先 JSON 序列化后再作为单个表单字段发送，例如 Telegram 的 `link_preview_options`、`reply_markup`。

如果同一个字符串里同时包含环境变量和 Liquid 模板，那么顺序是：

1. 加载配置时先展开 `${ENV_VAR}`
2. 实际投递前再渲染 `{{ liquid }}`

> [!IMPORTANT]
> `GET` 和 `HEAD` 不允许 `type: body` 且带 body payload。

#### `push.response.predicate`

可选。一个 Liquid 表达式，用来判断响应是否成功。

上下文来自 HTTP 响应对象，主要可用字段：

- `status`
- `ok`
- `headers`
- `body`

如果不写，默认规则就是 `response.ok`。

#### `push.response.message`

当判定失败时抛出的错误消息模板。

### 3) SMTP 邮件投递：`deliveries.<id>.email`

`deliveries.<id>.email` 用于通用 SMTP 发信，适合任何能提供 SMTP relay 的邮箱服务。

示例：

```yml
deliveries:
  release_email:
    email:
      smtp:
        host: '${SMTP_HOST}'
        port: 587
        security: starttls
        auth:
          username: '${SMTP_USERNAME}'
          password: '${SMTP_PASSWORD}'
      message:
        from: 'bot+{{ source.id }}@example.com'
        to:
          - 'team+{{ entry.id }}@example.com'
        subject: '[{{ source.id }}] {{ entry.title }}'
        text: |
          {{ entry.title }}
          {{ entry.link }}
        headers:
          X-Knock-Source: '{{ source.id }}'
```

#### `email.smtp.host`

SMTP 主机地址，支持 `${ENV_VAR}`。

#### `email.smtp.port`

SMTP 端口，必须是整数。

#### `email.smtp.security`

可选值：

- `implicit`
- `starttls`
- `none`

#### `email.smtp.auth`

可选认证块；若出现则 `username` 与 `password` 都必填，并支持 `${ENV_VAR}`。

#### `email.message.*`

第一版支持这些字段：

- `from`
- `to`
- `cc`
- `bcc`
- `replyTo`
- `subject`
- `text`
- `html`
- `headers`

其中：

- `from`、`to`、`subject` 必填
- `text` 与 `html` 至少配置一个
- `to` / `cc` / `bcc` / `replyTo` 统一为字符串数组
- 这些字段都支持 Liquid；若同一字符串里同时包含 `${ENV_VAR}` 与 Liquid，会先展开环境变量，再在投递前渲染 Liquid
- 地址字段在实际发送前还会做渲染后校验，明显非法的邮箱地址会直接失败，不会继续交给 SMTP 层

> [!TIP]
> 本地手工验证 SMTP 链路时，推荐把 `host` / `port` 指到 Mailpit 之类的本地 SMTP 捕获器；自动化测试主线仍应使用假 transporter 覆盖失败路径与参数映射。

### 4) Source HTTP transport：`sources.<id>.http`

`sources.<id>.http` 同时承载抓取地址与 transport 语义，字段边界为
`url` / `headers` / `timeout` / `proxy` / `retry`。

示例：

```yml
sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
      headers:
        User-Agent: knock-example
      timeout: 5s
      retry:
        limit: 2
        statusCodes: [408, 429, 500, 502, 503, 504]
        retryOnTimeout: true
        backoffLimit: 3s
      proxy: socks5://127.0.0.1:1080
```

#### `sources.<id>.http.proxy`

支持完整 proxy URL，格式：

`protocol://[username][:password]@host:port`

例如：

- `http://127.0.0.1:8080`
- `http://user:pass@127.0.0.1:8080`
- `socks5://127.0.0.1:1080`

### 6) Source Byparr transport：`sources.<id>.byparr`

`sources.<id>.byparr` 用于通过 Byparr 服务抓取渲染后的页面内容。

> [!IMPORTANT]
> `source` 抓取入口必须二选一：`http` 与 `byparr` 不能同时配置，也不能同时缺失。

字段：

- `endpoint`（可选，默认 `http://byparr:8191/v1`）
- `cmd`（可选，默认 `request.get`）
- `url`（必填）
- `maxTimeout`（可选，默认 `60s`）
- `proxy`（可选，格式同 `http.proxy`）

示例：

```yml
sources:
  website_news:
    byparr:
      endpoint: http://byparr:8191/v1
      cmd: request.get
      url: https://example.com/news
      maxTimeout: 60s
      proxy: http://user:pass@127.0.0.1:8080
    deliveries:
      - local
    xquery:
      locate: //article
      entry:
        id: string(@data-id)
        title: string(.//h2)
```

---

## `sources` 配置

`sources` 是“数据源定义区”。

每个 source 都有一个唯一 ID，例如：

- `deno`
- `github_releases`
- `nodeseek`

### 最小示例

```yml
sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      - local
```

### 完整示例

```yml
sources:
  deno:
    name: Deno releases
    enabled: true
    http:
      url: https://github.com/denoland/deno/releases.atom
      headers:
        User-Agent: knock-example
    schedule: '0 */30 * * * *'
    deliveries:
      - local
      - telegram_webhook
    filter: '{{ title | match_regex: "release", "i" }}'
    syndication:
      feed:
        title: '{{ title }}'
      entry:
        id: '{{ id }}'
        title: '{{ title }}'
        description: '{{ description }}'
```

字段说明：

### `name`

可读名称。可写可不写。

### `enabled`

是否启用。默认 `true`。

### `http.url`

抓取地址，必填。

### `byparr.url`

Byparr 抓取目标地址；当使用 `byparr` transport 时必填。

### `schedule`

cron 表达式。写了就会进入调度模式；不写就只在 `--immediate` 下运行。

### `deliveries`

一个字符串数组，填写 delivery ID。

例如：

```yml
deliveries:
  - local
  - telegram_webhook
```

### `filter`

Liquid 布尔表达式。渲染结果必须是字符串 `true` 或 `false`。

例如只保留标题包含 `release` 的条目：

```yml
filter: '{{ title | match_regex: "release", "i" }}'
```

如果返回的不是 `true/false`，程序会报错：

```text
filter 模板必须返回布尔值 true/false
```

### `http`

source 拉取请求本身的 HTTP 配置。

当前支持：

- `headers`
- `timeout`
- `proxy`

示例：

```yml
http:
  headers:
    Authorization: 'Bearer ${WEBHOOK_TOKEN}'
    User-Agent: knock-example
```

### `byparr`

通过 Byparr 服务抓取页面的配置块。

当前支持：

- `endpoint`
- `cmd`
- `url`
- `maxTimeout`
- `proxy`

> [!IMPORTANT]
> 每个 source 必须在 `http` 和 `byparr` 中二选一。

### `syndication`

显式声明该 source 使用 RSS / Atom / JSON Feed 解析器，并定义字段映射。

如果一个 source 既没写 `syndication`，也没写 `xquery`，Knock 会默认按：

```yml
syndication: {}
```

处理。

### `xquery`

显式声明该 source 使用 XQuery 解析器。

> [!IMPORTANT]
> 同一个 source **不能同时配置** `syndication` 和 `xquery`。

---

## Syndication 源详解

适用于：

- RSS
- Atom
- JSON Feed

Knock 会先自动识别数据格式，再按统一字段输出。

### 默认 feed 字段

- `title`
- `link`
- `description`
- `generator`
- `language`
- `published`

### 默认 entry 字段

- `id`
- `title`
- `link`
- `description`
- `content`
- `published`
- `updated`

### 默认回退规则

部分字段有回退逻辑：

- `content` 为空时，可能回退到 `description`
- `updated` 为空时，可能回退到 `published`
- 日期默认会按 `timezone + timestampFormat` 格式化

### 映射示例

```yml
sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    syndication:
      feed:
        title: '{{ title }}'
      entry:
        id: '{{ id }}'
        title: '{{ title }}'
        description: '{{ content | strip_html }}'
        content: '{{ content }}'
        updated: '{{ updated }}'
```

### 自定义字段

你也可以在映射里声明自定义字段，再让标准字段引用它：

```yml
entry:
  id: '{{ id }}'
  plain_summary: '{{ description | strip_html }}'
  description: '{{ plain_summary }}'
```

程序会自动解析依赖顺序；但如果你写成循环依赖，会直接报错：

```text
存在循环依赖
```

---

## XQuery 源详解

适用于：

- 页面没有 RSS/Atom/JSON Feed
- 你需要直接从 HTML/XML 中提取列表项

### 基本结构

```yml
sources:
  website:
    http:
      url: https://example.com/news
    deliveries:
      - local
    xquery:
      locate: //li
      entry:
        id: string(@data-id)
        title: string(a)
        link: string(a/@href)
        description: string(.//p)
```

### 字段说明

#### `locate`

定位条目节点的 XPath / XQuery 表达式。每匹配到一个节点，就执行一次 `entry` 提取。

`locate` 是可选的；省略时会以整个 document 作为上下文执行一次 `entry`。

#### `feed`

提取 feed 级字段，支持两种写法：

1. **对象映射**（`字段名 -> 表达式`）
2. **脚本字符串**（完整 XQuery 表达式，返回 map）

#### `entry`

提取 entry 级字段，支持两种写法：

1. **对象映射**（`字段名 -> 表达式`）
2. **脚本字符串**（完整 XQuery 表达式，返回 map）

无论哪种写法，最终都必须产出非空 `id`。

> 这里的 `entry` 是“单条记录提取结构”；运行时结果才是 `entries[]`。

#### `namespaces`

命名空间前缀映射，处理 XHTML/XML 时很有用。

注意：`namespaces` **仅对 `locate` 与对象映射写法生效**；脚本字符串模式不使用它。

示例：

```yml
xquery:
  locate: //xh:li
  namespaces:
    xh: http://www.w3.org/1999/xhtml
  entry:
    id: string(@data-id)
    title: string(xh:a)
```

脚本字符串示例：

```yml
xquery:
  locate: //li
  feed: |
    map {
      "title": string(//title)
    }
  entry: |
    map {
      "id": string(@data-id),
      "title": string(a)
    }
```

### 重要限制

XQuery 映射值就是**原生 XPath/XQuery 表达式**，不是 Liquid 模板。

也就是说下面这些旧前缀风格都不能用：

- `template:`
- `literal:`
- `xquery:`

### HTML 和 XML 的处理方式

- 文档看起来像 HTML（`<!doctype html>`、`<html>`）时，会按 HTML 解析
- 其他情况按 XML 解析
- XHTML 可配合 `namespaces` 正常提取（对象映射模式）

---

## 模板上下文

无论是 `filter` 还是 `delivery.content`，可用上下文都来自：

```ts
{
  ...entry,
  entry,
  feed,
  source,
}
```

也就是说这些写法都可以：

```liquid
{{ title }}
{{ entry.title }}
{{ feed.title }}
{{ source.id }}
```

通常你会在模板里用：

- `{{ title }}`
- `{{ link }}`
- `{{ content }}`
- `{{ feed.title }}`
- `{{ source.id }}`

---

## 自定义 Liquid 过滤器

项目内置了这些过滤器。

### `match_exact`

完全匹配。最后一个可选布尔参数可用于反转结果。

```liquid
{{ title | match_exact: 'Deno 2.0' }}
{{ title | match_exact: 'Deno 2.0', true }}
```

### `match_fuzzy`

模糊匹配。最后一个可选布尔参数可用于反转结果。

默认模式是 `both`，还支持：

- `left`：前缀匹配
- `right`：后缀匹配
- `both`：包含匹配

参数形式：

- `needle`
- `needle, true`
- `needle, mode`
- `needle, mode, true`

示例：

```liquid
{{ title | match_fuzzy: 'rc' }}
{{ title | match_fuzzy: 'rc', true }}
{{ title | match_fuzzy: 'Release', 'left' }}
{{ title | match_fuzzy: '.zip', 'right', true }}
```

### `match_regex`

正则匹配。最后一个可选布尔参数可用于反转结果。

```liquid
{{ title | match_regex: '^v\\d+\\.\\d+\\.\\d+$' }}
{{ title | match_regex: 'release', 'i' }}
{{ title | match_regex: 'release', true }}
{{ title | match_regex: 'release', 'i', true }}
```

### `strip_html`

去掉 HTML 标签并压缩空白。

```liquid
{{ content | strip_html }}
```

### `to_html`

把 Markdown 转成 HTML。

```liquid
{{ content | to_html }}
```

### `to_markdown`

把 HTML 转成 Markdown。

```liquid
{{ content | to_markdown }}
```

### `to_telegram_html`

把 HTML 清洗成 Telegram `parse_mode: HTML` 可接受的子集。

- 输入边界：HTML
- 输出目标：Telegram HTML
- 会保留受支持标签并清理危险标签/属性
- 不做自动格式探测

```liquid
{{ content | to_telegram_html }}
```

### `to_telegram_markdown_v2`

把 Markdown / 纯文本转成 Telegram `parse_mode: MarkdownV2` 可发送文本。

- 输入边界：Markdown / 纯文本
- 原始 HTML 不应直接传入；若来源是 HTML，先显式链式转换
- 安全发送优先于 Markdown 语义保真
- 不做自动格式探测，不支持 Markdown v1

```liquid
{{ content | to_markdown | to_telegram_markdown_v2 }}
```

### `ai_translate`

使用 AI 把输入文本翻译为目标语言。

- 仅支持异步渲染路径；同步渲染会直接报错
- 参数必须是字符串字面量
- 参数形式：
  - 无参数：使用 `ai.defaultModel` 与顶层 `language`
  - `language`
  - `model, language`
  - `model, variant, language`
- 长文本会按 provider 级保守预算自动分段；优先按段落切分，并带前 300 / 后 150 字符邻近上下文
- 分段翻译时只输出当前 chunk 的译文，不回写上下文内容
- 调用失败会直接抛错，不回退原文

```liquid
{{ content | ai_translate }}
{{ content | ai_translate: 'en' }}
{{ content | ai_translate: 'openai_main/default', 'creative', 'ja' }}
```

### `ai_summarize`

使用 AI 对输入文本做摘要。

- 仅支持异步渲染路径；同步渲染会直接报错
- 参数必须是字符串字面量
- 参数形式：
  - 无参数：使用 `ai.defaultModel`
  - `model`
  - `model, variant`
- 长文本会先分段摘要，再做一次总摘要汇总
- 调用失败会直接抛错，不静默吞错

```liquid
{{ content | ai_summarize }}
{{ content | ai_summarize: 'openai_main/default' }}
{{ content | ai_summarize: 'openai_main/default', 'creative' }}
```

---

## 去重与状态存储

Knock 的去重不是靠内存，而是落在 SQLite 里。

### `deliveries` 表

按这组键判断“这条 entry 是否已经发到这个投递项”：

- `source_id`
- `item_id`
- `target_id`（这里保存的是 `delivery.id`）

只要这组三元组已经标记成 delivered，同一 source 下再次跑到相同
entry，就不会重复投递。

### `feeds` 表

保存每个 source 最近一次抓取到的原始 payload、payload hash 和映射后的 feed
文本。

如果 payload hash 没变化，程序不会重复更新 feed 记录。

### `entries` 表

保存每个 source 下每个 entry 的：

- `entry_id`
- `entry_text`
- `first_seen_at`
- `last_seen_at`
- `updated_at`

如果 payload 没变化，程序仍然会刷新当前 entry 的 `last_seen_at`，方便 retention
清理。

---

## 典型配置示例

## 示例 1：把 GitHub Releases 追加到 Markdown 文件

```yml
sqlite:
  path: knock.db

deliveries:
  local:
    file:
      path: outputs/github-releases.md
      content: |
        ## [{{ title }}]({{ link }})

        {{ content | strip_html }}

        发布时间：{{ published }}

        ---

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    schedule: '0 */30 * * * *'
    deliveries:
      - local
```

## 示例 2：通过 push 直连 Telegram Bot API（HTML）

```yml
deliveries:
  telegram_webhook:
    push:
      http:
        method: POST
        url: 'https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage'
      request:
        type: body
        payload:
          chat_id: '${TELEGRAM_CHAT_ID}'
          parse_mode: 'HTML'
          text: |
            <b>{{ title }}</b>

            {{ content | to_telegram_html }}

            {{ link }}

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      - telegram_webhook
```

## 示例 3：通过 push 直连 Telegram Bot API（MarkdownV2）

当来源内容可能混有标题、正文、链接等多个字段时，推荐先用 Liquid 组装整段消息，再统一做一次 `to_markdown | to_telegram_markdown_v2`，避免逐字段转换后仍遗漏 MarkdownV2 特殊字符。

```yml
deliveries:
  telegram_webhook_md:
    push:
      http:
        method: POST
        url: 'https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage'
      request:
        type: body
        payload:
          chat_id: '${TELEGRAM_CHAT_ID}'
          parse_mode: 'MarkdownV2'
          text: |
            {% capture tg_text %}
            {{ title }}

            {{ content }}

            {{ link }}
            {% endcapture %}
            {{ tg_text | to_markdown | to_telegram_markdown_v2 }}

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      - telegram_webhook_md
```

## 示例 3：只推送标题里带 `release` 的版本

```yml
deliveries:
  local:
    file:
      path: outputs/release.md
      content: '{{ title }}'

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      - local
    filter: '{{ title | match_regex: "release", "i" }}'
```

## 示例 4：推送到 webhook

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
        message: 'webhook failed: {{ status }} {{ body }}'

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      - webhook
```

## 示例 5：从普通网页提取条目

```yml
deliveries:
  local:
    file:
      path: outputs/page-items.md
      content: |
        - [{{ title }}]({{ link }})

sources:
  page_news:
    http:
      url: https://example.com/news
    deliveries:
      - local
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

---

## 常用命令

### 类型检查

```bash
deno task check
```

### 代码格式化（Prettier）

```bash
deno task fmt
```

### 检查格式（Prettier）

```bash
deno task fmt:check
```

### lint

```bash
deno task lint
```

### 测试

开发迭代时优先运行受影响文件或目录的测试；仅当改动命中共享入口、测试基础设施、数据库基础设施、共享运行时边界，或影响面无法可靠枚举时，收尾前才需要运行一次 `deno task test` 全量测试。对影响面可枚举的局部改动，应先跑受影响文件/目录，再按直接调用边界补跑相邻验证。

```bash
deno task test
```

```bash
deno task test src/core/source_processor_test.ts
```

```bash
deno task test src/config
```

传入路径时会覆盖默认测试范围，不会继续运行 `src web` 全量测试。

已知慢测建议按分组触发：

```bash
deno task test src/main_test.ts src/core/app_test.ts
```

```bash
deno task test src/db/client_test.ts src/db/source_state_store_test.ts
```

```bash
deno task test src/sources/xquery_test.ts src/sources/source_runtime_test.ts src/web/xquery_playground_test.ts web/routes/api/xquery/evaluate_test.ts
```

当改动命中 app / db / xquery 共享边界，但又不足以要求全量测试时，优先运行对应慢测组，而不是直接退回 `deno task test`。

### 默认启动（web + daemon）

```bash
deno task start
```

### 仅启动 web

```bash
deno task web
```

### 仅启动 daemon

```bash
deno task daemon
```

### 一次性执行（daemon）

```bash
deno run --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-run src/main.ts --mode daemon --config runtime/config.yml --immediate
```

---

## 常见问题

### 1. 配置文件找不到

错误类似：

```text
配置文件不存在: /xxx/runtime/config.yml 或 /xxx/runtime/config.yaml
```

检查：

- 你传的 `--config` 路径是否正确
- `--runtime_dir` 是否指到了对的目录
- 当前目录下是否真的有 `runtime/config.yml`

### 2. 环境变量没传进去

错误类似：

```text
deliveries.telegram_webhook.push.http.url 引用了未定义环境变量: TELEGRAM_BOT_TOKEN
```

说明配置里用了 `${TELEGRAM_BOT_TOKEN}`，但当前进程环境里没有这个变量。

### 3. filter 报错

如果你写的是：

```yml
filter: '{{ title }}'
```

这会报错，因为 filter 必须返回 `true` 或 `false`。

正确写法应该像这样：

```yml
filter: '{{ title | match_regex: "release", "i" }}'
```

### 4. 通过 push 调 Telegram API 失败

先检查：

- `deliveries.<id>.push.http.url` 是否是正确的 Bot API 地址
- `${TELEGRAM_BOT_TOKEN}` / `${TELEGRAM_CHAT_ID}` 是否注入到了进程环境
- payload 里是否包含 `chat_id` / `text`
- 机器人是否已经被拉进目标群/频道，并有发言权限

### 5. HTTP webhook 返回成功码之外的状态

默认情况下，只要不是 `2xx`，就会失败。

如果你的接口有自己的成功语义，就用：

```yml
response:
  predicate: '{{ ok }}'
  message: 'webhook failed: {{ status }} {{ body }}'
```

自己定义判断逻辑和报错消息。

### 6. source 里 `http` 和 `byparr` 能一起配吗

不能。每个 source 抓取入口必须二选一：

- 配了 `http` 就不能再配 `byparr`
- 配了 `byparr` 就不能再配 `http`
- 两者都不配也会报错

### 7. 为什么文件里一直追加，而不是覆盖

这是当前 file delivery 的设计：**追加写入**。适合做日志流、汇总文件、归档文件。

如果你想做“始终只有一份最新快照”，需要改 delivery 逻辑，而不是靠现有配置实现。

---

## 生产使用建议

- 先用 `--immediate` 验证，再改成常驻调度
- SQLite、输出目录都放进持久化存储
- Telegram Bot Token、chat ID、webhook token 都通过进程环境注入（Telegram 场景使用 push 直连 Bot API）
- 对外部站点抓取时，必要时在 `sources.<id>.http.headers` 里带上 `User-Agent`
- 如果输出文件可能无限增长，给 file delivery 配 `rotation`
- 如果抓取页面不是标准 feed，优先做一个最小 XQuery 原型，先确认 `locate` 和
  `entry.id` 是稳定的

---

## 当前已知边界

这些不是使用错误，而是项目当前实现本身的边界：

- `logging.format` 当前只支持 `json`
- `logging.sinks.console.type` 当前只支持 `console`
- HTTP payload 里的模板值最终都会按字符串渲染结果写入请求；如果你需要更细粒度的类型控制，请在 webhook 接收端按约定解析
- file delivery 是追加写入，不支持覆盖模式

如果你准备长期用它，建议先从自己的真实 source 和真实 delivery
写一份最小配置；需要完整字段说明和参考写法时，再对照仓库根目录下的
`config.example.yml`，逐步加过滤、轮转、HTTP 回执判断这些细节。
