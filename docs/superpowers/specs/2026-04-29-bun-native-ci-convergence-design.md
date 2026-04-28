# Bun-native CI 收敛设计

## 背景

当前仓库的活跃 CI 面只有 `.github/workflows/docker.yml`，但该 workflow 仍保留 Deno 时代残留：

- `verify` / `image` job 安装的是 Deno，却执行会转入 `bun run ...` 的任务。
- `paths` 仍监听 `deno.json` / `deno.lock`，却没有覆盖当前真实影响 CI 的 `package.json` / `bun.lock`。
- 仓库内面向人和 agent 的部分约束仍把 `deno task` 当作默认事实源。

这导致 CI 处于“外层还是 Deno，内层已经是 Bun”的混合态。此次故障的直接表现就是 GitHub Actions 中 `bun: command not found`。

## 目标

1. 让所有活跃 CI / Docker 发布路径只以 Bun 作为唯一运行时。
2. 让 workflow 触发条件只覆盖 Bun 时代真实会影响结果的文件。
3. 让 `package.json` 中的脚本名成为 CI 的稳定执行契约。
4. 让 `README.md`、`docker/README.md`、`CLAUDE.md` 与相关规则文件同步反映真实 CI 行为。
5. 清理活跃 CI 语义中的 Deno 残留，但不误删把 Deno 当作业务示例或抓取对象的内容。

## 非目标

1. 不新增双运行时 fallback，不保留 “bun 失败再试 deno”。
2. 不为了当前只有一条活跃 workflow 的现状而强行抽 reusable workflow / composite action。
3. 不改动 Docker 镜像构建逻辑本身，只收敛运行时、触发面和契约说明。
4. 不做全仓文本级 `deno` 全量替换；像 README 中把 Deno 当 feed 示例的内容保留。

## 范围

### 纳入本次收敛的面

- `.github/workflows/docker.yml`
- `package.json` 中被 CI 调用的脚本定义
- `README.md`
- `docker/README.md`
- `CLAUDE.md`
- `.claude/rules/verification.md`
- 其他只要仍声明活跃 CI / 发布运行时事实的仓库内文档或规则

### 明确保留的内容

- 把 Deno 当作抓取源、示例 feed、模板示例的数据内容
- 与 CI 运行时无关的历史说明
- 已经是 Bun-native 且无失真的文档段落

## 设计原则

### 单一运行时

所有活跃 CI job 只安装 Bun。运行时判定只在 workflow setup 层发生一次，后续步骤全部默认运行在 Bun 语义下。

### 单一任务入口

workflow 不内嵌验证细节，只调用 `package.json` 中稳定存在的脚本名，例如：

- `bun run verify:full`
- `bun run image:prepare`

脚本内部怎么组织可以演进，但 workflow 只依赖这些公开契约。

### 单一触发面

workflow `paths` 只跟踪真实会改变验证或镜像结果的文件，避免旧路径造成假触发、漏触发或错误心智模型。

### 单一事实源

README、Docker README、CLAUDE 规则与 workflow 的真实行为必须一致；若行为变化，说明层也要同步更新。

## 组件设计

### 1. Workflow 组件

目标文件：`.github/workflows/docker.yml`

职责：

- 定义 `verify -> image -> publish -> notify` 拓扑。
- 在 `verify` 和 `image` job 中安装 Bun，而不是 Deno。
- 通过 `bun run verify:full` 和 `bun run image:prepare` 执行门禁。
- 收敛 `paths` 到 Bun 时代真实依赖集。

设计决策：

- 保留现有 job 拓扑，不引入新的 workflow 分层。
- 不在 YAML 中重复写构建、测试细节。
- `publish` job 继续只负责镜像推送与 Docker Hub README 同步，不承担运行时兼容逻辑。

### 2. 任务契约组件

目标文件：`package.json`

职责：

- 提供 CI 调用的稳定脚本入口。
- 作为 workflow 唯一依赖的执行契约面。

设计决策：

- 优先复用现有脚本名，避免不必要改名。
- 若脚本名已经准确表达职责，则只改 workflow，不改脚本层。
- 若发现脚本与文档描述不一致，以脚本实际行为为准校正文档。

### 3. 发布说明组件

目标文件：`README.md`、`docker/README.md`

职责：

- 说明本地验证入口、Docker 构建入口、CI 发布顺序。
- 明确当前唯一活跃运行时为 Bun。

设计决策：

