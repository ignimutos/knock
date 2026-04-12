# `summary` Source Design Spec

## 摘要

本设计新增一种 `summary` source 类型，用于按自身 `schedule` 周期性汇总指定上游 sources 在最近一个已处理窗口内的 feed / entries，并产出 1 条统一 summary entry，继续复用现有 `filter`、delivery、去重与状态存储链路。第一版严格收缩配置与模板上下文：上游来源仅配置为 source id 数组；模板上下文仅暴露当前 summary source、自身运行窗口与各上游 source 的 `name` / `feed` / `entries`；AI 只允许在用户模板中显式调用，不引入隐式额外 AI 步骤。

窗口推进不再依赖 cron 反推上一个计划点，而是复用 summary source 自身上一次成功写入的 feed 记录时间作为 checkpoint；`schedule` 只负责决定何时触发，不负责定义历史前界，因此在 `schedule` 变更后，窗口仍按 summary 自身的成功 checkpoint 稳定前进。窗口选取依据为上游 entries 的 `last_seen_at`，内容读取为当前数据库里的最新 feed / entry 快照；这意味着历史窗口允许漂移，且同一上游 entry 可以在后续窗口重复进入摘要。

## 背景与问题

当前仓库的 source 都是“抓取并解析外部输入，再产出统一 `feed` + `entries`”的形态。用户当前需要一种新的 source：它不直接抓外部输入，而是消费仓库自己已经持久化的上游 source 状态，定时生成“日报 / 小时报”式摘要，且摘要内容尽量由模板控制，必要时显式调用内置 AI 完成总结。

在讨论过程中，几个关键约束被确认：

1. summary source 自身也应继续是普通 source，最终仍产出统一 entry，继续走现有 deliveries。
2. 不额外开放过多模板上下文与配置面，第一版先做最小可用集合。
3. `schedule` 可能会被修改，因此窗口前界不能只靠当前 cron 表达式回推。
4. 按 RSS 规范思路，条目身份并不因更新而变化；但用户最终选择对 summary 的取窗规则按“最新消费时间”处理，即允许同一 entry 在后续窗口重复进入摘要。
5. 第一版接受历史窗口漂移，不为此新增事件表或完整历史索引。

因此，本次设计核心不是“再加一个 parser”，而是：在不破坏现有 source / delivery 主链路的前提下，引入一种基于现有状态库工作的汇总型 source，并把其窗口推进、上下文暴露、默认 entry 生成、跳过条件与日志行为收敛成明确契约。

## 目标

1. 新增 `summary` source 类型，并与现有抓取型 source 互斥。
2. summary source 必须配置 `schedule`。
3. summary source 每次最多产出 1 条统一 summary entry。
4. 最终 summary entry 继续复用现有 `filter`、delivery、dedupe 与状态存储链路。
5. 第一版上游来源配置仅支持 source id 数组，不支持 alias / weight / 自动发现。
6. 模板上下文仅暴露最小需要的数据：当前 summary source、自身窗口、各上游 source 的 `name` / `feed` / `entries`。
7. AI 调用只允许在用户模板中显式发生；系统不隐式再调用一次 AI。
8. 第一次运行、空窗口、部分上游缺失等行为都要有明确日志与 checkpoint 语义。

## 非目标

1. 不新增第二套独立调度系统；仍复用现有 source 调度入口。
2. 不支持 `summary.sources` 自动发现、标签筛选、通配符等能力。
3. 不暴露上游 source 的完整配置对象到模板上下文。
4. 不暴露上游 entry / feed 的数据库 runtime 时间元数据到模板上下文。
5. 不为第一版新增“entry seen event”历史事件表。
6. 不做同窗口内容变化自动重投的特殊去重语义。
7. 不增加 alias、weight、stats、sourceIds、summary 顶层富结构等扩展面。
8. 不把 `feed` / `entry` 生成做成“模板返回任意对象”的新契约；仅支持对象字段映射覆写。

## 已确认决策

### 1. source 形态与互斥关系

新 source 采用 `summary` 配置块，与现有抓取型 source 互斥：

- 普通 source：`http/byparr` + `syndication/xquery`
- summary source：`summary`

一个 source 不能同时既是抓取型 source，又是 summary source。summary source 不直接抓外部输入，而是从数据库中读取上游 source 当前状态。

