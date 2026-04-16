# Runtime / Pipeline Refactor Execution Plan

> **For agentic workers:** 每个 Batch 应独立执行、独立验证、独立收口。不要把多个 Batch 混进同一实现会话。

**Goal:** 以最小返工风险收敛 Knock 当前 runtime / pipeline / delivery / config 主链结构：先稳 `RunSourceUseCase`，再补 pipeline 边界测试，再收 delivery payload 契约，随后做 runtime helper / 骨架去重与 production fail-fast，最后收 config 语义表达。

**Strategy:** 计划一次性定全，代码按 Batch 分批执行。每个 Batch 都必须满足 scoped verification 与停手条件后，再进入下一批。

---

## Execution Order

1. **Batch 1** — `RunSourceUseCase` collect / apply 分层
2. **Batch 2** — pipeline 边界与边界测试
3. **Batch 3** — delivery payload 契约收硬（先收 email executor）
4. **Gate A + Gate B** — definitions 输出契约与 daemon/preview 一致性冻结
5. **Batch 4** — runtime helper / source execution core 去重 + production fail-fast
6. **Batch 5** — config 语义链收敛

---

## Batch 1 — Split collect from apply

### Goal

把 `RunSourceUseCase` 从“单个 execute 承担 collect + apply”收成清晰的两段式结构。

### Files to change

- `src/application/run_source_use_case.ts`
- `src/application/run_source_use_case_test.ts`
- `src/application/preview_source_use_case.ts`
- `src/application/preview_source_use_case_test.ts`
- `src/application/run_due_sources_use_case_test.ts`（通常只回归，不一定改）

### Work

- 新增 `collect(input)`，只做 `plan + fetch + parse`
- `getTaskFiveDeps()` 改名为 `getPipelineDeps()`
- 抽出 `applyCollected(collected, pipelineDeps)`
- `execute()` 改为：`collect + optional apply`
- 预留 preview wrapper 的 `collect` 依赖位，但不在本批切换行为

### Tests to add/update

- `collect()` 只走 fetch/parse
- `execute()` 缺 pipeline deps 时退化为 collect
- collect 必先于 apply

### Verification

```bash
deno task test src/application/run_source_use_case_test.ts
deno task test src/application/preview_source_use_case_test.ts
deno task test src/application/run_due_sources_use_case_test.ts
```

### Stop condition

- `RunSourceUseCase` 内已经有 `collect()` / `applyCollected()` 分层
- `execute()` 两段式可读
- 三条新 contract tests 通过
- preview / due-source 回归通过
- 未混入 pipeline / payload / runtime / config 其他改动

### Risks

- 把 preview 轻路径误伤成强制 full-execute
- 顺手改太多 helper 导致 diff 膨胀

---

## Batch 2 — Strengthen pipeline boundary

### Goal

把 item 级 pipeline 收成稳定边界，并把主测试重心转向主链语义。

### Files to change

- `src/application/run_source_use_case.ts`
- `src/application/run_source_use_case_test.ts`
- 可能小改：
  - `src/application/stages/filter_stage.ts`
  - `src/application/stages/deduplication_stage.ts`
  - `src/application/stages/render_stage.ts`
  - `src/application/stages/delivery_stage.ts`

### Work

- 在 `applyCollected()` 内抽出：
  - `processItem(...)`
  - `processDeliveriesForItem(...)`
  - `finalizeItemStatus(...)`
- 把主链边界测集中到 `run_source_use_case_test.ts`
- 保持 stage 文件作为局部契约承载，但不再让主心智停留在 stage 碎片上

### Tests to add/update

- filter 短路
- item duplicate 短路
- delivery duplicate 不 dispatch
- no bindings -> skipped/no_deliveries
- delivered -> register item fingerprint
- finalize counts / logs 一致

### Must keep

以下 tests 在本批不可删除：

- `src/application/stages/deduplication_stage_test.ts`
- `src/application/stages/render_stage_test.ts`
- `src/application/stages/delivery_stage_test.ts`

### Verification

```bash
deno task test src/application/run_source_use_case_test.ts
deno task test src/application/stages/deduplication_stage_test.ts
deno task test src/application/stages/render_stage_test.ts
deno task test src/application/stages/delivery_stage_test.ts
deno task test src/application/preview_source_use_case_test.ts
deno task test src/application/run_due_sources_use_case_test.ts
```

### Stop condition

- item 级 pipeline 语义已集中在稳定边界方法中
- 主链边界测试覆盖关键状态流转
- stage 浅测试未被过早删除

