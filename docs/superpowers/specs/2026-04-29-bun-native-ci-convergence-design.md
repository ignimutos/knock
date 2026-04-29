# Bun-owned CLI 执行收敛设计

## 背景

仓库从 Deno 路径切到 Bun 之后，`package.json` 中的部分脚本虽然通过 `bun run` 触发，但实际执行的外部 JavaScript CLI 仍可能按 shebang 落到 Node。对普通命令这通常只是实现细节；但对 `vite build --configLoader native` 这类把 TypeScript 配置文件交给底层运行时原生加载的路径，底层到底是 Deno、Bun 还是 Node，会直接决定行为是否稳定。

这次故障的根因就是这个漂移：Deno 时代 `vite` 由 Deno 执行，`vite.config.ts` 可被原生加载；切到 Bun 后，脚本默认落到环境里的 Node，CI 与本地 Node 能力不一致，于是 `vite.config.ts` 在 CI 中报 `Unknown file extension ".ts"`。

## 目标

1. 让当前会被 `package.json` 调用的外部 JavaScript CLI 明确由 Bun 执行。
2. 消除本地与 CI 对 shebang / runner 默认 Node 的隐式依赖。
3. 保持现有脚本名、参数接口与验证编排稳定。
4. 让 `setup-bun` 成为验证链路唯一需要的 JavaScript 运行时前提。

## 非目标

1. 不新增 `setup-node`，不把稳定性建立在额外固定 Node 版本上。
2. 不修改 workflow 拓扑，不改 `verify:scoped` / `verify:full` / `image:prepare` 的编排。
3. 不顺手清理与这次运行时归属无关的脚本。
4. 不增加兼容层、fallback 或双运行时保底。

## 范围

### 纳入本次修改

- `package.json`
  - `build:web`
  - `check`
  - `fmt`
  - `fmt:path`
  - `fmt:check`
  - `fmt:check:path`

### 明确保持不变

- `lint` / `lint:check` / `lint:check:path`
- `test` / `test:path` / `test:arch` / `test:startup`
- `verify:scoped` / `verify:full`
- `.github/workflows/docker.yml` 的 job 拓扑与 `setup-bun` 前提

## 现状与风险扫描

当前主仓库里需要外部 CLI 处理的 TypeScript 配置文件只有 `vite.config.ts`。没有 `prettier.config.ts`、`eslint.config.ts`、`vitest.config.ts` 之类会把同样问题扩散到更多工具的配置文件。因此：

- `vite` 是当前唯一已经证实会踩到“native loader + TypeScript config + 底层运行时漂移”问题的命令。
- `tsc` 当前读取的是 `tsconfig.json`，不依赖 TypeScript 配置文件的原生执行。
- `prettier` 当前也没有仓库内 TypeScript 配置文件需要原生加载。

即便如此，这次仍把 `tsc` 和 `prettier` 一并收敛到显式 Bun 执行，因为目标不只是修一个点，而是消除同类隐式运行时归属。

## 设计原则

### 显式运行时归属

凡是通过 `package.json` 触发、且本质上由 JavaScript CLI 执行的命令，都应在脚本层显式声明由 Bun 运行，而不是依赖 shebang、PATH 顺序或 runner 自带 Node。

### 稳定脚本契约

只改脚本实现，不改脚本名。workflow、文档、开发者心智模型继续依赖现有脚本入口。

### 最小完整修复

只改会暴露运行时漂移的 CLI 入口，不扩大到与本问题无关的命令。

## 方案设计

### 脚本收敛

把以下脚本改为 Bun 显式执行：

| 脚本             | 现状                                                   | 目标                                                             |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `build:web`      | `vite build --configLoader native` 或 `vite build`     | `bun --bun vite build --configLoader native`                     |
| `check`          | `tsc --project tsconfig.json`                          | `bun --bun tsc --project tsconfig.json`                          |
| `fmt`            | `prettier --write .`                                   | `bun --bun prettier --write .`                                   |
| `fmt:check`      | `prettier --check .`                                   | `bun --bun prettier --check .`                                   |
| `fmt:path`       | `bash ./scripts/run-paths.sh prettier --write -- . --` | `bash ./scripts/run-paths.sh bun --bun prettier --write -- . --` |
| `fmt:check:path` | `bash ./scripts/run-paths.sh prettier --check -- . --` | `bash ./scripts/run-paths.sh bun --bun prettier --check -- . --` |

### 为什么不改 lint

`oxlint` 是独立 CLI，不依赖仓库内 TypeScript 配置文件的原生加载能力，也不是这次已观察到的漂移点。把它纳入不会增加明显价值，反而扩大变更面。

### 为什么不改 workflow

一旦外部 JavaScript CLI 的归属在 `package.json` 中被显式声明为 Bun，CI 只需继续提供 `setup-bun` 即可。workflow 不需要再通过 `setup-node` 去兜底 shebang 落到 Node 的路径。

## 执行流

1. 开发者或 CI 调用 `bun run <script>`。
2. `package.json` 中的目标脚本再通过 `bun --bun` 显式执行对应 CLI。
3. `vite` / `tsc` / `prettier` 的底层运行时统一落到 Bun，而不是环境默认 Node。
4. `verify:scoped` / `verify:full` 继续按现有编排执行，但其内部外部 CLI 的归属已稳定。

## 验证计划

### 最窄相关验证

1. `bun run build:web`
2. `bun run check`
3. `bun run fmt:check:path -- package.json`

### 共享高影响边界补充验证

由于 `package.json` 属于共享高影响边界，收尾前追加：

1. `bun run verify:full`
2. `bun run test`

### 直接探针

为确认 CLI 确实可被 Bun 接管，可额外运行：

1. `bun --bun vite --version`
2. `bun --bun tsc --version`
3. `bun --bun prettier --version`

## 风险与取舍

### 风险

1. 某些 CLI 在 Bun 下的输出文案、错误格式可能与 Node 有细微差异。
2. 若将来新增 `prettier.config.ts` 等 TypeScript 配置文件，相关路径仍应继续保持显式 Bun 归属，不能回退到默认 shebang 行为。

### 取舍

1. 不加 `setup-node`：避免把运行时一致性分散到 workflow 环境层，而不是脚本契约层。
2. 一并收敛 `tsc` / `prettier`：虽然它们当前未复现同类故障，但这样能统一心智模型并减少未来漂移。
3. 不扩到 `oxlint`：保持最小完整改动。

## 成功标准

满足以下条件即可认为本次收敛完成：

1. `package.json` 中纳入范围的脚本都显式通过 Bun 执行对应 CLI。
2. `build:web` 在本地与 CI 不再依赖 runner 默认 Node 来加载 `vite.config.ts`。
3. `bun run verify:full` 与 `bun run test` 能在修改后继续通过。
4. workflow 不需要新增 `setup-node` 也能维持当前验证链路。
