# release runtime 目录权限预检设计

## 背景

Knock 的 release 脚本会把宿主机临时目录挂到容器内的 `/app/runtime`。镜像 runtime 层以非 root 用户 `knock` 运行；若宿主目录保留 `mktemp -d` 默认的 `0700`，则即使 `config.yml` 自身是 `0644`，容器内进程仍会因为无法穿越目录而在读取 `/app/runtime/config.yml` 时触发 `EACCES`。

当前风险点不在应用代码，而在脚本层：runtime 目录权限需要在每次创建后被显式修正，并在 `docker run` 前做一次快速失败校验，避免把权限问题延后到容器日志里才暴露。

## 目标

1. 只在当前两个 release 脚本内解决 runtime 目录权限问题：
   - `scripts/release/smoke_image.sh`
   - `scripts/release/measure_cold_start.sh`
2. 每次创建临时 runtime 目录后，都显式设置目录与 `config.yml` 权限。
3. 每次真正 `docker run` 前，都显式检查目录、文件与权限是否满足脚本预期。
4. 保持现有脚本入口、参数与测量逻辑稳定，不扩大为通用 helper 重构。

## 非目标

1. 不修改应用运行时代码。
2. 不抽取新的共享 shell helper 文件。
3. 不改 Docker 镜像用户模型；镜像继续以非 root 用户运行。
4. 不试图自动修复用户自定义 compose 文件或仓库外部署脚本。

## 设计原则

### 脚本内就地修复

问题面只落在当前两个 release 脚本，因此直接在脚本内完成权限准备与断言，避免为一个很小的行为引入新的共享抽象。

### 失败前移

权限异常必须在 `docker run` 之前直接失败，并给出明确报错；不接受“先启动容器，再从容器日志倒推目录权限”的反馈回路。

### 保持现有权限语义

当前脚本已采用最宽松且稳定的临时目录策略：目录 `0777`、`config.yml` `0666`。本次不收紧语义，只把这套策略收敛成显式准备与显式校验，避免后续编辑时被无意删掉或改坏。

## 方案对比

### 方案 A：只改两个脚本内联处理与检查

在每个脚本里把 runtime 权限准备与校验做成局部函数或局部步骤，`mktemp -d` 后立即调用，`docker run` 前再次断言。

优点：

- 改动最小。
- 直接覆盖当前故障面。
- 不引入额外共享接口。

缺点：

- 两个脚本会有少量重复逻辑。

### 方案 B：抽共享 helper

把 runtime 权限准备与检查抽成一个共用 shell 文件，再由两个脚本 source。

优点：

- 复用更强。

缺点：

- 为很小的问题新增共享边界。
- 会扩大本次改动面。

### 结论

采用方案 A。

## 具体设计

### 一、权限准备步骤

每个脚本在以下顺序中处理 runtime 目录：

1. `runtime_dir="$(mktemp -d)"`
2. 写入 `"$runtime_dir/config.yml"`
3. 显式执行：
   - `chmod 0777 "$runtime_dir"`
   - `chmod 0666 "$runtime_dir/config.yml"`

这一步是根因修复本体：确保容器内非 root 用户对 bind mount 目录具备足够访问能力。

### 二、启动前检查步骤

每个脚本在真正 `docker run` 前增加一次显式检查，失败即退出。检查内容固定为：

1. `runtime_dir` 必须存在且是目录。
2. `config.yml` 必须存在且是普通文件。
3. `stat` 读取到的权限模式必须与脚本刚设置的一致：
   - 目录：`777`
   - 文件：`666`

若任一条件不成立，脚本直接输出清晰错误并退出，不进入容器启动阶段。

之所以检查“与脚本预期一致”，而不是做模糊的“看起来差不多能读”，是因为这两个脚本本身已经选择了固定权限策略；保持断言与设置完全一致，最容易发现回归。

### 三、落点

#### `scripts/release/smoke_image.sh`

在创建 runtime 目录并写入 `config.yml` 后，增加：

- runtime 权限准备
- runtime 权限断言

这样 `smoke image` 在启动镜像前就能把 mount 权限问题拦下。

#### `scripts/release/measure_cold_start.sh`

在 `measure_once()` 的每次采样里，对临时 runtime 目录执行同样的准备与断言。

这样每个 cold-start 样本都在相同的 runtime 权限前提下运行，既避免偶发权限失败，也保证测量基线一致。

## 测试与验证

### 测试策略

按 TDD 执行：

1. 先补脚本相关测试，覆盖“runtime 创建后会被修正到预期权限，并在启动前执行权限断言”。
2. 先看测试以缺失该行为的方式失败。
3. 再做最小实现。
4. 再跑通过后的最窄验证。

### 最小验证集

实现后至少运行：

1. 命中脚本相关测试的最窄 `bun run test:path -- <paths>`
2. `bun run fmt:check:path -- scripts/release/smoke_image.sh scripts/release/measure_cold_start.sh <test-paths>`
3. 如命中 TypeScript 测试文件，再补 `bun run check`

若改动触及共享发布/镜像验证边界，再按仓库规则补更高层验证。

## 风险与取舍

1. 使用固定 `0777/0666` 看起来偏宽，但目录来自脚本临时目录，生命周期短，且当前目标是消除容器用户访问歧义；本次不引入更复杂的 owner / gid 协调逻辑。
2. 断言 exact mode 会比“只检查可读”更严格，但更能防回归；一旦未来决定收紧权限策略，只需同步修改设置与断言，而不是在模糊规则上继续猜测。

## 实施结果预期

完成后，两个 release 脚本都应满足：

1. 每次创建临时 runtime 目录都会显式修正权限。
2. 每次启动容器前都会显式校验权限。
3. 权限异常会在脚本层即时失败，而不是以容器内 `EACCES` 形式延后暴露。