### Risks

- 只重排代码，不增加真实边界测试
- 把 stage 契约误当成可删冗余

---

## Batch 3 — Harden delivery payload contracts

### Goal

先收 email executor，正式把 delivery payload 契约从“宽对象 + fallback”收成“canonical shape only”。

### Files to change

- `src/infrastructure/deliveries/email_delivery_executor.ts`
- `src/infrastructure/deliveries/email_delivery_executor_test.ts`
- `src/application/stages/render_stage.ts`
- `src/application/stages/render_stage_test.ts`
- `src/application/run_source_use_case_test.ts`
- 如确有必要，再最小改：
  - `src/application/ports/delivery_executor.ts`
  - `src/domain/delivery_attempt.ts`

### Work

- 删除 email executor 的 `payload.message ?? payload` fallback
- 明确 email executor 只接受 `{ smtp, message }`
- 强化 RenderStage 的 email canonical shape 命名与测试
- 增加一条 email 主链路 contract，证明 canonical shape 贯通

### Verification

```bash
deno task test src/infrastructure/deliveries/email_delivery_executor_test.ts
deno task test src/application/stages/render_stage_test.ts
deno task test src/application/run_source_use_case_test.ts
deno task test src/infrastructure/deliveries/http_delivery_executor_test.ts
deno task test src/infrastructure/deliveries/file_delivery_executor_test.ts
deno task test src/application/stages/delivery_stage_test.ts
```

若命中共享类型：

```bash
deno task check src/application src/infrastructure src/domain
```

### Stop condition

- email fallback 已移除
- email canonical payload shape 已锁定
- file/http executor 未被误伤

### Risks

- 旁路 legacy shape 在运行时暴露
- 顺手把 payload 类型系统改成过大 diff

---

## Gate A — Freeze `load_definitions` outputs

### Goal

在 runtime 去重前先锁 definitions 输出契约，避免 Batch 4 与 Batch 5 互相返工。

### Files to change

- `src/interfaces/config/load_definitions_test.ts`

### Work

锁住：

- `sources` shape
- `deliveries` shape
- `bindings` shape
- push `requestType` 默认值
- binding 不混入 `profile/effectDomain/trigger`

### Verification

```bash
deno task test src/interfaces/config/load_definitions_test.ts
```

### Stop condition

- definitions 输出契约已清晰冻结

---

## Gate B — Freeze daemon/preview wiring consistency

### Goal

在 runtime 去重前锁住 daemon / preview 的 definitions 使用结果一致性。

### Files to change

- 新增 `src/interfaces/runtime_definition_consistency_test.ts`（若没有更合适承载点）

### Work

同一 config 输入下，断言 daemon 与 preview 看到一致的：

- `SourceDefinition`
- `DeliveryBinding`
- delivery kind / requestType / deliveryId

至少覆盖：

- fetch / summary
- file / push / email

### Verification

```bash
deno task test src/interfaces/runtime_definition_consistency_test.ts
```

### Stop condition

- daemon / preview 一致性已被自动化锁住

---

## Batch 4 — Deduplicate runtime assembly and add production fail-fast

### Goal

统一真正共用的 runtime helper / source execution 骨架，并明确禁止 production wiring 的静默 collect-only 降级。

### Files to change

- 新增 `src/interfaces/source_runtime_helpers.ts`
- 新增 `src/interfaces/create_source_execution_core.ts`
- 修改 `src/interfaces/web/preview_runtime.ts`
- 修改 `src/interfaces/daemon/create_daemon_runtime.ts`
- 修改 `src/web/xquery_playground.ts`（如抽 preview 执行壳）
- 修改 `src/web/syndication_playground.ts`（如抽 preview 执行壳）
- 视需要新增 `src/web/playground_preview_runtime.ts`

### Work

1. 抽共享 helper：
   - `resolveSourceConfig(...)`
   - `selectSourceInputGateway(...)`
2. 抽 source execution core：
   - ai runtime
   - content runtime
   - http client
   - summary query service
   - gateways
   - parser
3. 去掉 preview / daemon 的重复 source-side 装配骨架
4. 如需要，再统一 playground preview 执行壳层
5. **新增 production fail-fast**：
   - daemon / production wiring 缺关键 pipeline deps 时启动即失败
   - 不允许继续靠静默 collect-only 蒙混过关

### Explicit non-goals

