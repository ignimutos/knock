# Web Playground Refresh Spec

## Summary

本次需求只集中在 web 界面，目标是升级现有 `/xquery` playground 的交互体验，并新增独立 `/syndication` playground。两者需要保持一致的页面节奏：左侧输入、右侧运行与结果面板、服务端抓取、结构化 JSON 输出、可查看原始响应内容。

本 spec 负责锁定需求、边界、关键决策和验收标准；具体逐步实施、测试顺序和提交粒度见：

- `docs/superpowers/plans/2026-04-11-web-playground-refresh.md`

## Problem Statement

当前 `/xquery` 页面存在以下问题：

1. 右侧运行/结果 rail 只是固定 `top` 的 sticky，页面滚动时不会保持在视口中部。
2. 左侧命名空间、feed、entry 输入区不可折叠。
3. 右侧错误文本长行不会换行，难以查看。
4. 右侧缺少“原始响应内容”查看区。
5. UI 没有暴露 runtime 已支持的 `native / byparr` 抓取方式切换。
6. runtime 已支持 syndication 解析，但 web 侧没有对应的 playground。

## Goals

1. 升级 `/xquery` 页面，使其更适合滚动、折叠和排错。
2. 在不引入通用 playground 框架的前提下，新增独立 `/syndication` 页面。
3. 让两个 playground 在交互节奏上保持一致，但保留各自 parser 特有输入模型。
4. 复用现有 app shell、结果面板、API logging 和 `fetchAndParseSource()` runtime。
5. 保持错误响应契约稳定，并补齐 scoped 测试与 README 文档。

## Non-Goals

1. 不做通用 playground framework / 元表单系统。
2. 不把 `/xquery` 与 `/syndication` 合并成单页多模式应用。
3. 不暴露 byparr 的高级配置（如 endpoint / proxy / timeout）到首版 UI。
4. 不把 syndication 首版做成自定义 key 动态行或原始对象编辑器。
5. 不引入新的客户端状态框架、hooks 架构或组件库。
6. 不修改现有结构化错误体 shape（`message` / `code` / `category`）。

## Confirmed Decisions

### 1. 页面结构

- 保持两个独立页面：
  - `/xquery`
  - `/syndication`
- 两个页面都沿用：
  - 左侧表单
  - 右侧 rail
  - 顶部主按钮“运行”
  - JSON 结果区
  - 原始响应内容区

### 2. transport 选择

- 使用**分段按钮**，不是下拉框。
- 只支持两个选项：
  - `native`
  - `byparr`
- `byparr` 首版只暴露切换能力，不暴露额外参数。

### 3. 右侧 rail 行为

- 正常情况下：随着滚动保持在视口中部附近。
- 允许轻微缓动动画。
- 当 rail 内容高度超过视口时：自动回退成普通 sticky 顶部对齐，避免抖动。
- 小屏保持普通非 sticky 回退。

### 4. 折叠行为

- 使用原生 `<details>` / `<summary>`。
- `/xquery` 左侧以下区块支持折叠，默认展开：
  - 命名空间
  - feed 提取
  - entry 提取
- `/syndication` 左侧以下区块支持折叠，默认展开：
  - feed 映射
  - entry 映射
- 右侧“原始响应内容”默认折叠。

### 5. 错误与原始内容展示

- 错误区采用：
  - 自动换行
  - 保留滚动容器
- 原始响应内容展示的是：
  - **最终传给 parser 的 payload**
- 不展示 byparr 外层 JSON 壳。

### 6. `/xquery` 页面约束

- 保留现有：
  - locate
  - namespaces
  - feed/entry structured/script 双模式
  - JSON tree 展开/折叠交互
- 新增：
  - transport 分段按钮
  - 可折叠区块
  - 原始响应内容区
  - 右侧 rail 居中跟随逻辑
- 主按钮文案统一改成：`运行`

### 7. `/syndication` 页面约束

