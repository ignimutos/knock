# Bun 单文件发布与 cold start 优化设计

## 背景

Knock 当前正式发布路径是 Docker 镜像，运行入口仍是 `bun src/container_main.ts`。当前链路有 3 个与目标直接冲突的点：

1. 运行产物不是单文件可执行，镜像 runtime 层仍携带 `src/`、`web/`、`node_modules/`、`.web-dist/` 等整套运行时文件。
2. `all` 模式虽然已经通过 supervisor 拉起 `web` 与 `daemon` 两个子进程，但底层仍是解释执行，启动成本里包含 Bun runtime 启动、模块解析与运行时文件读取。
3. Web 启动链路仍带有运行时兜底构建与磁盘资源依赖，不利于缩减 cold start，也阻碍单文件可执行稳定落地。

本设计的目标不是单纯“把发布物换个形态”，而是在保持外部 CLI / Docker 使用方式稳定的前提下，同时获得更小的 Docker 体积与更快的 `all` 模式 cold start。

## 目标

1. 同时产出两个正式发布物：
   - Linux x64 单文件可执行 `knock-linux-x64`
   - 基于该可执行的 Docker 镜像
2. 保持当前 CLI 契约稳定：继续支持 `--mode all|web|daemon`，并保持现有参数与失败路径语义。
3. 保持 `all` 模式行为模型稳定：仍由 supervisor 进程拉起 `web` 与 `daemon` 两个子进程，而不是改成单进程混跑。
4. 让生产主发布物默认走 Bun 编译优化路径，以获得显著的镜像体积收缩与 cold start 改善。
5. 将运行时可预计算工作前移到发布期，避免 runtime 再构建或再拼装关键 Web 资源。

## 非目标

1. 不改变当前配置契约，包括 `deliveries.<id>` canonical + `sources.<id>.deliveries` keyed override。
2. 不恢复 `templates` / `destinations` 等旧结构。
3. 不引入兼容层、双写、fallback 或旧入口保留。
4. 第一阶段不做 Linux arm64 发布物。
5. 不为了“理论最优”重画启动拓扑；当前 `all -> supervisor + web child + daemon child` 模型继续保留。
6. 不先行假设 daemon 初始化一定是主瓶颈；只有在测量证明确实成立后，才进入第二波 runtime 定点优化。

## 当前状态与阻塞点

### 正式发布物现状

当前正式发布链路仍以 Docker 为中心：

- `package.json` 通过 `docker:build` / `docker:size:check` / `image:prepare` 驱动镜像发布准备。
- `.github/workflows/docker.yml` 在 `verify -> image -> publish` 三层链路中只构建并发布 Docker 镜像。
- `Dockerfile` runtime 层目前仍复制 `node_modules`、`src`、`web` 与 `.web-dist`，入口是 `bun src/container_main.ts`。

这意味着当前镜像体积不仅包含应用逻辑，还包含大量解释执行所需的附属文件与依赖树。

### 启动架构现状

当前 `all` 模式已经具备适合编译后二进制沿用的启动骨架：

1. `src/container_main.ts` 进入 `runContainerEntrypoint()`。
2. `src/container_entrypoint.ts` 负责 raw argv 标准化与容器默认参数注入。
3. `src/main.ts` 解析 CLI 参数并分发到 startup orchestrator。
4. `src/interfaces/startup/startup_orchestrator.ts` 在 `all` 模式下拉起 `web` 与 `daemon` 两个 sibling 子进程，并在任一子进程异常退出时处理另一侧生命周期。
5. `src/platform/process.ts` 的 `spawnSelf()` 基于 `process.execPath` 自举当前程序。

这套模型的关键价值是：编译成单文件可执行之后，`spawnSelf()` 仍可继续复用当前二进制路径，不需要额外发明新的 supervisor 机制。

### 单文件可执行落地的已知阻塞点

当前代码里仍存在若干“运行时动态解析 / 动态装配”点，会直接阻碍 Bun `--compile` 产出稳定单文件可执行：

1. `src/interfaces/web/start_web.ts` 通过磁盘绝对路径动态 import `web/main.tsx`。
2. `web/main.tsx` 的 API route handler 仍通过 `await import()` 在请求时懒加载。
3. `web/main.tsx` 里的 client asset 仍从 `.web-dist/assets/client.js` 读磁盘文件。
4. `src/interfaces/web/start_web.ts` 在 `.web-dist/assets/client.js` 不存在时会运行时触发 `build:web`。

这些路径在解释执行模式下可工作，但在“单文件、最小镜像、低 cold start”的目标下都属于应移除的动态依赖。

## 设计原则

### 外部契约稳定，内部产物重构

用户与部署系统继续面向既有 CLI / Docker 契约工作；内部则允许把解释执行路径改成编译产物路径，并重排发布流程。

### 发布期做完运行期可预计算工作

凡是与运行输入无关、仅依赖源码与静态构建上下文即可得到的产物，都应在发布期完成，而不是留到容器 cold start 时再做。

### 单文件必须名副其实

