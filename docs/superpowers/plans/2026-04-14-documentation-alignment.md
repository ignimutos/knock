# Documentation Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `CLAUDE.md`、`README.md`、`config.example.yml` 全部与当前代码实现对齐，并把配置说明补齐到可以直接作为仓库权威参考的程度。

**Architecture:** 这次改动只修改三份文档与示例配置，代码实现保持原样。执行时以 `deno.json`、`src/main.ts`、`src/config/schema.ts`、`src/config/resolve_config.ts`、`src/config/capabilities.ts`、`src/sources/summary.ts` 和现有配置测试为单一事实源，先收敛 `CLAUDE.md` 的仓库契约，再重构 `README.md` 的读者路径，最后增强 `config.example.yml` 的字段注释与互斥说明。

**Tech Stack:** Markdown、YAML、Deno task、TypeScript 配置 schema 与配置测试。

---

## Scope Check

本计划覆盖单一子系统：仓库文档与参考配置对齐。改动集中在三份文档文件，验收依赖现有配置测试，不涉及业务逻辑与运行时代码修改。

## File Structure

### Modify

- `CLAUDE.md` — agent 执行规则与仓库契约；删除过时 workflow 说明，保留当前有效、可验证的规则。
- `README.md` — 用户主文档；全中文，按“快速开始 → 配置设计原则 → 完整键索引 → 常用组合 → Playground/CLI/Docker/日志/状态存储/FAQ”组织。
- `config.example.yml` — 仓库内完整参考配置；为顶层键、AI、delivery、source、summary、parser、logging 补齐高密度注释。

### Check While Editing

- `deno.json` — task 基线与真实命令集合。
- `src/main.ts` — `--mode` 默认值、`--config` / `--runtime_dir` 语义。
- `src/config/schema.ts` — one-of、互斥关系、字段边界。
- `src/config/resolve_config.ts` — 默认行为、merge 语义、parser 默认值。
- `src/config/capabilities.ts` — `${ENV_VAR}`、Liquid、AI provider 约束。
- `src/sources/summary.ts` — summary source 行为边界。
- `src/config/config_example_test.ts` — `config.example.yml` 契约锚点。
- `src/config/validate_config_test.ts` — 配置校验边界。

### Test

- `src/config/config_example_test.ts`
- `src/config/validate_config_test.ts`

---

### Task 1: 收敛 `CLAUDE.md` 为当前有效契约

**Files:**

- Modify: `CLAUDE.md`
- Check: `deno.json`
- Check: `src/main.ts`
- Check: `src/config/schema.ts`

- [ ] **Step 1: 重写项目快照、架构地图与命令清单**

把 `CLAUDE.md` 的开头部分替换成下面这组目标内容，确保术语与 `deno.json` / 当前目录结构一致：

```md
## Project snapshot

- Knock 是 Deno + TypeScript 应用：抓取 syndication feed 或网页内容，统一 feed / entry 字段，经过 Liquid 渲染后投递到 `file`、`push`、`email` 三类 delivery，并用 SQLite 保存状态与去重信息。
- source 当前包含两类：fetch source 与 summary source。fetch source 的 transport 为 `http` / `byparr` 二选一，parser 为 `syndication` / `xquery` 二选一。
- Entry: `src/main.ts`；完整参考配置：`config.example.yml`；任务入口以 `deno.json` 为准。

## Repository map

- `src/main.ts` - CLI 入口与启动参数解析
- `src/application/` - use case 与 stage 编排
- `src/domain/` - source / delivery / run 等核心模型
- `src/interfaces/` - daemon / web / config 装配入口
- `src/infrastructure/` - sqlite / source / delivery 适配器
- `src/config/` - 配置 schema、解析、默认行为与能力约束
- `src/sources/` - syndication / xquery / summary 实现
- `src/deliveries/` - file / http(push) / email 投递器

## Common commands (`deno.json`)

- `deno task start` - 启动 web + daemon（默认 `--mode all`）
- `deno task web` - 仅启动 web
- `deno task daemon` - 仅启动 daemon
- `deno task check` - 类型检查；传入文件/目录时仅检查对应范围
- `deno task fmt` / `deno task fmt:check` - 格式化 / 格式校验
- `deno task lint` / `deno task lint:check` - lint 修复 / lint 校验
- `deno task test` - 测试；传入文件/目录时仅运行对应范围
- 当标准 task 存在时，agents MUST 优先使用 task。
```