### 2. `schedule` 为 summary source 必填

普通 source 仍可没有 `schedule`，并只在 `--immediate` 时执行；但 summary source 的窗口推进与 checkpoint 都依赖周期性触发，因此 `schedule` 为 summary source 的必填项。缺失时应在配置校验阶段直接报错，而不是运行时半残废跳过。

### 3. 窗口前界来源：summary 自身 checkpoint

summary source 的窗口不再依赖“当前 cron 表达式反推出上一个计划点”。原因是 `schedule` 允许改变；若只依赖当前 cron 回推，窗口前界会随表达式变化而重算，导致重叠或空洞。

因此本设计改为：

- 窗口后界：本次触发对应的 `scheduledAt`
- 窗口前界：summary source 自身上一次成功写入的 feed 记录时间

也即，对 summary source，自身 `feeds.updated_at / fetched_at` 直接作为上一次成功 checkpoint 使用；该 checkpoint 语义等同于“上一次成功处理完成时记录下来的 `scheduledAt`”。`schedule` 只负责决定“何时触发”，不再负责定义历史前界。

### 4. 第一次运行：跳过，但写 checkpoint

首次运行时，summary source 尚无自身历史 feed 记录，因此无法形成有效窗口。此时行为为：

- 不产出 summary entry
- 写入一条 summary source 自身的 feed 状态，用当前 `scheduledAt` 作为 checkpoint
- 记录详细日志，说明缺少 previous checkpoint

这样第二次开始即可用“上次 checkpoint -> 本次 scheduledAt”形成正常窗口。

### 5. 空窗口也推进 checkpoint

如果本次 summary 窗口内，上游 source 全部未命中任何 entries，则：

- 不产出 entry
- 仍写 summary source 自身的 feed/checkpoint
- 明确记录跳过原因日志

原因是 checkpoint 代表“该窗口已经处理过”，而不代表“该窗口一定产出过摘要”。若空窗口不推进 checkpoint，后续会反复重算同一空区间。

### 6. 窗口选取规则：按 `last_seen_at`

用户最终确认：summary 的窗口归属按最新消费时间处理，不按首次消费时间处理。因此每个上游 source 的候选 entries 选取条件为：

- `entries.last_seen_at` 落在 `(previousCheckpoint, scheduledAt]`

这意味着：

- 同一 entry 后续再次被消费到，可以重新进入新窗口摘要
- 跨窗口重复是允许且预期的
- 历史窗口漂移是接受的

### 7. 内容读取规则：取最新快照

对窗口中命中的 entries，summary source 不需要回看某个历史版本，而是直接读取数据库中当前最新的 `entry_text`。上游 source 的 `feed` 也读取当前最新 `feed_text`。因此 summary 的语义是：

- 窗口决定“哪些 entry 被纳入摘要”
- 数据库当前快照决定“这些 entry 以什么内容呈现给模板 / AI”

### 8. 历史窗口漂移：接受

由于窗口按 `last_seen_at` 选取，而数据库只保留当前快照，若后续再次消费到旧 entry，其 `last_seen_at` 会被刷新。重新回看旧窗口时，该 entry 可能从旧窗口移出或在新窗口出现。第一版明确接受这一漂移，不为此新增事件表或不可变历史快照模型。

### 9. 上游来源配置最小化

`summary.sources` 第一版仅支持 source id 数组：

```yml
summary:
  sources:
    - deno
    - website_news
```

不支持：

- alias
- weight
- keyed map override
- 自动发现
- 标签筛选

### 10. 模板上下文最小化

模板上下文第一版只暴露：

- `source`：当前 summary source 自身上下文
- `source.runtime.window.*`：当前 summary source 本次窗口运行态
- `feed`：当前 summary source 最终输出 feed（带默认值，可被模板覆写）
- `entry`：当前 summary source 最终输出 entry（带默认值，可被模板覆写）
- `sources.<id>.name`
- `sources.<id>.feed`
- `sources.<id>.entries`

明确不暴露：

- `summary` 顶层富结构
- `sources.<id>.source`
- `sources.<id>.stats`
- `sources.<id>.alias`
- `sources.<id>.weight`
- 上游 feed / entries 的 DB runtime 时间元数据
- 遍历专用辅助数组（如 `sourceIds`）

