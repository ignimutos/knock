# 文档对齐与参考配置整理设计

日期：2026-04-14  
范围：`CLAUDE.md`、`README.md`、`config.example.yml`

## 1. 背景与目标

当前三份文档存在几类问题：

- 部分内容已经落后于最新代码实现，例如 `deno task start` 的语义、`build` task、`workflow-finish` 等历史说明
- 同一概念在不同文档里的口径不一致，例如 source / delivery 模型、summary source、parser 默认行为、运行入口说明
- `README.md` 信息层次混杂，首次使用者和维护者都需要来回跳读
- `config.example.yml` 作为仓库内完整参考配置，注释密度仍不足以直接回答“是否必填、默认值是什么、不填等价什么、哪些字段互斥”这类高频问题

本次整理的目标是：

1. 让三份文档全部以当前 git 代码实现为准
2. 删除过时、重复、无法稳定约束行为的说明
3. 让 `README.md` 成为清晰的主文档，让 `config.example.yml` 成为仓库内完整参考配置
4. 让 `CLAUDE.md` 收敛为 agent 执行规则与仓库契约，而不是流程性说明集合

## 2. 设计原则

1. 单一事实源：文档口径以 `deno.json`、`src/main.ts`、`src/config/schema.ts`、`src/config/resolve_config.ts`、`src/config/capabilities.ts`、`src/sources/summary.ts` 与配置测试为准。
2. 只描述当前有效实现：旧 workflow、旧 skill、旧配置形态不再出现在正文。
3. 分工明确：
   - `CLAUDE.md` 负责规则与契约
   - `README.md` 负责使用路径与系统理解
   - `config.example.yml` 负责完整字段参考
4. 首次使用者与维护者两类读者同时覆盖：README 前半聚焦最短闭环，后半提供精确索引与边界说明。
5. 示例与规则一致：README 示例数量受控，完整字段细节统一沉淀到 `config.example.yml`。

## 3. 目标文档结构

### 3.1 `CLAUDE.md`

定位：仓库唯一 tracked agent-instruction surface，聚焦执行规则与仓库契约。

保留内容：

- canonical scope
- project snapshot
- repository map
- common commands
- core contracts
- execution rules
- naming / comments / observability / dependencies
- verification and review
- CI reality

删除内容：

- `workflow-finish` 等历史 workflow 说明
- Worktree policy 整章
- 类似“等待式措辞”“流程偏好”这类可执行性弱、无法稳定验证的规则

收敛后的关键口径：

- `deno task start` 默认是 `web + daemon`
- `deno.json` 当前无 `build` task
- delivery canonical 类型是 `file` / `push` / `email`
- fetch source transport 是 `http` / `byparr` 二选一
- parser 是 `syndication` / `xquery` 二选一
- summary source 是独立 source 类型

### 3.2 `README.md`

定位：仓库主文档，全中文，前半帮助快速跑通，后半帮助查找边界与键路径。

目标章节顺序：

1. 项目简介
2. 功能概览
3. 架构概览
4. 快速开始
5. 配置设计原则
6. 完整键索引
7. AI 配置与过滤器
8. 常用组合示例
9. Web Playground
10. CLI 用法
11. Docker 部署
12. 日志
13. 去重与状态存储
14. 生产使用建议
15. 常见问题

其中：

- 快速开始只明确提及 `config.example.yml`，并把它表述为“仓库内完整参考配置”
- 快速开始采用显式 `--config <your-config.yml>` 的最短闭环命令
- `README.md` 不再展开本地 `runtime/` 示例目录
- `CLI` 小节保留 `--config` / `--runtime_dir` 的完整优先级与路径解析细节
- AI 章节放在配置说明之后，深度为“中等”：最小示例、关键约束、常见坑
- 过滤器只保留高频项：`match_regex`、`strip_html`、Telegram HTML / MarkdownV2

### 3.3 `config.example.yml`

定位：仓库内完整参考配置。

设计目标：

- 保持现有结构与示例覆盖范围
- 注释统一回答四类问题：
  - 是否必填
  - 默认值是什么
  - 不填等价效果是什么
  - 与哪些字段互斥或存在 one-of 关系

注释风格：

- 简单字段：行内括注
- 复杂对象块：多行分点说明

注释密度：