- [ ] **Step 2: 删除 workflow 与流程性弱规则，保留硬边界**

删除整个 `## Worktree policy` 章节，并把 `Execution rules` 收敛成下面这种风格：

```md
## Execution rules

- 修改前 MUST 先读目标模块及相邻上下文；行为改动前 MUST 先读相邻测试。
- 非平凡任务（多文件、接口/状态变化、重构）MUST 先有简短计划（目标 / 实现 / 验证）。
- MUST 保持原子变更，MUST 避免混入无关清理。
- 如前提缺失、假设失效或验证失败，MUST 停止并重新规划；必要时报告 `BLOCKED: <reason>`。
- 只有真实阻塞、高风险共享状态操作、或真实方案分叉时，MAY 请求用户参与。
- 实现取舍优先级 SHOULD 为：correctness → direct path to target structure → single source of truth → smallest complete fix → root-cause repair → maintainability。
```

- [ ] **Step 3: 收敛命名/注释/验证/CI 章节**

把尾部规则改成下面这组要点，保留可验证约束，删掉流程性噪音：

```md
## Naming, comments, observability, dependencies

- 同一概念在 config / types / tests / docs / CLI / error 中 MUST 使用稳定术语。
- 运行时流程、重试、过滤、降级、投递改动时，MUST 保持或提升可观测性。
- 自然语言注释 MUST 使用中文。
- TODO / FIXME 仅在真实延期时保留，并写明延期原因与移除条件。
- 新增依赖优先级 SHOULD 为：原生 JS/TS API → `@std/*` → `remeda` → 领域库。
- 新的不可信结构化输入边界 SHOULD 在边界处一次性用 `zod` 校验。

## Verification and review

- Docs-only changes MUST 校验提到的路径与命令真实存在，并明确报告未运行项。
- Code changes MUST 先跑最窄相关验证，必要时扩大到关联测试或全量 `deno task test`。
- 最终交付 SHOULD 说明：改了什么、通过了哪些验证、哪些未运行、剩余风险或后续事项。

## CI reality

- 当前工作流文件：`.github/workflows/docker.yml`
- 当前 CI 主要执行 Docker build / push。
- 本地验证基线仍以仓库文档中的 task 与测试要求为准。
```

- [ ] **Step 4: 运行文档格式检查**

Run: `deno task fmt:check CLAUDE.md`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: align CLAUDE instructions with current code"
```

---

### Task 2: 重写 `README.md` 的首页、快速开始与主干结构

**Files:**

- Modify: `README.md`
- Check: `deno.json`
- Check: `src/main.ts`
- Check: `src/config/schema.ts`

- [ ] **Step 1: 重写简介、能力概览与架构概览**

把 README 开头收敛为下面这种结构与语气，保留全中文、双读者路径与 3-5 条主干说明：

```md
# Knock

Knock 是一个用 Deno + TypeScript 构建的抓取、渲染与投递工具。它支持标准 feed、网页提取与 summary source，把内容统一成 feed / entry 字段后交给 Liquid 模板，再投递到 `file`、`push`、`email` 三类 delivery，并把状态与去重信息保存到 SQLite。

## 功能概览

- 抓取：RSS / Atom / JSON Feed / XQuery / Byparr / summary source
- 渲染：Liquid 模板、过滤表达式、自定义过滤器
- 投递：文件、HTTP push、SMTP 邮件
- 运行：`deno task start`、`deno task daemon --immediate`、Docker
- 状态：SQLite 去重、feed 快照、entry 元数据

## 架构概览

- daemon 与 web 共用同一套核心配置与执行链路。
- fetch source 使用 `http` 或 `byparr` 抓取，再交给 `syndication` 或 `xquery` parser。
- summary source 从已保存状态生成窗口汇总结果，不抓外部输入。
- delivery 采用 canonical 定义 + source keyed override 模型。
```

- [ ] **Step 2: 重写快速开始，只围绕 `config.example.yml`**

把快速开始改成下面这种闭环，显式使用 `--config <your-config.yml>`，同时把最小 file 片段放在这里：

````md
## 快速开始

### 1) 查看仓库内完整参考配置

仓库根目录的 `config.example.yml` 是完整参考配置。先从这份文件裁剪出你自己的运行配置。

### 2) 保留一份最小可运行配置

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
      local: {}
```
````

### 3) 先跑一次最短验证

```bash
deno task daemon --config <your-config.yml> --immediate
```

这条命令会加载你的配置，抓取一次已启用 source，并在完成后退出。

### 4) 再切到常驻运行

```bash
deno task start --config <your-config.yml>
```

`deno task start` 默认以 `--mode all` 启动 web + daemon。

````

- [ ] **Step 3: 调整主章节顺序**

把 README 顶层章节整理成下面这个顺序，后续任务继续填充详细内容：

```md
## 功能概览
## 架构概览
## 快速开始
## 配置设计原则
## 完整键索引
## 常用组合示例
## Web Playground
## CLI 用法
## Docker 部署
## 日志
## 去重与状态存储
## 生产使用建议
## 常见问题
````

- [ ] **Step 4: 运行文档格式检查**

Run: `deno task fmt:check README.md`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: restructure README quick start and overview"
```

---

### Task 3: 完成 `README.md` 的配置说明、示例与支持章节

**Files:**

- Modify: `README.md`
- Check: `src/config/schema.ts`
- Check: `src/config/resolve_config.ts`
- Check: `src/config/capabilities.ts`
- Check: `src/sources/summary.ts`

- [ ] **Step 1: 写“配置设计原则”小节**

在快速开始后插入下面这段原则说明，作为完整键索引的阅读前置：

```md
## 配置设计原则

- `deliveries.<id>` 定义 canonical delivery；`sources.<id>.deliveries` 通过 keyed map 引用并覆写消息子树。
- fetch source 的 transport 只能二选一：`http` 或 `byparr`。
- parser 只能二选一：`syndication` 或 `xquery`；两者都省略时按 `syndication: {}` 处理。
- `summary` source 有独立行为边界，和 `http` / `byparr` / `syndication` / `xquery` 互斥。
- `${ENV_VAR}` 在配置加载阶段展开；Liquid 在支持的字段里于运行阶段渲染。
- 相对路径统一相对于 `runtime_dir` 解析。
```

- [ ] **Step 2: 写“完整键索引”与 AI 章节位置**

把键索引做成键路径清单，并在配置说明之后放 AI 章节。先写下面这段骨架：

```md
## 完整键索引

### 顶层键

- `language`
- `timezone`
- `timestampFormat`
- `ai`
- `sqlite`
- `deliveries`
- `sources`
- `logging`

### `ai`

- `ai.defaultModel`
- `ai.providers.<providerId>.type`
- `ai.providers.<providerId>.apiKey`
- `ai.providers.<providerId>.baseURL`
- `ai.providers.<providerId>.headers`
- `ai.providers.<providerId>.options`
- `ai.providers.<providerId>.models.<modelId>.model`
- `ai.providers.<providerId>.models.<modelId>.temperature`
- `ai.providers.<providerId>.models.<modelId>.maxOutputTokens`
- `ai.providers.<providerId>.models.<modelId>.options`
- `ai.providers.<providerId>.models.<modelId>.variants.<variantId>`

### `deliveries`

- `deliveries.<id>.file.path`
- `deliveries.<id>.file.content`
- `deliveries.<id>.file.rotation.enabled`
- `deliveries.<id>.push.http.method`
- `deliveries.<id>.push.http.url`
- `deliveries.<id>.push.http.headers`
- `deliveries.<id>.push.http.timeout`
- `deliveries.<id>.push.http.retry.limit`
- `deliveries.<id>.push.request.type`
- `deliveries.<id>.push.request.payload`
- `deliveries.<id>.push.response.predicate`
- `deliveries.<id>.push.response.message`
- `deliveries.<id>.email.smtp.host`
- `deliveries.<id>.email.smtp.port`
- `deliveries.<id>.email.smtp.security`
- `deliveries.<id>.email.message.from`
- `deliveries.<id>.email.message.to`
- `deliveries.<id>.email.message.subject`
- `deliveries.<id>.email.message.text`
- `deliveries.<id>.email.message.html`

### `sources`

- `sources.<id>.name`
- `sources.<id>.enabled`
- `sources.<id>.schedule`
- `sources.<id>.http.url`
- `sources.<id>.byparr.url`
- `sources.<id>.deliveries.<deliveryId>`
- `sources.<id>.filter`
- `sources.<id>.syndication.feed`
- `sources.<id>.syndication.entry`
- `sources.<id>.xquery.locate`
- `sources.<id>.xquery.namespaces`
- `sources.<id>.xquery.feed`
- `sources.<id>.xquery.entry`
- `sources.<id>.summary.sources`
- `sources.<id>.summary.feed`
- `sources.<id>.summary.entry`
```

- [ ] **Step 3: 写常用组合示例、Playground、CLI、Docker、日志、状态存储、FAQ**

按下面这些目标段落完成 README 后半部分，保持顺序与信息密度：

````md
## 常用组合示例

### 1. webhook

```yml
deliveries:
  webhook:
    push:
      http:
        method: POST
        url: '${WEBHOOK_URL}'
      request:
        type: body
        payload:
          text: '{{ entry.title }} => {{ entry.link }}'

sources:
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      webhook: {}
```
````

### 2. xquery

```yml
sources:
  website_news:
    http:
      url: https://example.com/news
    deliveries:
      local: {}
    xquery:
      locate: //article
      entry:
        id: string(@data-id)
        title: string(.//h2)
        link: string(.//a/@href)
```

### 3. summary

```yml
sources:
  daily_summary:
    schedule: '0 0 8 * * *'
    deliveries:
      local: {}
    summary:
      sources:
        - deno
      entry:
        id: '{{ source.id }}:{{ source.runtime.window.previousCheckpoint }}..{{ source.runtime.window.scheduledAt }}'
        title: '{{ sources.deno.feed.title }} Daily Summary'
```

## Web Playground

- 首页：`/`
- XQuery Playground：`/xquery`
- Syndication Playground：`/syndication`
- API：`/api/xquery/evaluate`、`/api/syndication/evaluate`
- 适合做 parser 原型验证、字段映射调试与 transport 对照。
- Playground 由服务端发起抓取请求，请只在可信网络环境使用。

## CLI 用法

- `--mode <all|web|daemon>`：默认 `all`
- `--config <path>`：显式指定配置文件
- `--runtime_dir <dir>`：显式指定运行目录
- 运行目录解析顺序：`--runtime_dir` → `KNOCK_RUNTIME_DIR` → `--config` 所在目录 → 当前工作目录下的 `runtime/`

## Docker 部署

- 构建镜像：`docker build -t knock:local .`
- 运行时挂载你自己的持久化目录并传入环境变量
- 配置里的 `${ENV_VAR}` 来自进程环境变量

## 日志

- 默认输出 `json`
- `pretty` 只改变控制台展示层
- 常用配置入口：`logging.level`、`logging.format`、`logging.sinks.console.type`

## 去重与状态存储

- SQLite 保存已投递记录、feed 快照、entry 元数据
- `deliveries` 表按 `source_id + item_id + target_id` 去重
- `feeds` 表保存最近一次 feed payload 与映射结果
- `entries` 表保存 entry 首次/最近看到时间与文本快照

## 生产使用建议

- 先用 `--immediate` 验证，再进入常驻运行
- 把 SQLite 与输出目录放到持久化存储
- secrets 通过进程环境变量注入
- 外部抓取必要时显式设置 `User-Agent`
- 输出文件可能增长时开启 file rotation

## 常见问题

- 配置文件找不到
- 环境变量未定义
- `filter` 未返回布尔值
- push 调 Telegram / webhook 失败
- `http` 与 `byparr` 同时配置
- summary source 没有生成 entry

````

- [ ] **Step 4: 运行文档格式检查**

Run: `deno task fmt:check README.md`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: finish README config and usage sections"
````

---

### Task 4: 增强 `config.example.yml` 的顶层与 AI 注释

**Files:**

- Modify: `config.example.yml`
- Check: `src/config/capabilities.ts`
- Check: `src/config/schema.ts`
- Check: `src/config/resolve_config.ts`

- [ ] **Step 1: 统一顶层注释风格**

把顶层键注释改成“简单字段行内括注 + 复杂块多行分点”风格，例如：

```yml
# 输出与 AI 配置默认使用的语言标签（可选；需为 BCP 47）
language: zh-CN

# 运行时使用的时区（可选；默认: 使用系统时区；系统无法提供时回退 UTC）
timezone: Asia/Shanghai

# 日志与模板输出使用的时间戳格式（可选；默认: yyyy-MM-dd HH:mm:ss）
timestampFormat: yyyy-MM-dd HH:mm:ss
```

- [ ] **Step 2: 完整展开 AI block 注释**

把 `ai:` 整段改成下面这种完整注释密度，覆盖 provider、option、model、variant、默认选择与冲突限制：

```yml
# AI provider / model 静态配置（可选）
# - 供 `ai_translate` / `ai_summarize` 过滤器选择 provider、model、variant
# - `defaultModel` 可写成 `providerId/modelId` 或裸 `modelId`
# - 省略 `defaultModel` 时，按 providers 声明顺序、再按 models 声明顺序选择第一个模型
# - 裸 `modelId` 在跨 provider 重名时会直接报错
ai:
  defaultModel: openai_main/default
  providers:
    openai_main:
      # provider 类型（必填；支持: openai | anthropic | gemini）
      type: openai
      # 通用认证字段（可选；支持 ${ENV_VAR}）
      apiKey: '${OPENAI_API_KEY}'
      # provider 基础地址（可选）
      baseURL: 'https://api.openai.com/v1'
      # 额外请求头（可选；支持 ${ENV_VAR}）
      headers:
        X-Trace-Id: '${TRACE_ID}'
      # provider-specific 选项（可选）
      # - openai 仅支持 organization / project
      # - anthropic 仅支持 authToken，且不能与 apiKey 同时配置
      # - gemini 当前不支持 provider-specific 选项
      options:
        organization: '${OPENAI_ORG_ID}'
        project: '${OPENAI_PROJECT_ID}'
      models:
        default:
          # 底层模型名（必填；必须是静态字面量；不支持 ${ENV_VAR} / Liquid）
          model: gpt-4o-mini
          # 采样温度（可选）
          temperature: 0.2
          # 最大输出 token（可选；省略时按内置默认表与 provider 默认值处理）
          maxOutputTokens: 1024
          # model 级 options（可选）
          # - 当前仅 openai 支持 reasoningEffort / json
          # - anthropic / gemini 的非空 options 会在配置校验阶段失败
          options:
            reasoningEffort: low
            json: false
          variants:
            creative:
              # variant 只允许覆写 temperature / maxOutputTokens / options
              temperature: 0.8
              maxOutputTokens: 2048
              options:
                reasoningEffort: medium
                json: true
```

- [ ] **Step 3: 补齐 AI 相关等价效果说明**

在 AI block 周围补上这些就地注释，避免读者来回查 README：

```yml
# 省略 models.<id>.maxOutputTokens：走内置默认表；未命中具体模型时回退 provider 默认值
# 省略 variants：该 model 只有默认变体
# 省略 headers / options：等价于不附加额外 provider 请求配置
# gemini 的 provider options 当前为空 shape；配置非空值会失败
# anthropic 同时写 apiKey 与 options.authToken 会失败
```

- [ ] **Step 4: 运行配置示例契约测试与格式检查**

Run: `deno task fmt:check config.example.yml && deno task test src/config/config_example_test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add config.example.yml
git commit -m "docs: expand config example top-level and AI comments"
```

---

### Task 5: 增强 `config.example.yml` 的 delivery / source / summary / logging 注释

**Files:**

- Modify: `config.example.yml`
- Check: `src/config/schema.ts`
- Check: `src/config/resolve_config.ts`
- Check: `src/sources/summary.ts`
- Test: `src/config/validate_config_test.ts`

- [ ] **Step 1: 把 delivery 核心块改成“定义 + 互斥 + 省略等价”风格**

把 `deliveries:` 改成下面这种注释模式，明确 canonical delivery 与 source override 边界：

```yml
# 投递目标定义（可选）
# - `deliveries.<id>` 定义 canonical delivery
# - 每个 delivery 只能配置一种类型：file / push / email 三选一
# - source 侧通过 `sources.<id>.deliveries.<deliveryId>` 引用并覆写消息子树
# - source 侧允许覆写：file.content / push.request.payload / email.message
# - source 侧省略 override 或写 `{}`，等价于“引用该 delivery 且不覆写默认消息内容”
deliveries:
  local:
    file:
      # 输出文件路径（必填；相对路径相对于 runtimeDir）
      path: outputs/releases.md
      # 追加写入模板（必填）
      content: |
        ## [{{ title }}]({{ link }})

        {{ content | strip_html }}

        ---
      rotation:
        # 是否启用轮转（可选；默认: false）
        enabled: true
        # 达到指定文件大小时轮转（可选；与 age 二选一或同时使用）
        size: 10m
        # 达到指定文件年龄时轮转（可选；与 size 二选一或同时使用）
        age: 7d
        # 保留历史文件数量（可选；默认由实现内置）
        backups: 3
```

- [ ] **Step 2: 完整补齐 push / email 注释**

把 `push` 与 `email` 示例改成下面这种密度，强调 transport、payload、response 与 SMTP/message 的边界：

```yml
webhook:
  push:
    http:
      # 请求超时（可选）
      timeout: 10s
      # transport retry（可选；省略等价于禁用 transport retry）
      retry:
        # 最大重试次数（可选；默认: 2）
        limit: 2
        # 命中这些状态码时触发重试（可选）
        statusCodes: [408, 429, 500, 502, 503, 504]
        # 超时是否重试（可选；默认: true）
        retryOnTimeout: true
        # 退避上限（可选；默认: 3s）
        backoffLimit: 3s
      # 请求头（可选；支持 ${ENV_VAR}）
      headers:
        Authorization: 'Bearer ${WEBHOOK_TOKEN}'
      # 请求方法（可选；默认: POST）
      method: POST
      # 目标 URL（必填；支持 ${ENV_VAR}）
      url: '${WEBHOOK_URL}'
    request:
      # 负载编码方式（可选；默认: body；支持: query | form | body）
      type: body
      payload:
        text: '{{ entry.title }} => {{ entry.link }}'
    response:
      # 成功判定表达式（可选；省略等价于使用 response.ok）
      predicate: '{{ ok }}'
      # 失败消息模板（可选；支持 Liquid）
      message: 'webhook failed: {{ status }}'

release_email:
  email:
    smtp:
      # SMTP 主机（必填；支持 ${ENV_VAR}）
      host: '${SMTP_HOST}'
      # SMTP 端口（必填）
      port: 587
      # 安全模式（必填；支持: implicit | starttls | none）
      security: starttls
      auth:
        # username / password 成对出现；省略 auth 等价于无认证 SMTP
        username: '${SMTP_USERNAME}'
        password: '${SMTP_PASSWORD}'
    message:
      # from / to / subject 必填；text / html 至少提供一个
      from: 'bot+{{ source.id }}@example.com'
      to:
        - 'team+{{ entry.id }}@example.com'
      subject: '[{{ source.id }}] {{ entry.title }}'
      text: |
        {{ entry.title }}
        {{ entry.link }}
```

- [ ] **Step 3: 完整补齐 source / summary / parser / logging 注释**

把 source 相关示例改成下面这种密度，写清 fetch source、summary source、parser 默认值与互斥关系：

```yml
# 数据源定义（可选）
# - fetch source 的 transport 只能二选一：http / byparr
# - parser 只能二选一：syndication / xquery
# - 两种 parser 都省略时，等价于 `syndication: {}`
# - summary source 与 http / byparr / syndication / xquery 互斥
sources:
  deno:
    # source 显示名称（可选）
    name: Deno releases
    # 是否启用（可选；默认: true）
    enabled: true
    http:
      # 订阅源 URL（必填）
      url: https://github.com/denoland/deno/releases.atom
      # 请求超时（可选）
      timeout: 5s
    # 调度表达式（可选；省略时该 source 只在手动触发或 `--immediate` 下运行）
    schedule: '0 */30 * * * *'
    deliveries:
      # `{}` 等价于“引用 canonical delivery 且不覆写消息内容”
      local: {}
    filter: '{{ title | match_regex: "release", "i" }}'
    syndication:
      # 显式写出 syndication block 与省略该 block 的运行语义一致
      entry:
        id: '{{ id }}'
        title: '{{ title }}'
        link: '{{ link }}'

  daily_summary:
    # summary source 必填 schedule；它从已保存状态生成窗口汇总
    schedule: '0 0 8 * * *'
    deliveries:
      local: {}
    summary:
      # 上游 source 列表（必填）
      sources:
        - deno
      entry:
        # 首次运行没有 checkpoint 时，当前实现只产出默认 feed，不产出 summary entry
        id: '{{ source.id }}:{{ source.runtime.window.previousCheckpoint }}..{{ source.runtime.window.scheduledAt }}'
        title: '{{ sources.deno.feed.title }} Daily Summary'

