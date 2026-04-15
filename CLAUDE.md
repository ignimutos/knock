# CLAUDE.md

## Canonical scope

- `CLAUDE.md` 是本仓库唯一的 **canonical tracked agent-instruction surface**。
- 关键字 `MUST` / `MUST NOT` / `SHOULD` / `SHOULD NOT` / `MAY` 按 RFC 2119 解释。
- 其他表面（如本地插件、skills、历史目录）可以存在并被使用，但 **MUST NOT** 与本文件形成竞争性规则源。

## Project-specific workflow

- 当标准 task 存在时，agents **MUST** 优先使用 `deno task`。
- 对 `check` / `fmt:check` / `lint:check` / `test` 的直接调用，agents **MUST** 优先使用受影响路径。
- 非平凡任务（多文件、接口/状态变化、重构）agents **SHOULD** 先给出简短计划（目标 / 实现 / 验证）。
- 细节规则 **SHOULD** 放在 `.claude/rules/*.md`；本文件只保留顶层项目约束。

## Project-only contracts

- 当前配置模型 **MUST** 保持 `deliveries.<id>` canonical + `sources.<id>.deliveries` keyed override。
- **MUST NOT** 恢复 `templates` / `destinations` 等旧结构。
- **MUST** 保留 `${ENV_VAR}` 展开语义。
- 除非任务明确要求，CLI 与配置契约 **MUST** 保持稳定，失败路径 **MUST** 可见。

## Verification boundaries

- docs-only 改动 **MUST** 做路径与命令一致性检查。
- code changes **MUST** 先跑最窄相关验证。
- 命中共享高影响边界时 **MUST** 追加全量 `deno task test`。
- 最终交付 **SHOULD** 明确已运行验证、未运行验证与剩余风险。

## CI reality

- 当前仓库工作流：`.github/workflows/docker.yml`。
- CI 目前聚焦 Docker build / push。
- 本地验证基线仍由 `fmt:check`、`lint:check`、`check`、`test` 负责。