- 不做万能 runtime builder
- 不统一 daemon / preview / playground 的生命周期语义
- 不修改 playground parse schema / error 分类

### Verification

```bash
deno task test src/interfaces/config/load_definitions_test.ts
deno task test src/interfaces/runtime_definition_consistency_test.ts
deno task test src/interfaces/web/preview_runtime_test.ts
deno task test src/interfaces/daemon/start_daemon_test.ts
deno task test src/web/xquery_playground_test.ts
deno task test src/web/syndication_playground_test.ts
deno task test src/infrastructure/sources/http_source_input_gateway_test.ts
deno task test src/infrastructure/sources/byparr_source_input_gateway_test.ts
deno task test src/infrastructure/sources/source_parser_gateway_test.ts
```

静态检查：

```bash
deno task check src/interfaces src/web src/infrastructure/sources
```

收尾建议：

```bash
deno task test
```

### Stop condition

- helper 与 source execution core 已共享
- daemon / preview gate 持续通过
- production wiring 已 fail-fast
- preview 轻路径未被误伤

### Risks

- 把“去重”做成“统一所有语义”
- 只去重 helper，却继续容忍 production 静默降级

---

## Batch 5 — Simplify config semantic projections

### Goal

收掉 config 语义链里的高价值重复表达与 definitions 投影绕路，不打平四层边界。

### Files to change

- `src/interfaces/config/load_definitions.ts`
- `src/config/resolve_config.ts`
- 如需要：
  - `src/config/delivery_semantics.ts`
  - `src/config/load_config.ts`
  - `src/config/validate_config.ts`

### Work

- `load_definitions.ts` 直接依赖 `AppConfigResolved`
- 去掉 canonical delivery 的伪 `ResolvedDeliveryConfig` 绕路
- 只抽少量真正高价值的 delivery semantic helper（优先 `toPushRequestType(...)`）
- 如确有必要，再收最小 path / 外部术语映射 helper

### Explicit non-goals

- 不合并 `load` / `validate` / `resolve` / `definitions`
- 不大改 validate error formatting
- 不改 ENV expansion 所在阶段

### Verification

```bash
deno task test src/interfaces/config/load_definitions_test.ts
deno task test src/config/resolve_config_test.ts
deno task test src/config/validate_config_test.ts
deno task test src/config/load_config_test.ts
deno task test src/interfaces/web/preview_runtime_test.ts
deno task test src/interfaces/daemon/start_daemon_test.ts
deno task test src/config/config_example_test.ts
```

静态检查：

```bash
deno task check src/config src/interfaces/config
deno task lint:check src/config src/interfaces/config
deno task fmt:check src/config src/interfaces/config
```

### Stop condition

- `load_definitions.ts` 已直接依赖 `AppConfigResolved`
- canonical delivery 投影不再走伪 resolved 绕路
- 关键 delivery semantic helper 已收口
- config 契约完全不漂

### Risks

- 把“语义收口”做成“层级打平”
- 顺手引入大规模错误文案重写

---

## Commit Strategy

推荐 11 个提交，保持单提交可验证、可回滚：

1. `refactor(application): split run source collect from apply`
2. `test(application): add collect and collect-only execution contracts`
3. `refactor(application): isolate pipeline item processing inside run source use case`
4. `test(application): strengthen pipeline boundary coverage for run source`
5. `fix(delivery): require canonical email rendered payload shape`
6. `test(delivery): lock canonical email payload contracts`
7. `test(interfaces): freeze definition outputs and runtime wiring consistency`
8. `refactor(interfaces): share source runtime selection helpers`
9. `refactor(interfaces): extract shared source execution core`
10. `fix(daemon): fail fast on incomplete production run source wiring`
11. `refactor(config): simplify resolved definition projections`

允许压缩为 8 commits，但不建议再少。

---

## Session Strategy

- **每个 Batch 一个新会话**
- 不按每个小函数开会话
- 不把多个 Batch 混在一个超长会话里完成

推荐会话划分：

- Session 1 -> Batch 1
- Session 2 -> Batch 2
- Session 3 -> Batch 3
- Session 4 -> Gate A + Gate B + Batch 4
- Session 5 -> Batch 5

---

## Exit Criteria

全部完成时，需满足：

1. Batch 1-5 全部完成。
2. Gate A / Gate B / production fail-fast 全部落地并通过。
3. 每个 Batch 的 scoped verification 全部通过。
4. 共享入口/共享装配批次完成后已跑必要的更广验证。
5. spec 与最终实现未发生语义分叉。