- AI block 完整展开
- source / delivery / parser / summary / logging 核心块也完整展开
- 每个示例块统一增加“省略等价效果 / 互斥关系”提示

## 4. README 的读者路径设计

### 4.1 首次使用者路径

读者目标：尽快从参考配置裁剪出自己的最小配置，并成功执行一次。

路径：

1. 打开 `config.example.yml`
2. 裁剪出最小 file delivery + feed source 配置
3. 执行 `deno task daemon --config <your-config.yml> --immediate`
4. 确认输出成功
5. 再切换到 `deno task start --config <your-config.yml>`

这个路径要求 README 提供：

- 最小配置片段
- 明确的验证命令
- 不依赖默认发现顺序的命令示例

### 4.2 维护者路径

读者目标：快速找到某个字段、某条互斥关系、某段运行语义在文档中的位置。

路径：

1. 看“配置设计原则”理解 canonical delivery / source override / parser 默认行为
2. 看“完整键索引”定位键路径
3. 回到 `config.example.yml` 查看完整注释与示例
4. 需要运行细节时看 CLI / Playground / 状态存储章节

## 5. README 详细设计

### 5.1 快速开始

快速开始采用一条确定路径：

- 不介绍本地目录模板
- 不依赖默认 `runtime/` 目录示例
- 直接提示“从 `config.example.yml` 裁剪你自己的配置”
- 先跑 `deno task daemon --config <your-config.yml> --immediate`
- 再跑 `deno task start --config <your-config.yml>`

### 5.2 配置设计原则

这一节承担“先讲模型，再讲键”的职责，固定保留 4-6 条高价值原则：

- canonical delivery 与 source keyed override
- fetch source 的 transport 二选一
- parser 的二选一与默认 `syndication: {}`
- summary source 的独立边界
- `${ENV_VAR}` 与 Liquid 的阶段差异
- 相对路径与 `runtime_dir` 的关系

### 5.3 完整键索引

索引形式采用“键路径清单”，不用表格。

理由：

- 更紧凑
- 更适合全文检索
- 与 `config.example.yml` 的分工更清晰
- 减少 README 与配置示例双重维护同一描述的负担

### 5.4 AI 章节

AI 章节放在配置说明之后。

README 只保留：

- `ai_translate` / `ai_summarize` 的用途
- 最小可运行示例
- 关键约束：
  - provider 类型范围
  - model 必须静态字面量
  - `defaultModel` 选择语义
  - anthropic / gemini / openai 的主要限制
- 常见坑：provider-specific 选项写错、裸 modelId 重名、同步路径不可用等

provider/model/variant 的完整细节全部交给 `config.example.yml`。

### 5.5 常用组合示例

正文只保留四组示例：

1. 最小 file —— 放在快速开始
2. webhook
3. xquery
4. summary

后三组顺序固定为：`webhook → xquery → summary`

email delivery：

- 保留在功能概览与完整键索引
- 不在正文常用组合示例中占据篇幅

### 5.6 Playground / CLI / Docker / Logging / State

这些章节统一采用精简保留策略：

- Playground：入口路由、API 路由、适用场景、安全提示
- CLI：参数用途 + `--config` / `--runtime_dir` 完整优先级与路径解析
- Docker：构建镜像、挂载持久化目录、传环境变量
- Logging：默认 `json`、`pretty` 只影响展示层、常用配置入口
- State：SQLite 的职责、三张表职责、关键去重主键

### 5.7 常见问题

保留 5-7 个高频问题：

- 配置文件找不到
- 环境变量未定义
- filter 未返回布尔值
- push 调 Telegram / webhook 失败
- `http` 与 `byparr` 同时配置
- summary source 没有生成 entry

## 6. `config.example.yml` 的详细设计

### 6.1 顶层键

顶层键继续覆盖：

- `language`
- `timezone`
- `timestampFormat`
- `ai`
- `sqlite`
- `deliveries`
- `sources`
- `logging`

每个顶层键至少明确：是否可选、默认值或默认语义。

### 6.2 AI block

AI block 完整展开，覆盖：

- provider 类型范围：`openai` / `anthropic` / `gemini`
- `defaultModel` 的引用形式与默认选择语义
- 裸 `modelId` 重名冲突
- provider-specific options：
  - openai：`organization` / `project`
  - anthropic：`authToken`，且与 `apiKey` 互斥
  - gemini：当前不支持 provider-specific options
