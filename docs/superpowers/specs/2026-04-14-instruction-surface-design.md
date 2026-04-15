# CLAUDE 指令面重构设计

日期：2026-04-14  
范围：`/root/.claude/CLAUDE.md`、`/root/.claude/GitNexus.md`、`CLAUDE.md`、`.claude/rules/**`

## 1. 背景与目标

当前指令面有三类问题：

- 全局 `CLAUDE.md` 与仓库 `CLAUDE.md` 的边界不够清晰，通用原则与项目规则混放
- 仓库 `CLAUDE.md` 同时承担“项目导航页”“规则正文”“执行细则”，信息密度偏高
- GitNexus 规则目前经由全局 `@GitNexus.md` 注入，但其中包含明显的 `knock` 仓库专属内容

本次重构目标：

1. 把稳定通用原则收敛到全局 `/root/.claude/CLAUDE.md`
2. 把项目专属细则下沉到仓库 `.claude/rules/**`
3. 把 GitNexus.md 全量迁回仓库，不再保留全局注入入口
4. 只修正 GitNexus.md 正文里对 skill 的路径引用，使其指向当前全局 skill 布局
5. 把仓库 `CLAUDE.md` 收敛成薄入口，只保留高信号、非代码可推断、必须顶层可见的项目约束
6. 让整体结构更贴近 Claude Code 官方教程推荐的写法

## 2. 官方教程约束

本次设计以 Claude Code 官方文档中的 `best-practices` 与 `memory` 指南为依据，采用以下约束：

1. `CLAUDE.md` 只保留 Claude 不能稳定从代码中自行推断的内容。
2. 优先写：常用命令、偏离默认的工作流规则、项目特有架构决策、环境怪癖、非显然坑点。
3. 避免写：能从代码读出来的信息、频繁变化的信息、冗长教程、逐文件说明、自明空话。
4. 项目共享规则放在仓库内 tracked instruction surface；个人偏好与跨仓库总则放在全局记忆。
5. 大项目中的专题规则应优先使用 path-scoped project rules，通过显式 `paths:` 按需加载，而不是在仓库 `CLAUDE.md` 里集中引用。

这意味着本次重构不是简单搬运文本，而是按“通用总则 / 项目顶层约束 / path-scoped 主题细则”三层重新定界。

## 3. 设计原则

1. 单一职责：一个文件只承载一种层级的规则。
2. 单一事实源：同一规则只在一个位置写正文，不在多个入口重复。
3. 薄顶层：仓库 `CLAUDE.md` 只放必须每次会话一眼可见的项目规则。
4. 规则可定位：项目细则按主题落到 `.claude/rules/**`，文件名直接表达职责。
5. 尽量不改语义：本轮以重组与澄清边界为主，不主动改变既有规范含义。

## 4. 目标结构

### 4.1 全局 `/root/.claude/CLAUDE.md`

定位：跨仓库稳定总则。

保留内容：

- 回复风格
- 表达规则
- 工作方式
- 验证后再宣告完成
- 高风险操作先确认
- 工具使用优先级
- `@RTK.md`

调整内容：

- 补入少量 Claude Code 官方通用原则表达：先读后改、优先最小完整改动、优先专用工具、没有验证结果不宣称完成
- 从全局入口移除 `@GitNexus.md`，并把 GitNexus.md 全量迁回仓库规则层

约束：

- 不写仓库专属实现细节
- 不写特定仓库命令、路径、边界列表
- 保持短小、稳定、跨项目可复用

### 4.2 仓库 `CLAUDE.md`

定位：仓库唯一 tracked 顶层 instruction surface，但只承担薄入口职责。

目标章节：

- `Canonical scope`
- `Project-specific workflow`
- `Project-only contracts`
- `Verification boundaries`
- `CI reality`

保留内容类型：

- `deno task` 优先与 scoped task 约束
- 本仓库配置模型的关键契约摘要
- 文档同步要求摘要
- 高影响边界的验证边界摘要
- 当前 CI 事实

删除或显著压缩的内容：

- 详细 `Project snapshot`
- 详细 `Repository map`
- 主题细则正文
- 显式 rules 索引

约束：

- 不再成为规则正文堆栈
- 不重复 `.claude/rules/**` 中已经有 canonical 正文的内容
- 只保留“必须顶层可见”的项目事实与约束