如果目标产物宣称为单文件可执行，则运行时不应再隐式依赖 `src/`、`web/`、`.web-dist/` 或 `node_modules/` 中的额外 sidecar 文件。

### 先做高确定性收益，再决定第二波深入优化

第一波优先收取确定性最大的收益：编译、最小镜像、去掉运行时 Web 构建、去掉动态 import / 动态资源读取。只有在新的基线跑出来后，才决定是否继续做 daemon 初始化深挖。

## 一、发布物形态

正式发布物调整为两类：

1. **单文件可执行**：`knock-linux-x64`
2. **Docker 镜像**：以该可执行为入口的 Linux x64 运行镜像

Docker 仍保留为正式发布物，因为当前主要运行环境仍是 Linux x64 Docker；但镜像的运行核心从 `bun + 源码树` 切换为 `compiled binary + 最小运行资源`。

## 二、启动架构

### 保持当前 CLI 形态

保留现有入口语义：

- `--mode web`
- `--mode daemon`
- `--mode all`

当前 `container_entrypoint -> main -> startup_orchestrator` 的分层继续保留，避免把这次工作扩大成启动架构重写。

### 保持 `all` 模式的 supervisor 模型

`all` 模式继续由父进程拉起两个 sibling 子进程：

- 一个 `web` 子进程
- 一个 `daemon` 子进程

保留该模型的原因：

1. 当前行为已存在，变更面最小。
2. 失败传播、sibling termination 与 CLI 语义已通过现有代码与测试承载。
3. `spawnSelf()` 基于 `process.execPath`，编译后二进制仍可自然复用，不需要额外引入 wrapper shell 或额外 supervisor 可执行文件。

## 三、编译产物策略

生产主产物默认使用 Bun 编译优化路径：

```bash
bun build ./src/container_main.ts \
  --compile \
  --target=bun-linux-x64 \
  --minify \
  --bytecode \
  --outfile ./dist/knock-linux-x64
```

设计含义：

- `--compile`：产出 standalone executable。
- `--minify`：压缩 transpiled output，优先服务体积目标。
- `--bytecode`：把部分解析成本从 runtime 前移到 build time，优先服务 cold start 目标。
- 生产主产物默认 **不带 sourcemap**，避免把调试体积与附加解析成本带入主发布物。

如需排障，单独提供 debug 构建变体，而不是把 sourcemap 混入默认生产发布物。

## 四、Web 资源前移与嵌入

### 取消运行时兜底 `build:web`

当前 `start_web.ts` 会在 `.web-dist/assets/client.js` 不存在时触发 `bun run build:web`。该行为对开发期友好，但对生产 cold start 不利，也会使运行时依赖构建工具链。

设计上改为：

1. 发布期必须先完成 `build:web`。
2. 生产运行期若缺少所需 Web 资源，应直接视为发布链路错误，而不是运行时自修复。
3. 开发期如仍需要懒构建体验，应由开发专用路径承载，而不是继续污染生产启动链路。

### client asset 改为编译期嵌入

当前 `web/main.tsx` 通过读取 `.web-dist/assets/client.js` 响应 `/assets/client.js`。目标形态改为：

1. 发布期生成确定的 client 产物。
2. 编译期把该 JS 资源纳入可执行文件，运行时直接从嵌入资源返回响应。
3. Docker 镜像不再需要单独携带 `.web-dist/` 目录。

这样既减小运行镜像的文件数，也去掉了服务启动与请求处理对磁盘 sidecar 资源的依赖。

## 五、动态 import 收敛为静态可见依赖

### `start_web.ts` 的 Web 入口加载

当前 `start_web.ts` 按磁盘路径动态 import `web/main.tsx`。设计上改为静态 import，使 Bun 编译阶段能看到 Web 入口依赖图。

### `web/main.tsx` 的 API route handler 懒加载

当前多个 API route 使用 `await import()` 按请求懒加载 handler。设计上改为：

1. 顶层静态 import 所有正式路由 handler。
2. 以固定路由表 dispatch 请求。
3. 不再把路由处理器存在性建立在运行时模块解析之上。

这个调整的主要目的不是追求请求期极致性能，而是让编译产物闭包完整、可分析、可嵌入。

## 六、Docker 运行镜像最小化

新 Docker runtime 层仅保留：

1. 编译后的 `knock-linux-x64`
2. 运行所需证书与时区数据
3. 运行目录 `/app/runtime`

不再复制：

- `src/`
- `web/`
- `node_modules/`
- `.web-dist/`
- `package.json` / `bun.lock` / `tsconfig.json`

预期收益：

1. 镜像下载体积下降
2. 容器文件系统展开量下降
3. 运行期文件扫描与模块解析依赖下降
4. 启动入口更短：从“启动 Bun 再解释源码”缩为“直接执行编译产物”

## 七、两阶段性能策略

### Phase 1：高确定性收益

第一阶段只收取以下高确定性收益：

1. 引入 Linux x64 单文件可执行正式产物
2. 让 Docker 镜像改以该可执行为入口
3. 移除运行时 `build:web`
4. 嵌入 Web client 资源
5. 收敛正式运行路径上的动态 import
6. 建立体积与 cold start 基线对比脚本 / smoke 验证