- model 约束：
  - `model` 必须是静态字面量
  - `options` 当前支持范围
  - `variants` 允许覆写的字段集合
- 省略时的等价行为与默认回退路径

### 6.3 Delivery blocks

delivery 注释明确：

- `deliveries.<id>` 是 canonical 定义
- 类型只能三选一：`file` / `push` / `email`
- source 侧 keyed override 的允许范围：
  - file → `content`
  - push → `request.payload`
  - email → `message`
- `{}` 等价于“引用该 delivery 且不覆写消息内容”

#### file

明确：

- `path` 必填
- `content` 必填
- rotation 字段的可选性与触发语义
- file delivery 是追加写入，不是覆盖模式

#### push

明确：

- transport (`push.http.*`) 与 payload (`push.request.*`) 的边界
- retry 省略等价于禁用 transport retry
- `response.predicate` 省略等价于 `response.ok`
- `GET` / `HEAD` 与 body payload 的限制
- `${ENV_VAR}` 与 Liquid 的可用边界

#### email

明确：

- `smtp.host` / `port` / `security` 的约束
- auth 的成对出现语义
- `from` / `to` / `subject` 必填
- `text` / `html` 至少一个
- 地址字段与模板字段的语义差异

### 6.4 Source blocks

source 注释明确：

- fetch source 与 summary source 的区别
- `http` / `byparr` transport 二选一
- `syndication` / `xquery` parser 二选一
- 两个 parser 都省略等价于 `syndication: {}`
- `schedule` 省略时只在手动触发或 `--immediate` 下运行
- `deliveries.<deliveryId>: {}` 的等价行为
- `filter` 必须返回布尔值

#### summary

明确：

- 必须配置 `schedule`
- 与 `http` / `byparr` / `syndication` / `xquery` 互斥
- 首次无 checkpoint 时只产出默认 feed，不产出 summary entry
- `sources.<id>.feed` / `entries` / `name` 的运行时语义

### 6.5 Logging block

logging 注释明确：

- 默认 `json`
- `pretty` 只影响控制台展示层
- 当前 `console` 是唯一 sink 类型
- level / format / sink 的支持范围

## 7. `CLAUDE.md` 的详细设计

### 7.1 保留的内容

- canonical scope
- project snapshot
- repository map
- common commands
- core contracts
- execution rules
- naming / comments / observability / dependencies
- verification and review
- CI reality

### 7.2 删除的内容

- Worktree policy 整章
- `workflow-finish` 及同类旧入口说明
- 流程偏好、等待式措辞、不可稳定约束的执行提示

### 7.3 保留的规则风格

- 继续使用 MUST / SHOULD / MAY 体系
- 只保留可执行、可核对、直接影响代码与文档结果的规则
- 命令清单严格以 `deno.json` 为准
- CI reality 保留事实版，不扩展额外流程建议

## 8. 关键事实清单

整理时必须统一对齐这些代码事实：

- `deno task start` 默认 `--mode all`
- `deno.json` 当前无 `build` task
- delivery canonical 类型是 `file` / `push` / `email`
- fetch source transport 是 `http` / `byparr`
- parser 是 `syndication` / `xquery`
- parser 两者都省略时按 `syndication: {}` 处理
- summary source 与 fetch/parser 配置互斥
- `config.example.yml` 是仓库内完整参考配置
- `${ENV_VAR}` 在配置加载阶段展开
- Liquid 在支持的字段中运行阶段渲染

## 9. 验证策略

这是 docs-only 改动，验证采用最小闭环：

1. 人工一致性检查
   - 三份文档术语一致
   - README 示例顺序与章节顺序一致
   - 旧 workflow、旧 skill、旧配置形态已移除
2. 自动验证
   - `deno task test src/config/config_example_test.ts`
   - `deno task test src/config/validate_config_test.ts`
3. 交付说明
   - 明确改了什么
   - 明确跑了哪些验证
   - 明确哪些项未运行

## 10. 非目标

- 不修改业务逻辑与运行时代码
- 不新增配置 shape
- 不补历史兼容层或弃用迁移说明
- 不把 README 改成中英双语