### 4.3 `.claude/rules/**`

定位：项目专属、按路径按需加载的主题规则层。

新增文件：

- `.claude/rules/execution.md`
- `.claude/rules/verification.md`
- `.claude/rules/docs-sync.md`
- `.claude/rules/config-contract.md`
- `.claude/rules/naming-and-dependencies.md`
- `.claude/rules/gitnexus.md`

这些文件都不是“纯放在那里”，而是需要各自带显式 `paths:`，例如按 `src/config/**`、`src/**`、`README.md`、`config.example.yml`、`.github/**`、`.claude/**` 等范围命中加载。

保留文件：

- `.claude/rules/logging-otel.md`
- `.claude/rules/logging-console.md`
- `.claude/rules/testing-architecture.md`

原则：

- 每个文件只承载一个稳定主题
- 规则正文只写一次
- 相关规则集中到同一主题文件，避免横向复制
- 每个规则文件必须声明显式 `paths:`，只在命中相关目录或文件时加载
- 不在仓库 `CLAUDE.md` 中通过 `@path` 显式引入这些 rules，避免会话启动即塞满上下文

## 5. 文件级迁移设计

### 5.1 全局 `CLAUDE.md` 上收内容

从现有全局文件保留并整理：

- 回复原则
- 表达规则
- 工作方式
- 禁止的表达习惯

新增或强化的通用总则：

- 改代码或文档前先读目标文件与相邻上下文
- 优先编辑现有文件，优先局部修改，优先最小完整改动
- 优先使用专用工具而不是通用 shell 命令
- 没有验证结果时不宣称完成
- 共享或高风险操作先确认

移出全局入口：

- `@GitNexus.md`

迁移方式：

- 不做全局精简版保留
- 直接把 GitNexus.md 的完整规则正文迁入仓库 `.claude/rules/gitnexus.md`

原因：

- 这份规则本来就是项目规则，只是之前被你挪到了全局
- 它包含 `knock` 仓库专属索引、repo 名、资源路径、工作流约束，不适合作为全局默认记忆
- 你已确认 GitNexus.md 要全量迁回项目里

### 5.2 仓库 `CLAUDE.md` 保留内容

仓库顶层只保留以下高价值项目约束摘要：

1. 顶层声明
   - `CLAUDE.md` 是仓库唯一 canonical tracked instruction surface
   - RFC 2119 关键字解释

2. 项目工作流摘要
   - 标准 `deno task` 优先
   - `check` / `fmt:check` / `lint:check` / `test` 优先使用 scoped path

3. 项目关键契约摘要
   - 当前配置模型的 canonical shape
   - `${ENV_VAR}` 展开语义
   - 禁止引入旧 shape / 双 shape / 历史兼容层

4. 验证边界摘要
   - docs-only 与 code changes 的不同验证要求
   - 共享高影响边界改动需要全量 `deno task test`

5. CI 事实
   - 当前工作流文件与本地验证基线

### 5.3 下沉到 rules 的内容

#### `.claude/rules/config-contract.md`

承载：

- 当前配置模型完整约束
- canonical delivery / source keyed override 规则
- 禁止恢复 `templates` / `destinations` 等旧结构
- 单一事实源要求
- `${ENV_VAR}`、secret、运行时敏感数据约束

#### `.claude/rules/execution.md`

承载：

- 修改前先读目标模块与相邻上下文
- 行为改动前先读相邻测试
- 非平凡任务先有简短计划
- 保持原子变更
- 验证失败或前提失效时停止并重规划
- 何时允许请求用户参与

#### `.claude/rules/verification.md`

承载：

- docs-only 变更的校验要求
- code changes 的最窄相关验证要求
- scoped task 约束
- 全量测试触发边界
- 最终交付必须说明的验证结果与剩余风险

#### `.claude/rules/docs-sync.md`

承载：

- 行为、配置 shape、命名、CLI 输出、错误文案变化时对 `README.md` 与 `config.example.yml` 的同步要求
- 不记录代码未实现行为

#### `.claude/rules/naming-and-dependencies.md`

承载：

- 稳定术语要求
- 中文自然语言注释要求
- TODO/FIXME 的延期原因与移除条件
- 依赖优先级
- 新的不可信结构化输入边界用 `zod` 校验