- 仅修正文档中仍会影响操作判断的 CI / Docker 事实。
- 不改动与本次 CI 收敛无关的业务文档。
- 保留把 Deno 当示例源的内容，不把它误判为运行时残留。

### 4. Agent / 规则组件

目标文件：`CLAUDE.md`、`.claude/rules/verification.md`

职责：

- 更新仓库内对 agent 的默认执行约束。
- 避免后续 agent 因旧规则再次把验证入口写回 `deno task`。

设计决策：

- 把“优先 `deno task`”收敛到 Bun 时代真实命令。
- 保持“优先最窄验证、共享高影响边界补全量验证”的原则不变，只替换运行时事实。

## 触发面设计

`docker.yml` 的 `paths` 应只保留当前会影响 Docker 验证与发布结果的文件。期望覆盖至少包括：

- `src/**`
- `web/**`
- `package.json`
- `bun.lock`
- `tsconfig.json`
- `vite.config.ts`
- `Dockerfile`
- `.dockerignore`
- `docker/**`
- `scripts/**`
- `README.md`
- `.github/workflows/docker.yml`

是否把 `CLAUDE.md` 或 `.claude/rules/**` 纳入 `paths`，取决于是否把“agent 规则变化”视为应触发 Docker CI 的发布事实变化。默认建议不纳入，因为它们不直接改变镜像或门禁结果。

## 执行流设计

1. 开发者修改源码、构建脚本、Docker 资产或相关说明文件。
2. `docker.yml` 根据 Bun-era 有效路径决定是否触发。
3. `verify` job 安装 Bun，执行 `bun run verify:full`。
4. `image` job 在同一运行时前提下执行 `bun run image:prepare`。
5. `publish` job 只在 `main` 上推送镜像并同步 `docker/README.md`。
6. `notify` job 基于前序 job 结果发送通知。
7. 文档与 agent 规则同步描述上述真实流程，形成单一事实源。

## 错误处理策略

1. 运行时缺失时快速失败，不做兼容补丁。
2. 路径失配通过收敛修正，不保留旧路径容错。
3. 文档失真视为契约错误，必须与 workflow 一并修复。
4. 不引入 “bun / deno 双轨共存” 逻辑。

## 预期修改清单

### 必改

- `.github/workflows/docker.yml`
- `CLAUDE.md`
- `.claude/rules/verification.md`

### 条件修改

- `README.md`：若存在仍会误导 CI / Docker 运行时判断的残留描述则修正。
- `docker/README.md`：若与实际 workflow 行为不完全一致则修正。
- `package.json`：仅当脚本契约与设计不一致时调整；否则保持不动。

## 验证计划

由于本次设计本身是 docs 产物，写入阶段只做路径与命令一致性检查。后续真正实施时按以下顺序验证：

1. 检查活跃 CI / 规则 / 文档中的运行时事实是否统一为 Bun。
2. 运行最窄相关验证：`bun run verify:full`。
3. 运行 Docker 相关验证：`bun run image:prepare`。
4. 若实施中触及共享高影响入口，再补全量 `bun run test`。
5. 若具备 GitHub 远端验证条件，再观察真实 Actions 结果是否转绿。

## 风险与取舍

### 风险

- 只按字符串搜索清理 `deno`，容易误删业务示例内容。
- 只改 workflow 不改 agent / 规则，后续会再次回流出混合态。
- `paths` 若漏掉 `package.json` 或 `bun.lock`，会形成新的漏触发。

### 取舍

- 不抽象 reusable workflow：当前只有一条活跃 workflow，抽象收益低于复杂度成本。
- 不保留兼容层：你要求的是 Bun-native 零残留，失败路径必须显式。
- 不做全仓文本替换：只清理活跃 CI 语义中的残留，避免伤及真实业务内容。

## 成功标准

满足以下条件即视为本次设计目标达成：

1. 活跃 GitHub Actions workflow 不再安装或调用 Deno。
2. 活跃 workflow `paths` 不再引用 `deno.json` / `deno.lock`，并覆盖 `package.json` / `bun.lock` 等真实输入。
3. `README.md`、`docker/README.md`、`CLAUDE.md`、`.claude/rules/verification.md` 不再把 Deno 当作当前 CI 默认事实源。
4. 业务示例中合法存在的 Deno 文本被保留，没有被误清理。
5. 实施完成后，相关本地验证与 GitHub Actions 结果能证明 Docker 发布链重新可用。
