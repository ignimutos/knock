# Knock

Knock 是一个基于 Bun + TypeScript 的订阅抓取与投递守护进程。

它按计划抓取 RSS / Atom / JSON Feed，或通过 XQuery 从 HTML/XML 提取条目；随后统一 feed 与 entry 字段，执行 Liquid 过滤与渲染，并将结果投递到 file、push(HTTP)、email(SMTP) 通道，同时把状态与去重信息写入 SQLite。

## 功能概览

- 输入能力：RSS / Atom / JSON Feed、XQuery 页面提取、summary 窗口汇总。
- Web `/config`：结构化 / JSON 双模式编辑；secret 字段不回显，未修改时保留原值；写操作要求同源请求。
- 配置文件更新后，daemon 会自动尝试热重载后续调度、source、delivery、AI 与 logging 行为；Web `/config` 保存也会触发当前 web 进程的本地 reload。
- 当前 `sqlite.*` 仍不支持热重载；修改后需要重启进程才能生效。
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
package.json                 Bun 运行 / 构建 / 验证脚本入口
tsconfig.json                Bun / TypeScript 类型检查配置
```

## 快速开始

### 1) 准备环境

```bash
bun --version
```

```bash
git clone <你的仓库地址> knock
cd knock
bun install
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
bun run daemon -- --config <your-config.yml> --immediate
```

### 5) 启动常驻模式

```bash
bun run start -- --config <your-config.yml>
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
10. Web `/config` 入口不会回显已保存的 secret；未修改 secret 时会保留原值。
11. Web `/config` 的写操作只接受同源请求，且通过 Web 编辑的文件路径必须保持为 runtime 内相对路径。

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

### 自定义 Liquid filters

自定义 Liquid filter 可用于 `sources.<id>.filter`、`sources.<id>.syndication.entry.*`、`deliveries.*` 等模板位点。下表先给出速查，后文再按使用场景展开每个 filter 的签名、参数、返回值、示例与常见报错。

| filter | 用途 | 参数概览 |
| --- | --- | --- |
| `match_exact` | 精确比较输入值与目标值 | `target`, `invert?` |
| `match_fuzzy` | 做包含/前缀/后缀匹配 | `needle`, `mode?`, `invert?` |
| `match_regex` | 用正则表达式匹配文本 | `pattern`, `flags?`, `invert?` |
| `extract_regex` | 提取正则命中或捕获组 | `pattern`, `flags?`, `group?` |
| `strip_html` | 去掉 HTML 标签并归一空白 | 无 |
| `to_html` | 把输入规范化为 HTML | 无 |
| `to_markdown` | 把输入规范化为 Markdown | 无 |
| `to_telegram_html` | 转成 Telegram HTML 可发送子集 | 无 |
| `to_telegram_markdown_v2` | 转成 Telegram MarkdownV2 可发送文本 | 无 |
| `ai_translate` | 调用 AI 翻译输入文本 | `model?`, `variant?`, `language?` |
| `ai_summarize` | 调用 AI 生成摘要 | `model?`, `variant?`, `language?`, `summary_length?`, `trigger_length?` |

#### 匹配 / 提取

适合 `sources.<id>.filter`、`if` 条件和“先抽值再比较”的模板逻辑。`match_*` 返回布尔结果，`extract_regex` 返回字符串结果。

##### `match_exact`

- **用途**：比较输入值与目标值字符串化后的结果是否完全一致。
- **签名**：`value | match_exact: target, invert?`
- **参数**：
  - `target`：必填；比较目标。
  - `invert`：可选布尔值；为 `true` 时反转结果。
- **返回值**：`boolean`；直接渲染时输出 `true` / `false`。
- **示例 1（最小）**：

  ```liquid
  {{ item.title | match_exact: 'Rust' }}
  ```

- **示例 2（组合）**：

  ```yml
  filter: "{% if title | match_exact: 'Go', true %}true{% else %}false{% endif %}"
  ```

- **常见报错**：`invert` 不是布尔值时会报错。

##### `match_fuzzy`

- **用途**：对输入文本做包含、前缀或后缀匹配。
- **签名**：
  - `value | match_fuzzy: needle`
  - `value | match_fuzzy: needle, mode`
  - `value | match_fuzzy: needle, invert`
  - `value | match_fuzzy: needle, mode, invert`
- **参数**：
  - `needle`：必填；待匹配文本。
  - `mode`：可选；`both`（默认，包含匹配）、`left`（前缀匹配）、`right`（后缀匹配）。
  - `invert`：可选布尔值；为 `true` 时反转结果。