#### `.claude/rules/gitnexus.md`

承载：

- GitNexus.md 的完整规则正文
- 修改符号前必须做 impact analysis
- 提交前必须做 detect_changes
- HIGH / CRITICAL 风险告知要求
- `knock` repo 名、资源路径、常用工具映射
- 显式 `paths:` 需覆盖会触发代码理解、符号修改、提交前检查的工作面，如 `src/**`、`web/**`、`CLAUDE.md`、`.claude/**`

来源：

- 现有 `/root/.claude/GitNexus.md` 全量迁回项目
- 仓库当前对 GitNexus 的强约束

## 6. GitNexus 专项处理

这是本次重构的一个关键点。

当前状态：

- 全局 `/root/.claude/CLAUDE.md` 通过 `@GitNexus.md` 引入 GitNexus 规则
- `/root/.claude/GitNexus.md` 承载的是本项目原本的 GitNexus 规则正文

问题：

- 这不是跨仓库稳定总则，而是仓库专属上下文

目标状态：

- 全局入口不再自动注入 GitNexus 规则
- GitNexus.md 全量迁回本仓库 `.claude/rules/gitnexus.md`
- GitNexus 仍是本仓库工作流的一部分，但其约束范围回到项目层

实现边界：

- 本轮按全量迁回处理，不做全局保留版
- 迁回时只修正 GitNexus.md 正文里引用的 skill 路径，避免继续指向项目内已删除的 skills 目录

## 7. 预期成品

### 7.1 全局 `CLAUDE.md`

成品特征：

- 读起来像稳定总则，而不是项目模板
- 章节短、规则短、覆盖跨仓库行为
- 不含 `knock`、`deno task`、`.claude/rules/...` 这类项目专属内容

### 7.2 仓库 `CLAUDE.md`

成品特征：

- 5 个左右短章节
- 可在短时间内读完
- 只保留本仓库必须顶层可见的规则摘要
- 不再承担规则正文仓库

### 7.3 `.claude/rules/**`

成品特征：

- 主题边界清晰
- 文件名直接对应规则主题
- 与现有 logging / testing 规则风格保持一致
- 可以承载项目专属细则而不污染全局记忆

## 8. 迁移顺序

1. 重写全局 `/root/.claude/CLAUDE.md`
   - 保留稳定总则
   - 移除 `@GitNexus.md`

2. 新增仓库 rules 文件
   - `execution.md`
   - `verification.md`
   - `docs-sync.md`
   - `config-contract.md`
   - `naming-and-dependencies.md`
   - `gitnexus.md`

3. 收敛仓库 `CLAUDE.md`
   - 删去详细地图与长正文
   - 只保留项目摘要与必须顶层可见的约束

4. 一致性检查
   - 确认所有规则均有唯一正文归属
   - 确认没有遗留全局注入的 repo 专属规则
   - 确认顶层 `CLAUDE.md` 未重复规则正文
   - 确认 GitNexus.md 正文中的 skill 路径引用已改到当前全局 skill 布局

## 9. 验证策略

这是 docs/instructions-only 变更，验证以一致性与结构校验为主。

1. 结构校验
   - 全局 `CLAUDE.md` 只含跨仓库稳定总则
   - 仓库 `CLAUDE.md` 只含薄入口内容
   - 项目细则位于 `.claude/rules/**`

2. 内容校验
   - 同一规则只有一个正文归属
   - 仓库专属 GitNexus 规则不再由全局默认注入
   - 仓库 `CLAUDE.md` 不再包含详细 rules 正文与显式 rules 索引

3. 路径校验
   - 所有新规则文件路径存在
   - 所有被提及的现有规则文件路径真实存在
   - 每个新 rules 文件都声明显式 `paths:`
   - `paths:` 覆盖面与其主题职责匹配，不出现全仓库兜底式乱配

4. 交付说明
   - 明确哪些内容上收全局
   - 明确哪些内容下沉 rules
   - 明确哪些内容仅做压缩与重组，没有改变语义

## 10. 非目标

- 不修改业务代码
- 不改变既有 logging / testing 规则语义
- 不引入新的项目流程或新的 GitNexus 工作流
- 不把仓库 `CLAUDE.md` 再扩回长篇导航文档
- 不把个人偏好重新塞回仓库 rules
