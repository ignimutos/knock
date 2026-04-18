# Final Rewrite Architecture Tail Design

## Goal

收掉 final rewrite 主线完成后剩余的 3 个架构尾巴：

1. `DefinitionSet.policies` 不再只是 compiler 产物，而要进入 composition/runtime wiring 的真实决策。
2. `src/composition/*` 不再反向依赖 `src/interfaces/*`。
3. `QueryRunsUseCase` / `PruneFactsUseCase` 先完成最薄的 runtime provider 接线，但不扩展新的 CLI/web surface。

本轮目标是**最小收口**，不是继续扩 scope。

## Non-goals

- 不新增 CLI query/prune 命令
- 不新增 web/debug query/prune route
- 不扩 `QueryRuns` 或 `PruneFacts` 的 contract surface
- 不改现有 config 外部 shape
- 不引入 compatibility layer 或双 shape

## Current Gaps

### 1. `DefinitionSet.policies` 未被消费

`compileDefinitionsFromResolvedConfig()` 已生成 preview/production policy，但 `load_definitions.ts` 当前直接丢弃 `policies`，composition 仍靠散落约定决定哪些路径允许 facts/dedupe/external side effects。

这使得“单一装配输入”的目标没有完全落地。

### 2. composition 仍反向依赖 interfaces

`src/composition/create_runtime_kernel.ts` 当前仍 import：

- `src/interfaces/config/load_definitions.ts`
- `src/interfaces/source_runtime_helpers.ts`

最终架构要求 interfaces 是薄 IO 层，不应反向参与 composition 内核依赖链。

### 3. Query/Prune 只建能力，未接到 runtime provider

`QueryRunsUseCase` 与 `PruneFactsUseCase` 及其底层 SQLite 实现已存在，但当前主要停留在 application/infrastructure 与测试层，runtime/composition 还没有把它们作为正式 provider 暴露。

## Design

## 1. 让 `DefinitionSet` 成为 composition 的真实输入

### Decision

composition 不再通过 `buildLoadedDefinitionsFromResolvedConfig()` 拿一个被裁剪过的 shape，而是直接使用 `compileDefinitionsFromResolvedConfig()` 的完整 `DefinitionSet`。

### Resulting rule

- `DefinitionSet.sources` / `deliveries` / `bindings` / `sourceConfigsById` / `policies` 共同构成 composition 输入
- preview/production 的副作用边界由 `DefinitionSet.policies` 表达，不再在 composition 内部重新发明并行布尔语义

### Scope of policy consumption in this round

本轮只消费已有稳定字段：

- `preview.persistFacts=false`
- `preview.writeDedupe=false`
- `preview.allowExternalSideEffects=false`
- `preview.exposeToRecovery=false`
- `preview.exposeToPrune=false`
- `production.*=true`

### How to apply

- preview composition 继续使用 in-memory facts + capture executor，但这些选择不再只是“约定”，而要与 preview policy 一致
- production composition 暴露 recovery/prune/query provider 时，只在 production policy 可见域内提供
- 本轮**不**做 policy 的动态多态扩展；只把现有 preview/production 两套常量接入 wiring

## 2. 去掉 composition → interfaces 反向依赖

### Decision

将 runtime kernel 需要的“共享 runtime helper”收回 `src/composition/` 或 `src/definitions/`，不再从 `src/interfaces/*` 借位。

### File moves / replacements

#### A. definitions side

- `create_runtime_kernel.ts` 改为直接依赖 `compileDefinitionsFromResolvedConfig`
- `load_definitions.ts` 保留为 interface bridge，只服务仍需要旧外表面的 callers
- composition 不再 import `load_definitions.ts`

#### B. runtime helper side

把当前 `interfaces/source_runtime_helpers.ts` 中仅属于 runtime wiring 的 helper 移到 composition 邻近位置，例如：

- `src/composition/runtime_source_helpers.ts`

至少包括：

- `resolveSourceConfig`
- `selectSourceInputGateway`