- **返回值**：`boolean`；直接渲染时输出 `true` / `false`。
- **示例 1（最小）**：

  ```liquid
  {{ item.title | match_fuzzy: 'amp' }}
  ```

- **示例 2（组合）**：

  ```yml
  filter: "{% if title | match_fuzzy: 'Ex', 'left', true %}false{% else %}true{% endif %}"
  ```

- **常见报错**：
  - `mode` 不是 `both` / `left` / `right` 时会报错。
  - `invert` 不是布尔值时会报错。

##### `match_regex`

- **用途**：用正则表达式匹配输入文本。
- **签名**：`value | match_regex: pattern, flags?, invert?`
- **参数**：
  - `pattern`：必填；正则表达式字符串。
  - `flags`：可选；传给 JavaScript `RegExp` 的 flags，如 `i`。
  - `invert`：可选布尔值；为 `true` 时反转结果。省略 `flags` 时，第二个位置可以直接写 `invert`。
- **返回值**：`boolean`；直接渲染时输出 `true` / `false`。
- **示例 1（最小）**：

  ```liquid
  {{ item.title | match_regex: '^example$', 'i' }}
  ```

- **示例 2（组合）**：

  ```yml
  filter: "{% if title | match_regex: '^Ex', true %}false{% else %}true{% endif %}"
  ```

- **常见报错**：
  - `invert` 不是布尔值时会报错。
  - regex 非法时会报错。

##### `extract_regex`

- **用途**：提取正则命中内容或指定捕获组，适合先抽值再比较。
- **签名**：`value | extract_regex: pattern, flags?, group?`
- **参数**：
  - `pattern`：必填；正则表达式字符串。
  - `flags`：可选；传给 JavaScript `RegExp` 的 flags，如 `i`。
  - `group`：可选；非负整数。省略时：有捕获组则返回第一个捕获组，无捕获组则返回整个 match。省略 `flags` 时，第二个位置可以直接写 `group`。
- **返回值**：`string`；未匹配时返回空串。
- **示例 1（最小）**：

  ```liquid
  {{ item.title | extract_regex: '([0-9]+)(?=元)' }}
  ```

- **示例 2（组合）**：

  ```yml
  filter: "{% assign release = title | extract_regex: '(release) +([0-9]+)', 'i', 2 %}{% if release == '42' %}true{% else %}false{% endif %}"
  ```

- **常见报错**：
  - `group` 不是非负整数时会报错。
  - `group` 超出可用捕获组范围时会报错。
  - regex 非法时会报错。

#### 内容转换

适合把 HTML、Markdown 或混合文本转换成更稳定的下游输入，再继续做渲染、过滤或摘要。

##### `strip_html`

- **用途**：去掉 HTML 标签并把连续空白归一成单个空格。
- **签名**：`value | strip_html`
- **参数**：无。
- **返回值**：`string`。
- **示例 1（最小）**：

  ```liquid
  {{ item.content | strip_html }}
  ```

- **示例 2（组合）**：

  ```yml
  filter: "{% assign amount = entry.content | strip_html | extract_regex: '([0-9]+)(?=元)' %}{% if amount == '1999' %}true{% else %}false{% endif %}"
  ```

- **常见报错**：无。

##### `to_html`

- **用途**：把输入文本按当前 Markdown-to-HTML 规则转换为 HTML。
- **签名**：`value | to_html`
- **参数**：无。
- **返回值**：`string`。
- **示例 1（最小）**：

  ```liquid
  {{ item.content | to_html }}
  ```

- **示例 2（组合）**：

  ```yml
  message: "{{ entry.content | to_html | to_telegram_html }}"
  ```

- **常见报错**：传入任何额外参数时会报错。

##### `to_markdown`

- **用途**：把输入 HTML 按当前 HTML-to-Markdown 规则转换为 Markdown。
- **签名**：`value | to_markdown`
- **参数**：无。
- **返回值**：`string`。
- **示例 1（最小）**：

  ```liquid
  {{ item.content | to_markdown }}
  ```

- **示例 2（组合）**：

  ```yml
  message: "{{ entry.content | to_markdown | to_telegram_markdown_v2 }}"
  ```

- **常见报错**：传入任何额外参数时会报错。

#### Telegram

适合在 Telegram delivery 之前，把现有文本或 HTML 收敛到 Telegram 当前可发送的格式。

##### `to_telegram_html`

- **用途**：把输入收敛为 Telegram 当前可发送的 HTML 子集，并清理不被允许的标签、属性或危险内容。
- **签名**：`value | to_telegram_html`
- **参数**：无。
- **返回值**：`string`。
- **示例 1（最小）**：

  ```liquid
  {{ item.content | to_telegram_html }}
  ```