# 日志配置（可选；默认: 内置默认值）
logging:
  # 日志级别（可选；默认: info）
  level: info
  # 日志格式（可选；默认: json；pretty 只影响控制台展示层）
  format: json
  sinks:
    console:
      # 当前仅支持 console sink
      type: console
```

- [ ] **Step 4: 运行验证**

Run: `deno task fmt:check config.example.yml && deno task test src/config/config_example_test.ts src/config/validate_config_test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add config.example.yml
git commit -m "docs: document config example source and delivery semantics"
```

---

### Task 6: 最终一致性检查与交付说明

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `config.example.yml`
- Test: `src/config/config_example_test.ts`
- Test: `src/config/validate_config_test.ts`

- [ ] **Step 1: 人工核对三份文档的共同口径**

逐项检查下面这份清单，确认三个文件表达一致：

```md
- `deno task start` 默认启动 web + daemon
- `deno.json` 当前没有 `build` task
- delivery canonical 类型是 `file` / `push` / `email`
- fetch source transport 是 `http` / `byparr` 二选一
- parser 是 `syndication` / `xquery` 二选一；都省略时按 `syndication: {}` 处理
- summary source 与 fetch/parser 配置互斥
- `config.example.yml` 是仓库内完整参考配置
- README 正文示例顺序为：最小 file（快速开始）→ webhook → xquery → summary
- 旧 workflow、旧 skill、旧配置形态已经从正文移除
```

- [ ] **Step 2: 运行最终验证**

Run: `deno task fmt:check CLAUDE.md README.md config.example.yml && deno task test src/config/config_example_test.ts src/config/validate_config_test.ts`
Expected: PASS。

- [ ] **Step 3: 检查最终 diff 只包含目标文件**

Run: `git diff --stat -- CLAUDE.md README.md config.example.yml`
Expected: 只显示这三份文件的变更统计。

- [ ] **Step 4: 提交最终收口改动**

```bash
git add CLAUDE.md README.md config.example.yml
git commit -m "docs: align documentation with current config model"
```

---

## Self-Review

### 1. Spec coverage

- `CLAUDE.md` 的目标范围、删减方向、命令与契约对齐，已覆盖在 Task 1。
- `README.md` 的全中文、双读者路径、快速开始、配置原则、键索引、示例顺序、Playground、CLI、Docker、日志、状态存储、FAQ，已覆盖在 Task 2 与 Task 3。
- `config.example.yml` 的高密度注释、AI 全量约束、source / delivery / parser / summary / logging 全量约束，已覆盖在 Task 4 与 Task 5。
- docs-only 验证基线 `config_example_test.ts` + `validate_config_test.ts`，已覆盖在 Task 4、Task 5、Task 6。

### 2. Placeholder scan

- 计划里没有 `TODO`、`TBD`、`implement later`、`similar to task N` 之类占位表述。
- 每个修改步骤都提供了明确的目标段落、命令与提交信息。

### 3. Type consistency

- 全文统一使用 `file` / `push` / `email`、`http` / `byparr`、`syndication` / `xquery`、`summary source`、`config.example.yml` 这些术语。
- README 示例顺序、AI 章节位置、CLI 语义、验证命令在所有任务里保持一致。
