# rules paths 收紧与修正设计

日期：2026-04-15  
范围：`.claude/rules/*.md`

## 1. 背景与目标

上一轮已完成 `rules/*.md` 的 path 审计，并形成结论文件：

- `docs/superpowers/audits/2026-04-15-rules-path-audit.md`

当前目标不再是“确认是否有问题”，而是把审计结论真正落地到规则文件上，使 `paths:` 更贴近规则主题，同时避免无关命中与关键漏触发；其中 `gitnexus.md` 采用后续确认的 repo-wide 常驻加载方式。

本次目标：

1. 基于已完成的 audit，收紧、放宽或取消 9 个 rule 的 path-scoped 加载方式
2. 以 audit 结论为默认答案，但允许落地前做一次小幅二次校正
3. 只在正文与新的 `paths:` 或加载方式明显直接冲突时，做最小正文修正
4. 保持 instruction surface 三层结构不变，不做新的规则分层重构

## 2. 设计原则

1. **以 audit 为主**：默认采用 `docs/superpowers/audits/2026-04-15-rules-path-audit.md` 的建议 `paths:`；`gitnexus.md` 采用后续确认的 repo-wide 常驻例外。
2. **允许二次校正**：若落地时发现 audit 建议过紧或略有错位，可在不偏离主方向的前提下小幅修正。
3. **偏收紧**：只要更窄的 glob 仍覆盖主工作面，就优先收紧。
4. **最小正文改动**：仅当规则正文与新命中面，或与 GitNexus 常驻加载方式出现直接冲突时，才允许微调正文。
5. **不扩大战场**：不借机重写 rules 体系、不新增或删除 rule 文件、不回流到顶层 `CLAUDE.md`。

## 3. 实施边界

### 3.1 必改内容

本轮直接处理 9 个 rule 文件的 `paths:` 或加载方式：

- `execution.md`
- `verification.md`
- `docs-sync.md`
- `config-contract.md`
- `naming-and-dependencies.md`
- `gitnexus.md`
- `logging-otel.md`
- `logging-console.md`
- `testing-architecture.md`

### 3.2 允许的最小正文修正

若发生以下情况，可同步微调正文：

- 新的 `paths:` 已明显缩小到某个子域，但正文仍把自己表述成“广域全仓规则”
- 新增的 `paths:` 引入新的明确工作面，而正文完全遗漏该工作面，导致规则理解出现直接冲突

除此之外，正文保持不动。

### 3.3 明确不做

- 不改全局 `/root/.claude/CLAUDE.md`
- 不改仓库顶层 `CLAUDE.md` 结构
- 不新增 / 删除 / 拆分 rule 文件
- 不重写大段规则正文
- 不重新设计整个 instruction surface 架构

## 4. rule 分组策略

### 4.1 直接收紧组

这些 rule 的 audit 结论已经足够稳定，优先按建议收紧：

- `execution.md`
- `verification.md`
- `docs-sync.md`
- `config-contract.md`
- `gitnexus.md`
- `logging-console.md`

处理方式：

1. 先按 audit 建议修改 `paths:`
2. 用样本路径做一次命中复核
3. 若 audit 建议过紧，再做一次小幅二次校正
4. 只有正文与新命中面直接冲突时才微调正文

### 4.2 直接放宽组

这些 rule 的主要问题是漏覆盖：

- `logging-otel.md`
- `testing-architecture.md`

处理方式：

1. 把 audit 中识别出的缺失路径补进 `paths:`
2. 重点验证新增路径是否真的属于该 rule 主题
3. 若新增路径带来明显错位，再做最小回退

### 4.3 保持不动组

- `naming-and-dependencies.md`

处理方式：

- 只复核，不改文件
- 若落地验证显示 audit 结论有误，再重新评估；否则保持原样

## 5. 初始落地目标

### 5.1 `execution.md`

当前：

- `src/**`
- `web/**`
- `CLAUDE.md`
- `.claude/**`

目标方向：

- 保留 `src/**`
- 保留 `web/**`
- 保留 `CLAUDE.md`
- 把 `.claude/**` 收紧为 `.claude/rules/**`
- 补入 `scripts/**`
- 补入 `deno.json`

### 5.2 `verification.md`

当前：

- `src/**`
- `web/**`
- `CLAUDE.md`
- `.claude/**`
- `README.md`
- `config.example.yml`

目标方向：