- **示例 2（组合）**：

  ```yml
  message: "{{ entry.content | to_html | to_telegram_html }}"
  ```

- **常见报错**：传入任何额外参数时会报错。
- **补充说明**：
  - 相对链接不会保留为 `<a>`，只保留可发送的文本内容。
  - `tg-emoji`、`blockquote expandable`、`<pre><code class="language-...">` 这类 Telegram 可接受写法会被保留或规范化。

##### `to_telegram_markdown_v2`

- **用途**：把输入文本转换为 Telegram MarkdownV2 可发送文本，并对特殊字符做必要转义。
- **签名**：`value | to_telegram_markdown_v2`
- **参数**：无。
- **返回值**：`string`。
- **示例 1（最小）**：

  ```liquid
  {{ item.content | to_telegram_markdown_v2 }}
  ```

- **示例 2（组合）**：

  ```yml
  message: "{{ entry.content | to_markdown | to_telegram_markdown_v2 }}"
  ```

- **常见报错**：传入任何额外参数时会报错。
- **补充说明**：
  - 纯文本中的 Telegram 特殊字符会被转义。
  - 已有的 Markdown / HTML 兼容语法会按当前转换器行为做规范化后输出。

#### AI

适合在 entry 级异步渲染上下文里调用已配置模型做翻译或摘要。模板命中 AI filter 时，配置校验阶段就要求能解析到可用模型。详细模型与 provider 配置见下方 `AI 配置` 一节。

##### `ai_translate`

- **用途**：调用已配置 AI 模型把输入文本翻译到目标语言。
- **签名**：
  - `value | ai_translate`
  - `value | ai_translate: model: '...', variant: '...', language: '...'`
- **参数**：
  - `model`：可选；模型引用。推荐直接写 `providerId/modelId`，例如 `openai_main/default`。
  - `variant`：可选；模型下已配置的 variant ID。
  - `language`：可选；目标语言。未传时使用顶层 `language` 默认值；两者都缺失时会报错。
- **返回值**：`string`。
- **前提**：
  - 需要可用的 `ai` 配置。
  - 需要 entry 级异步渲染上下文。
- **示例 1（最小）**：

  ```liquid
  {{ item.content | ai_translate }}
  ```

- **示例 2（组合）**：

  ```liquid
  {{ item.content | ai_translate: model: 'openai_main/default', variant: 'creative', language: 'ja' }}
  ```

- **常见报错**：
  - 未配置 `ai` 时无法使用。
  - 缺少 entry 级 AI runtime 时无法执行。
  - 在 sync 渲染中无法使用。
  - 只支持命名参数。
  - `model` / `variant` / `language` 必须是非空字符串字面量。
  - 未传 `language` 且顶层 `language` 默认值也缺失时会报错。

##### `ai_summarize`

- **用途**：调用已配置 AI 模型生成摘要。
- **签名**：
  - `value | ai_summarize`
  - `value | ai_summarize: model: '...', variant: '...', language: '...', summary_length: 80, trigger_length: 500`
- **参数**：
  - `model`：可选；模型引用。推荐直接写 `providerId/modelId`，例如 `openai_main/default`。
  - `variant`：可选；模型下已配置的 variant ID。
  - `language`：可选；目标摘要语言。未传时默认保持输入文本的主语言。
  - `summary_length`：可选；摘要长度约束。必须是正整数，或可解析为正整数的字符串字面量；未传时默认 200。
  - `trigger_length`：可选；触发摘要的输入阈值。必须是正整数，或可解析为正整数的字符串字面量；按原始输入字符串长度判断，只有输入长度 `>= trigger_length` 时才调用 AI；未传时保持现有行为，即始终摘要。
- **返回值**：`string`。
- **前提**：
  - 需要可用的 `ai` 配置。
  - 需要 entry 级异步渲染上下文。
- **示例 1（最小）**：

  ```liquid
  {{ item.content | ai_summarize }}
  ```

- **示例 2（组合）**：

  ```liquid
  {{ item.content | ai_summarize: model: 'openai_main/default', variant: 'creative', language: 'ja', summary_length: 80, trigger_length: 500 }}
  ```