### Boundary rule

完成后：

- `src/composition/*` MAY 依赖 `config/`, `definitions/`, `application/`, `domain/`, `infrastructure/`, `core/`
- `src/composition/*` MUST NOT 依赖 `src/interfaces/*`

## 3. 给 QueryRuns / PruneFacts 做最薄 runtime provider 接线

### Decision

这轮不直接开放用户可见入口，只在 production runtime/composition 内把它们接成正式 provider。

### Why

这样能完成“能力进入 runtime 主装配”的收口，同时避免把 scope 扩展到新的 CLI/web/query UX 设计。

### Runtime exposure shape

`ProductionRuntime` 新增：

- `queryRunsUseCase`
- `pruneFactsUseCase`

其中：

- `queryRunsUseCase` 由 `createSourceRunQueryService(factsDb)` 装配
- `pruneFactsUseCase` 由 `createPruneFactsRepository(factsDb)` + `now()` 装配

### Constraints

- 不新增 `main.ts` 子命令
- 不新增 web routes
- 不修改现有 daemon lifecycle
- 仅暴露 provider，供后续 CLI/web/debug 接线使用

## 4. Tests and verification

### Required test updates

- `src/definitions/compile_definitions_test.ts`
  - 继续锁 `policies`
- `src/interfaces/config/load_definitions_test.ts`
  - 仍锁 bridge 行为，但明确 composition 不依赖它
- `src/composition/create_runtime_kernel_test.ts`
  - 锁新的 helper 落点与无 `interfaces/*` 反向依赖后的行为
- `src/composition/create_preview_runtime_test.ts`
  - 锁 preview policy 对 facts/side-effect 语义的一致性
- `src/composition/create_production_runtime_test.ts`
  - 新增 `queryRunsUseCase` / `pruneFactsUseCase` provider 暴露断言

### Verification commands

最窄相关验证优先：

```bash
deno task test src/definitions/compile_definitions_test.ts src/interfaces/config/load_definitions_test.ts src/composition/create_runtime_kernel_test.ts src/composition/create_preview_runtime_test.ts src/composition/create_production_runtime_test.ts src/infrastructure/sqlite/source_run_query_service_test.ts src/infrastructure/sqlite/prune_facts_repository_test.ts
```

然后补：

```bash
deno task check src/composition src/definitions src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts src/infrastructure/sqlite/source_run_query_service.ts src/infrastructure/sqlite/prune_facts_repository.ts src/main.ts
```

```bash
deno task lint:check src/composition src/definitions src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts src/infrastructure/sqlite/source_run_query_service.ts src/infrastructure/sqlite/prune_facts_repository.ts src/main.ts
```

```bash
deno task fmt:check src/composition src/definitions src/interfaces/config/load_definitions.ts src/interfaces/config/load_definitions_test.ts src/infrastructure/sqlite/source_run_query_service.ts src/infrastructure/sqlite/prune_facts_repository.ts src/main.ts docs/superpowers/specs/2026-04-18-final-rewrite-architecture-tail-design.md
```

若代码触达 `src/main.ts` / shared startup boundary，则收尾前仍补全量：

```bash
deno task test
```

## Acceptance criteria

以下条件全部满足时，本轮 architecture tail cleanup 才算完成：

1. `DefinitionSet.policies` 被 composition/runtime wiring 真实消费，而不是只生成后丢弃。
2. `src/composition/*` 不再 import `src/interfaces/*`。
3. `ProductionRuntime` 能暴露 `queryRunsUseCase` 与 `pruneFactsUseCase`。
4. `QueryRuns` / `PruneFacts` 没有扩出新的用户可见 surface。
5. 相关 scoped `test/check/lint/fmt` 全绿。
6. 收尾全量 `deno task test` 全绿。

## Recommended implementation plan shape

后续 implementation plan 应拆成 3 个连续任务：

1. consume DefinitionSet policies in composition
2. move runtime helper dependencies out of interfaces
3. expose query/prune providers from production runtime and verify
