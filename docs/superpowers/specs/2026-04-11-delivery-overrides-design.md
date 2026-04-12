# Delivery Overrides 设计说明

## 背景

当前 `deliveries` 同时承载投递渠道配置与默认消息模板。真实使用场景里，发送配置需要复用，但不同 `source` 往往需要对默认消息做局部调整，例如：

- 某个 `source` 的 Telegram 文本需要额外翻译或格式处理
- 某个 `source` 的邮件收件人、标题、正文需要基于条目内容变化
- 文件投递通常只想覆写 `content`，不想重复 `path`

现状只能：

- 复制整段 `delivery`
- 或依赖 YAML 锚点

但 YAML 锚点在当前链路里只有浅合并，重新声明 `push:` 会覆盖整个 `push` 子树，因此无法可靠表达“复用 transport，只改消息模板”的需求。

## 目标

在保留顶层 `deliveries` 作为单一事实源的前提下，给 `source` 增加对默认 delivery 的局部覆写能力。

目标：

1. 保留全局 `deliveries` 复用能力
2. 允许 `source` 按 delivery id 局部覆写默认消息
3. 不允许 `source` 改 transport 层字段
4. 不引入新的顶层 `formats` / `channels` / `publishes` 概念
5. 直接采用 breaking 变更，不保留旧字符串数组 shape

非目标：

- 不支持 YAML 点路径键（如 `a.b.c: 1`）作为嵌套配置语法
- v1 不支持 `null` / 裸 `key:` 作为删除默认值语义
- v1 不支持旧字符串数组与新 keyed-map 双 shape 并存
- v1 不细分 email `message` 内部更小的 allowlist，先允许整个 `message` 子树覆写

## 最终配置模型

### 顶层 `deliveries`

保留现有顶层 `deliveries`，语义不变：

- 定义投递渠道
- 定义 transport / endpoint / auth
- 定义默认目标与默认消息模板

### `sources.<id>.deliveries`

将 `sources.<id>.deliveries` 从“字符串数组”改为“keyed map”。

- key：顶层 delivery id
- value：该 `source` 对该 delivery 的 override object

示例：

```yml
deliveries:
  local:
    file:
      path: rss.md
      content: |
        default content

  telegram:
    push:
      http:
        url: https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage
        method: POST
      request:
        type: body
        payload:
          chat_id: ${TELEGRAM_CHAT_ID}
          parse_mode: HTML
          text: |
            default text

  notify_email:
    email:
      smtp:
        host: ${SMTP_HOST}
        port: 587
        security: starttls
      message:
        from: bot@example.com
        to:
          - team@example.com
        headers:
          X-App: knock
        subject: default subject
        html: default html

sources:
  mihomo:
    deliveries:
      local: {}
      telegram:
        payload:
          text: |
            custom telegram text
      notify_email:
        message:
          to:
            - '{{ author.email }}'
          subject: '[作者通知] {{ title }}'
          html: |
            <h2>{{ title }}</h2>
```

## 覆写面定义

`source.deliveries.<deliveryId>` 不保留完整 delivery 内部层级，只暴露可覆写子树：

| delivery type | 顶层 canonical 字段                                                       | source override 可写字段 | source 禁写字段                    |
| ------------- | ------------------------------------------------------------------------- | ------------------------ | ---------------------------------- |
| `file`        | `file.path`, `file.content`, `file.rotation`                              | `content`                | `path`, `rotation`                 |
| `push`        | `push.http`, `push.request.type`, `push.request.payload`, `push.response` | `payload`                | `http`, `request.type`, `response` |
| `email`       | `email.smtp`, `email.message.*`                                           | `message`                | `smtp`                             |

其中 email v1 规则刻意保持简单：

- `message` 整个子树都允许 source 覆写
- 不再为 `headers` 单独维护额外 allowlist
- 后续若实践证明 `headers` 覆写会带来问题，再单独收紧

## 合并规则

delivery 默认值与 source override 的合并规则统一为：

- object：deep merge
- array：整数组替换
- scalar：直接替换

例子：

- `payload.link_preview_options`：deep merge
- `message.to` / `cc` / `bcc`：整体替换
- `subject` / `text` / `content`：直接替换

### v1 不支持删除语义

v1 明确不支持通过 `null` 删除默认值。

因此：

- `telegram: {}` 表示 no-op override
- `telegram:` 不合法
- `message.cc:` 不表示“删除默认 cc”，而是非法写法

如果未来确有需要，再单独引入显式删除语义。

## 顺序语义

`sources.<id>.deliveries` 虽然从数组改成 keyed map，但其声明顺序仍表示执行顺序。

也就是说，按 YAML 中 key 的书写顺序执行投递。

## 校验规则

新 schema 需要保证：

1. `sources.<id>.deliveries` 必须是 keyed map，不能再是字符串数组
2. key 必须引用已定义的顶层 delivery id
3. value 必须是 object
4. 空 override 只接受显式 `{}`
5. override shape 必须与对应 delivery 类型匹配
6. source 不允许触碰 transport 层字段
7. v1 不接受 `null` 作为删除语义

## 运行时解析

运行时解析步骤：

1. 解析顶层 `deliveries` 为 canonical delivery map
2. 遍历 `source.deliveries` 的 key 顺序
3. 找到对应 canonical delivery
4. 根据 delivery 类型取允许覆写的子树：
   - `file.content`
   - `push.request.payload`
   - `email.message`
5. 应用 merge 规则，得到 source-specific resolved delivery
6. 继续复用现有 delivery runtime 执行发送

这样可以把改动范围尽量限制在 config schema / resolve 层，而不是重写 delivery runtime 抽象。

## 迁移策略

本次变更为 breaking change。

旧写法：

```yml
sources:
  mihomo:
    deliveries:
      - local
      - telegram
```

新写法：

```yml
sources:
  mihomo:
    deliveries:
      local: {}
      telegram: {}
```

原则：

- 不保留双 shape
- 不保留兼容别名
- 文档与示例直接切到新写法

## 影响面

需要同步调整：

- `src/config/schema.ts`
- `src/config/resolve_config.ts`
- `src/config/types.ts`
- 相关 config / resolve / validate 测试
- `README.md`
- `config.example.yml`

## 风险与后续

### 已接受的 v1 简化

1. email `message` 整个子树都可覆写，规则最简单，但边界偏宽
2. 不支持删除默认值
3. keyed map 顺序依赖 YAML / JS 的插入顺序保持

### 后续可选收紧项

若实践中出现问题，可再考虑：

- 为 email `message` 增加更细 allowlist
- 引入显式删除语义
- 为 override 错误提供更细粒度报错