### 11. `sources` 运行时 shape

配置里的 `summary.sources` 虽然是数组，但运行时上下文中的 `sources` 为 keyed map，key 即 source id。第一版只承诺按 key 访问，如：

- `sources.deno.name`
- `sources.deno.feed.title`
- `sources.deno.entries`

对象遍历如果 Liquid 恰好可用，算 bonus；但不写入正式契约。

### 12. 上游 source 暴露字段

每个 `sources.<id>` 只暴露：

- `name`：上游 source 的 `name`（其自身已有默认回退逻辑）
- `feed`：该上游 source 当前最新统一 feed 对象
- `entries`：当前窗口命中的统一 entry 数组

不额外暴露配置对象、headers、鉴权、DB 字段、统计字段等。

### 13. `feed` / `entry` 默认值与覆写方式

summary source 仍需生成统一 `feed` / `entry`。第一版规则：

- 系统先生成 deterministic 默认值
- 用户可通过 `summary.feed` / `summary.entry` 做字段级对象映射覆写
- 这些字段映射模板可访问 `source` / `sources` / `feed` / `entry` 上下文
- AI 如需参与，只能在这些模板里显式调用
- 系统不隐式再跑一次 AI

默认值如下。

#### 默认 `feed`

- `title`: 当前 summary source 的 `source.name`
- `description`: `''`
- `generator`: `knock.summary`
- `language`: 顶层 `language`
- `published`: 当前 `scheduledAt`

#### 默认 `entry`

- `id`: 绑定当前窗口的稳定 id
- `title`: 当前 summary source 的 `source.name`
- `link`: `''`
- `description`: `''`
- `content`: `''`
- `published`: 当前 `scheduledAt`
- `updated`: 当前 `scheduledAt`

### 14. summary entry id 仅绑定窗口

第一版 summary entry 的身份不绑定输入 entries 集合，也不绑定输入内容指纹，而只绑定 summary source 自己的窗口：

```text
<summary-source-id>:<previousCheckpoint>..<scheduledAt>
```

原因：

- 第一版已经接受窗口漂移与跨窗口重复
- 若把输入集合或内容指纹拼进 id，会让同窗口重跑更容易产生重复投递
- 当前仓库 dedupe 语义本来就是按 `sourceId + itemId(entry.id) + deliveryId` 去重

因此第一版合同是：同一窗口只有一个 summary entry 身份；内容即使变化，也不会因为同窗口重跑而自动变成新 item。

### 15. 最终 summary entry 继续走现有 `filter`

summary source 最终生成统一 `feed` / `entry` 后，仍继续走现有 source `filter`。不新增 `summary.filter`。这样用户仍可根据最终 summary 文本是否为空、是否命中关键词等现有逻辑决定是否投递。

### 16. 空内容不额外拦截

只要最终统一 entry 仍满足当前链路的最小合法性要求，就允许进入现有流程；第一版不额外要求 `title` / `content` / `description` 至少一个非空。若用户不希望发送空摘要，应通过模板与现有 `filter` 自己控制。

## 配置草案

```yml
sources:
  daily_summary:
    name: 每日摘要
    schedule: '0 0 9 * * *'
    summary:
      sources:
        - deno
        - website_news
      feed:
        title: '{{ source.name }}'
      entry:
        title: '{{ source.name }}'
        content: |
          Deno:
          {% for entry in sources.deno.entries %}
          - {{ entry.title }}
          {% endfor %}

          Website:
          {% for entry in sources.website_news.entries %}
          - {{ entry.title }}
          {% endfor %}

          {{ entry.content | ai_summarize: length: 300 }}
```

注：对象遍历不是第一版正式契约，因此示例只展示按固定 source id 访问。

## 数据流

1. summary source 被 scheduler 触发，得到本次 `scheduledAt`。
2. 读取 summary source 自身的 feed 记录，取其中 `updated_at/fetched_at` 作为 previous checkpoint；其值代表上一次成功处理完成时记录下来的 `scheduledAt`。
3. 若无 previous checkpoint：
   - 记录“首次运行 / 缺少 checkpoint”日志
   - 写 summary source 自身 feed 状态
   - 停止，不产出 entry