- **常见报错**：
  - 未配置 `ai` 时无法使用。
  - 缺少 entry 级 AI runtime 时无法执行。
  - 在 sync 渲染中无法使用。
  - 只支持命名参数。
  - `model` / `variant` / `language` 必须是非空字符串字面量。
  - `summary_length` / `trigger_length` 必须是正整数，或可解析为正整数的字符串字面量。

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
- Reader：`/reader`，浏览最近快照，并提供 source 常用管理动作：保存少量高频配置、强制获取、清空该 source 历史。
- XQuery Playground：`/xquery`
- Syndication Playground：`/syndication`
- API：
  - `POST /api/xquery/evaluate`
  - `POST /api/syndication/evaluate`
  - `POST /api/sources/update`
  - `POST /api/sources/run`
  - `POST /api/sources/clear`

启动方式：

```bash
bun run src/main.ts --mode web
```

## 命令行用法

```bash
bun run src/main.ts \
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

## 本地二进制构建

```bash
bun run build:binary
```

产物输出到 `dist/knock-linux-x64`。该二进制保留现有 CLI 契约，可继续使用 `--mode all|web|daemon`。

## 容器部署

### 构建

```bash
bun run docker:build
```

默认产物标签是 `knock:local`；也可通过 `KNOCK_IMAGE_TAG` 覆盖：

```bash
KNOCK_IMAGE_TAG=knock:dev bun run docker:build
```

### 本地镜像验证

```bash
bun run docker:size:check
```

### 运行

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "<宿主机持久化目录>:/app/runtime" \
  -e WEBHOOK_URL=https://example.com/webhook \
  -e WEBHOOK_TOKEN=xxx \
  knock:local
```

将宿主机持久化目录挂载到容器内默认运行目录 `/app/runtime`，并通过容器环境变量注入密钥与令牌。镜像内置 `KNOCK_RUNTIME_DIR=/app/runtime`，因此默认会读取 `/app/runtime/config.yml`（若不存在再回退到 `/app/runtime/config.yaml`）。镜像默认入口现为 `/app/knock-linux-x64`，内部仍复用 `src/container_entrypoint.ts` 的参数归一化语义：默认保留项目 CLI 的 `all` 模式，并按需从 `KNOCK_CONFIG_PATH`、`KNOCK_WEB_HOST`、`KNOCK_WEB_PORT`、`KNOCK_IMMEDIATE` 注入缺省参数；若同时传入显式 CLI 参数，CLI 仍优先于这些容器环境变量。运行镜像不再携带 `src/`、`web/`、完整 `node_modules/` 或 `.web-dist/`；当前仅保留二进制运行时需要的 `jsdom`、`css-tree`、`mdn-data` 资产目录。若挂载宿主机 runtime 目录，Linux 下应保证该目录对容器进程可写；最直接的做法是显式传 `--user "$(id -u):$(id -g)"`，例如 `docker run --rm -e KNOCK_WEB_PORT=8000 knock:local --web_port 9000`。

CI 已收敛为 `verify` → `image` → `publish` 三层：先跑 `bun run verify:full`、`bun run build:binary`、`bun run smoke:binary`，再构建、smoke 与体积检查镜像，最后仅在 `main` 发布 Docker Hub 并同步 `docker/README.md`。

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

## 开发验证

常用本地验证入口：

- `bun run test`
- `bun run check`
- `bun run fmt:check`
- `bun run lint:check`
- `bun run test:arch`：校验 `docs/testing/risk-matrix.yml` 与真实测试映射、分层和风险 ID 是否一致。
- `bun run test:startup`：校验配置解析、CLI、主入口、容器入口与 Web 入口的启动契约。
- `bun run verify:full`：串起 build、check、startup/arch tests 与全量测试。
- `bun run build:binary`：生成 `dist/knock-linux-x64` 单文件二进制。
- `bun run smoke:binary`：对二进制跑 `daemon` / `web` / `all` 三条最小 smoke。
- `bun run smoke:image`：对本地 Docker 镜像跑 `/config` 与 `/assets/client.js` smoke。
- `bun run measure:cold-start`：对 baseline/candidate 镜像做 cold-start 中位数比较，例如 `BASE_IMAGE=knock:baseline CANDIDATE_IMAGE=knock:local bun run measure:cold-start`。
- `bun run test:path -- <paths>`：按路径运行测试子集。
- `bun run lint:check:path -- <paths>`：按路径运行 lint 子集。
- `bun run fmt:check:path -- <paths>`：按路径运行 Prettier 检查子集。
- `bun run check`：当前仍为项目级 TypeScript 基线验证，不支持按路径切片。

当前 CI / 本地发布前门禁会依次执行 `build:web`、`check`、`test:arch`、`test:startup`、`test`、`build:binary`、`smoke:binary`，然后再做 Docker build、镜像 smoke 与镜像体积检查。

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