- 保留 `src/**`
- 保留 `web/**`
- 保留 `README.md`
- 保留 `config.example.yml`
- 保留 `CLAUDE.md`
- 把 `.claude/**` 收紧为 `.claude/rules/**`
- 补入 `scripts/**`
- 补入 `deno.json`

### 5.3 `docs-sync.md`

当前：

- `README.md`
- `config.example.yml`
- `src/**`
- `web/**`
- `CLAUDE.md`

目标方向：

- 保留 `README.md`
- 保留 `config.example.yml`
- 保留 `web/**`
- 收紧 `src/**` 为：
  - `src/main.ts`
  - `src/application/**`
  - `src/interfaces/**`
  - `src/config/**`
  - `src/sources/**`
  - `src/deliveries/**`
- 默认移除 `CLAUDE.md`
- 若二次校正发现 `CLAUDE.md` 仍是必要工作面，再补回

### 5.4 `config-contract.md`

当前：

- `src/config/**`
- `config.example.yml`
- `README.md`
- `src/**`

目标方向：

- 保留 `src/config/**`
- 保留 `config.example.yml`
- 保留 `README.md`
- 收紧 `src/**` 为：
  - `src/interfaces/**`
  - `src/main.ts`

### 5.5 `gitnexus.md`

当前：

- `src/**`
- `web/**`
- `CLAUDE.md`
- `.claude/**`

目标方向：

- 保留文件位置：`.claude/rules/gitnexus.md`
- 去掉 `paths:` frontmatter
- 让 GitNexus 规则作为 repo-wide 常驻 rule 加载
- 不移动到仓库根目录
- 不在 `CLAUDE.md` 中通过 `@import` 导入

### 5.6 `logging-otel.md`

当前：

- `src/main.ts`
- `src/application/**`
- `src/core/**`
- `src/db/**`
- `src/deliveries/**`
- `src/interfaces/**`
- `src/sources/**`
- `src/web/**`
- `web/**`
- `README.md`
- `config.example.yml`

目标方向：

- 在当前集合基础上补：
  - `src/config/**`
  - `src/infrastructure/**`

### 5.7 `logging-console.md`

当前：

- `src/main.ts`
- `src/core/**`
- `src/interfaces/**`
- `src/web/**`
- `web/**`
- `README.md`
- `config.example.yml`

目标方向：

- 保留：
  - `src/main.ts`
  - `README.md`
  - `config.example.yml`
- 收紧为：
  - `src/core/logger.ts`
  - `src/core/logger_test.ts`
  - `src/interfaces/daemon/**`
  - `src/interfaces/web/**`
  - `web/routes/**`

### 5.8 `testing-architecture.md`

当前：

- `src/**/*test.ts`
- `web/**/*test.ts`
- `web/**/*test.tsx`
- `docs/testing/**`
- `.claude/settings.json`
- `scripts/run-paths.sh`

目标方向：

- 保留全部当前路径
- 补入：
  - `src/testing/**`
  - `.claude/skills/test-architecture-guard/**`

### 5.9 `naming-and-dependencies.md`

当前：

- `src/**`
- `web/**`
- `README.md`
- `config.example.yml`
- `CLAUDE.md`

目标方向：

- 暂不修改
- 仅做一次样本复核

## 6. 验证策略

本次落地采用 3 层验证。

### 6.1 结构验证

确认每个处理过的 rule：

- frontmatter 仍合法
- `paths:` 存在
- YAML 结构未损坏

### 6.2 样本验证

对每个变更过的 rule，至少验证：

1. 应命中样本仍命中
2. 不应命中样本不再命中
3. 边界样本符合新的设计判断

这一步是本次“audit + 二次校正”的关键门。

### 6.3 回归验证

由于本次变动属于 instruction surface / 文档契约面，至少完成：

- 相关最小文档/契约测试
- 全量 `deno task test`

若样本验证与测试验证冲突，以真实测试与规则职责边界共同裁决，并回到对应 rule 做最小调整。

## 7. 交付内容

最终交付必须明确：

1. 哪 8 个 rule 被修改
2. 哪 1 个 rule 保持不变
3. 哪些正文被微调，以及为什么
4. 跑了哪些验证
5. 哪些 audit 建议在落地时做了二次校正

## 8. 非目标

- 不重做 rule 分层
- 不把更多规则挪回顶层 `CLAUDE.md`
- 不改 GitNexus 规则正文主体内容
- 不扩展到 hooks / settings / skills 的整体重构
- 不新增新的审计维度