### Phase 2：条件触发的 daemon 初始化优化

若 Phase 1 后测量仍显示 daemon 初始化是 cold start 主瓶颈，再进入第二阶段，对以下环节做 profiling 驱动的定点优化：

- `loadCompiledConfig`
- logging runtime bootstrap
- `createProductionRuntime`
- `recoverInterruptedAttempts`
- facts DB / sqlite 启动前检查

第二阶段是否启动取决于测量，不在本设计里预先承诺具体实现手段。

## 执行顺序

1. **编译阻塞点清理**
   - 收敛 `start_web.ts` 的动态入口加载
   - 收敛 `web/main.tsx` 的动态 route import
   - 收敛 client asset 磁盘读取与运行时 `build:web`
2. **单文件可执行构建链路**
   - 增加编译脚本与产物命名
   - 形成 Linux x64 正式 binary
3. **Docker runtime 切换**
   - 用 binary 替换 `bun src/container_main.ts`
   - 缩减 runtime 镜像内容
4. **验证与门禁更新**
   - 增加 binary smoke
   - 增加 cold start 基线对比
   - 保留现有镜像体积门禁并补充相对收缩目标

## 验证方案

### Ready 定义

本轮 cold start 的 ready 定义为：

1. 容器以 `--mode all` 启动
2. Web `/config` 可访问
3. 返回内容包含当前 ready 标记 `Knock Config`
4. daemon 侧已完成初始化且未异常退出

这样可以避免“端口刚监听但后台初始化尚未完成”的假快。

### 产物验证

#### 单文件可执行 smoke

至少覆盖：

1. `knock-linux-x64 --mode web`
2. `knock-linux-x64 --mode daemon`
3. `knock-linux-x64 --mode all`

#### Docker smoke

至少覆盖：

1. 构建镜像
2. 容器启动到 `/config` ready
3. `all` 模式下 web / daemon 任一失败时仍保持现有失败传播语义

### 体积验证

当前仓库已经有镜像体积门禁，默认上限为 450 MB。新设计保留该硬门槛，并增加相对基线目标：

- 新镜像体积相对当前主发布物基线下降 **30%+**

### 启动时间验证

在同一台 Linux x64 机器上、固定同一 config / runtime 数据，分别测量“旧镜像”与“新镜像”从 `docker run` 到 ready 的耗时：

- 每组至少多次运行
- 以中位数作为比较值
- 目标为 cold start 相对当前下降 **30%+**

### 回归验证

本轮最终回归至少包括：

1. `bun run verify:full`
2. `bun run test`
3. binary smoke
4. docker smoke

若改动命中 `package.json`、`Dockerfile`、`src/main.ts`、`src/container_entrypoint.ts` 等共享高影响边界，维持全量 `bun run test` 为收尾门槛。

## 风险与取舍

### 风险

1. **编译通过但嵌入资源闭包不完整**
   - 若仍遗漏运行时动态依赖，单文件可执行在 smoke 时才会暴露缺件问题。
2. **解释执行与编译执行行为存在边角差异**
   - 尤其是与 `spawnSelf()`、环境变量透传、错误文案和路径解析相关的边界。
3. **体积下降明显但 cold start 改善不足**
   - 说明真正主瓶颈更多在 daemon 初始化而非 packaging；这时需要进入第二阶段 profiling，而不是回退单文件方案。
4. **调试可见性下降**
   - 生产主产物不带 sourcemap，会降低直接在生产产物上阅读原始堆栈映射的便利性。

### 取舍

1. **保留 supervisor 双子进程模型**
   - 牺牲一部分“单进程理论最简”，换取最小迁移成本与现有语义稳定。
2. **生产主产物不带 sourcemap**
   - 优先服务体积与启动；调试能力由单独 debug 产物承载。
3. **不先做深度 runtime 重构**
   - 先收高确定性收益，避免在尚未看到新基线前做大范围推测式优化。

## 成功标准

满足以下条件即可视为本次设计落地成功：

1. 仓库能正式产出 Linux x64 单文件可执行与基于该可执行的 Docker 镜像。
2. 外部 CLI 契约、`all|web|daemon` 模式与主要失败路径语义保持稳定。
3. 新 Docker 镜像相对当前基线体积下降 **30%+**。
4. `all` 模式容器 cold start 到 ready 相对当前基线下降 **30%+**。
5. 生产运行路径不再依赖运行时 `build:web`、`.web-dist` sidecar、正式路由动态 import 与磁盘路径动态入口 import。
6. `bun run verify:full`、`bun run test`、binary smoke 与 docker smoke 全部通过。

## 额外决策

1. 本轮 CI 与正式发布范围只要求产出主发布 binary；debug binary 若需要，作为后续独立增强，不阻塞本轮落地。
2. 基线对比脚本不要求长期暴露为稳定 `package.json` 公共入口；若为本轮迁移辅助而新增，应优先做成可移除的内部验证脚本。
3. 若 Phase 1 已达到体积与 cold start 目标，本轮默认不继续展开 daemon 初始化 profiling；该工作转为后续独立优化议题。