4. 对 `summary.sources` 中每个上游 source：
   - 读取该 source 当前 feed 快照
   - 查询 `entries.last_seen_at` 落在窗口内的 entries
   - 读取这些 entries 当前最新 entry 快照
5. 生成模板上下文：
   - `source`
   - `source.runtime.window.previousCheckpoint`
   - `source.runtime.window.scheduledAt`
   - `feed`
   - `entry`
   - `sources.<id>.name/feed/entries`
6. 应用默认 `feed` / `entry`，再按用户配置字段级覆写。
7. 对最终 summary entry 运行现有 `filter`。
8. 若 filter 通过，则继续走现有 delivery / dedupe / prune 流程。
9. 无论是否产出 entry，只要本次窗口已正常处理完成，都写 summary source 自身 feed/checkpoint。

## 错误处理与日志

### 跳过类情况

以下情况属于跳过，不属于 source 执行失败：

1. 首次运行，无 previous checkpoint
2. 所有上游 source 都未命中任何 entries
3. 所有上游 source 都缺少可用状态

这些情况都必须记录明确 reason，并在需要时推进 checkpoint。

推荐 reason：

- `summary.previous_checkpoint_missing`
- `summary.no_window_entries`
- `summary.upstream_state_missing`

### 降级类情况

若部分上游 source 状态缺失或读取失败：

- 记录 `warn`
- 继续处理其余上游 source
- 若最终仍有可用输入，则继续产出摘要

### 失败类情况

以下情况属于当前 summary source 执行失败：

- summary 配置非法
- 生成最终 `feed` / `entry` 的模板渲染失败
- 显式 AI 调用失败
- 后续 delivery 执行失败（沿用现有链路语义）

失败路径必须可见，不静默吞错。

## 验证策略

### 配置 / resolve

至少补以下测试：

1. `summary` source 与抓取型 source 互斥
2. `summary` source 缺失 `schedule` 应报错
3. `summary.sources` 必须是 source id 数组
4. `summary.sources` 引用未定义 source 应报错
5. `summary.feed` / `summary.entry` 字段级对象映射通过 resolve

### 运行时

至少补以下测试：

1. 首次运行无 checkpoint，应跳过且写 checkpoint
2. 空窗口无 entries，应跳过且推进 checkpoint
3. 上游部分缺失，应 warn 并继续
4. 上游全部缺失，应跳过并推进 checkpoint
5. 按 `last_seen_at` 命中 entries
6. `sources.<id>.name/feed/entries` 模板可访问
7. `source.runtime.window.previousCheckpoint/scheduledAt` 模板可访问
8. 默认 `feed` / `entry` 生成正确
9. `entry.id` 与窗口绑定正确
10. 同窗口重跑不会因相同 `entry.id` 触发重复投递
11. 跨窗口运行生成不同 summary entry id

### 共享边界验证

本设计会触达 `src/config/*`、`src/core/app.ts`、`src/core/source_processor.ts`、`src/db/*` 等共享边界。若最终实现确实改动这些区域，除 scoped `fmt/check/lint/test` 外，收尾前还需按仓库规则补一次全量 `deno task test`。

## 风险与权衡

### 1. 历史窗口漂移

使用 `last_seen_at` + 当前最新快照，且不额外持久化事件表，意味着历史窗口不是不可变快照。重新执行旧窗口时，输入集合可能变化。第一版接受该 trade-off，以换取更小实现面。

### 2. `schedule` 改动后的窗口语义

窗口前界取自 summary 自身 checkpoint，而非当前 cron 回推，因此 `schedule` 改动不会重算旧边界。这提升了稳定性，但也意味着“现在的 cron 形状”和“当前增量窗口大小”可能暂时不完全一致；这是有意为之。

### 3. 同窗口内容变化不自动重投

summary entry id 只绑定窗口，不绑定输入指纹；因此同窗口重跑导致内容变化时，默认不会自动重复投递。这与当前仓库普通 source 的 dedupe 语义保持一致，是第一版刻意保守的选择。

### 4. 模板上下文刻意收缩

第一版不暴露 alias、weight、stats、DB runtime 时间与完整 source 配置对象，会牺牲一部分高级定制能力；但这能显著降低 schema、resolve、模板上下文和安全边界的复杂度，符合当前任务目标。