- 首版只支持**标准字段**。
- 保留 `feed + entry` 两块。
- 输入形式为**逐字段固定输入**。
- 不支持：
  - 自定义 key 动态行
  - 原始对象编辑
  - xquery 风格 locate / namespaces / script mode
- placeholder 直接展示 Liquid 模板示例，例如：
  - `{{ title }}`
  - `{{ content }}`

### 8. syndication 默认值策略

- 首屏输入默认保持为空。
- 空输入时保留 syndication runtime 的原生默认补全行为。
- 表单顶部（URL / transport 附近）提供一个按钮：
  - `填充默认模板`
- 点击后一次性填充 feed + entry 的标准字段模板，便于调试。

## Required File Impact

### Existing files expected to change

- `web/routes/_app.tsx`
- `web/components/layout/app_shell.tsx`
- `web/routes/index.tsx`
- `web/routes/index_test.ts`
- `web/islands/xquery_form.tsx`
- `web/components/xquery/result_panel.tsx`
- `web/routes/xquery.tsx`
- `src/web/xquery_playground.ts`
- `src/web/xquery_playground_test.ts`
- `web/routes/api/xquery/evaluate.ts`
- `web/routes/api/xquery/evaluate_test.ts`
- `web/main.ts`
- `web/main_test.ts`
- `README.md`

### New files expected to be added

- `web/islands/syndication_form.tsx`
- `web/routes/syndication.tsx`
- `web/routes/syndication_test.ts`
- `src/web/syndication_playground.ts`
- `src/web/syndication_playground_test.ts`
- `web/routes/api/syndication/evaluate.ts`
- `web/routes/api/syndication/evaluate_test.ts`

## API / Data Contract Expectations

### Success shape

两个 playground 成功响应都应包含：

- `warnings`
- `fetchMeta`
- `parser`
- `rawContent`
- `feed`
- `entries`

### Error shape

两个 playground 错误响应都保持：

- `message`
- `code`
- `category`

不新增第二套并行错误 shape。

## UX Acceptance Criteria

### `/xquery`

1. 页面存在 `native / byparr` transport 分段按钮。
2. 命名空间、feed、entry 区块都可折叠。
3. 命名空间区块头部的折叠标题和“新增命名空间”按钮在同一行。
4. 右侧按钮文案为“运行”。
5. 页面滚动时：
   - rail 较短时保持在视口中部附近
   - rail 较长时自动回退普通 sticky
6. 长错误文本可以换行，并且仍可滚动查看。
7. 右侧存在“原始响应内容”区，默认折叠。
8. 原始响应内容显示实际 parser 输入内容。

### `/syndication`

1. 页面可从首页和导航进入。
2. 页面存在 `native / byparr` transport 分段按钮。
3. 页面保留 `feed` 与 `entry` 两个映射区块，默认展开。
4. 字段是标准字段固定输入，而不是自定义动态行。
5. 各字段 placeholder 为 Liquid 示例。
6. 顶部存在“填充默认模板”按钮。
7. 空输入时依然允许基于 runtime 默认行为运行。
8. 点击“填充默认模板”后，可一次性填充 feed + entry 标准字段。
9. 右侧存在 JSON 结果与原始响应内容区。

## Technical Acceptance Criteria

1. 继续复用现有 `fetchAndParseSource()` runtime。
2. 继续复用现有 API logging wrapper，不另起一套日志机制。
3. 不引入新的全局状态管理或重构为 hooks 架构。
4. scoped 测试需覆盖：
   - `/xquery` SSR
   - `/syndication` SSR
   - xquery adapter
   - syndication adapter
   - xquery API
   - syndication API
   - `web/main.ts` route/logging
5. README 必须同步 web playground 章节。

## Risks

1. 右侧 rail 若实现过度，会因面板高度变化产生明显跳动。
2. 原始 payload 可能较大，必须保持默认折叠和受限高度。
3. syndication 若直接预填模板，可能改变 runtime 默认空映射行为；因此本次明确采用“空输入 + 一键填充”。

## Open Questions

无。当前需求与关键交互已收敛，可直接进入实现。
