# rules path 匹配审计设计

日期：2026-04-15  
范围：`.claude/rules/*.md`

## 1. 背景与目标

当前仓库已经把 instruction surface 重组为三层：

- 全局 `/root/.claude/CLAUDE.md`：跨仓库稳定总则
- 仓库 `CLAUDE.md`：薄入口
- `.claude/rules/*.md`：项目专属 path-scoped 细则

这一步之后，新的关键问题不再是“有没有拆开”，而是“`rules/*.md` 的 `paths:` 是否真的匹配得对”。

本次审计目标：

1. 确认每个 rule 的 `paths:` 在 Claude Code 官方规则模型下语法有效
2. 确认每个 rule 的 `paths:` 语义覆盖正确，不会明显过宽、过窄或错位
3. 在发现问题时，给出可直接落地的更优 glob 建议，但本轮不直接改文件
4. 用统一口径回答：哪些 rule 可以不动，哪些必须收紧，哪些应拆分或补充

## 2. 官方模型约束

本次审计遵循 Claude Code 官方文档中的 path-specific rules 约束：

1. `.claude/rules/*.md` 可以通过 YAML frontmatter 的 `paths:` 定义条件加载。
2. 规则只会在 Claude 处理命中这些 glob 的文件时加载。
3. 没有 `paths:` 的 rule 会在会话启动时无条件加载。
4. 官方推荐把大 `CLAUDE.md` 拆成更小的 rule 文件，并用 path-scoped 方式减少上下文噪音。

因此，本次判断标准不只是“glob 能不能匹配”，还包括“它是否把无关规则提前塞进上下文”。

## 3. 审计原则

1. **偏收紧**：只要更窄的 glob 仍覆盖主工作面，就优先收紧。
2. **避免无关命中**：rule 不应因为不相关文件被读取而加载。
3. **避免关键漏触发**：如果收紧后会让核心契约失效，则保留较宽匹配。
4. **职责对齐**：命中范围必须与 rule 主题一致。
5. **单一解释面**：顶层 `CLAUDE.md` 保持薄入口，细节约束依赖 path-scoped rules 加载，而不是回流到顶层。

## 4. 审计对象

本次固定审计 9 个 rule：

1. `execution.md`
2. `verification.md`
3. `docs-sync.md`
4. `config-contract.md`
5. `naming-and-dependencies.md`
6. `gitnexus.md`
7. `logging-otel.md`
8. `logging-console.md`
9. `testing-architecture.md`

## 5. 审计维度

### 5.1 语法维度

每个 rule 都检查：

- 是否存在合法 YAML frontmatter
- 是否存在 `paths:` 字段
- glob 写法是否属于 Claude Code 官方支持的常规路径模式
- 是否误依赖 `CLAUDE.md` 的 `@import` 才能生效

语法层只回答：**它会不会按官方模型被触发**。

### 5.2 语义维度

每个 rule 都检查：

- 当前命中范围是否覆盖其主工作面
- 是否把无关工作面也纳入
- 是否遗漏关键文件类型或目录
- 是否与其他 rule 发生大面积职责重叠
- 是否仍符合“顶层薄入口 + 细则按需加载”的设计目标

语义层回答：**它是否应该这样被触发**。

## 6. 风险分类

每个 rule 会被归到以下结论之一：

- `正确`：命中范围与职责一致
- `应收紧`：当前过宽，带来明显无关命中
- `应放宽`：当前过窄，遗漏关键工作面
- `应移除某些路径`：主体合理，但个别路径明显错位
- `应拆分`：一个 rule 承载了两个不同工作面，单靠收紧/放宽无法解决

并标注风险类型：

- `过宽`：无关文件也命中，增加上下文噪音
- `过窄`：关键文件不命中，规则失效
- `错位`：rule 主题与命中文件类型不一致
- `重复`：多个 rule 大面积重叠，造成上下文堆叠

## 7. 判定规则

### 7.1 顶层文件

- `README.md` / `config.example.yml`
  - 只应命中文档同步、配置契约、相关日志/测试文档约束
  - 不应默认触发与其无关的工程执行规则或 GitNexus 导航规则

- `CLAUDE.md`
  - 只应命中顶层 instruction surface 真相关的规则
  - 若某个 rule 只是“因为方便所以加上 `CLAUDE.md`”，应优先收紧

- `.claude/**`
  - 只应命中 instruction / hook / settings / guard 直接相关规则
  - 领域契约 rule 默认不应因为编辑 `.claude` 目录就触发

### 7.2 代码目录

- `src/**` / `web/**`
  - 只有在 rule 真的是广域工程规则时才应使用
  - 若 rule 实际只约束 `src/config/**`、`src/core/**`、`**/*test.ts` 这类子域，应改成子域 glob

### 7.3 重叠处理

- 多个 rule 大面积重叠时，优先收紧更泛化的那一个
- 保留最贴近职责边界的 rule 覆盖面
- 若两个主题天然不同但必须共同命中，需在结论里说明这是合理重叠，而不是误配

## 8. 审计方法

### 8.1 rule-by-rule 审计表

对每个 rule 输出一行审计结果，字段固定为：

| rule | 当前 paths | 语法判断 | 语义判断 | 主要问题 | 建议 paths |
| ---- | ---------- | -------- | -------- | -------- | ---------- |

### 8.2 路径样本验证

每个 rule 至少给三类样本路径：

1. **应命中**：当前主题下最典型的文件
2. **不应命中**：明显无关的文件
3. **边界样本**：最容易引起争议的文件

用这些样本说明：

- 现在的 glob 为什么对
- 或者现在的 glob 为什么会误命中 / 漏命中

### 8.3 证据来源

证据只来自以下材料：

- 当前 9 个 rule 文件正文与 `paths:`
- 仓库 `CLAUDE.md`
- 官方 Claude Code path-specific rules 文档
- 仓库目录结构与现有职责边界

不基于主观“以后可能会用到”的假设扩宽匹配范围。

## 9. 重点怀疑项

本轮预期重点检查这些可疑点：

1. `config-contract.md` 是否因为包含 `src/**` 而明显过宽
2. `gitnexus.md` 是否因为包含 `CLAUDE.md` 与 `.claude/**` 而在纯 instruction 编辑时误触发
3. `execution.md` 与 `verification.md` 是否对 `.claude/**` 覆盖过宽
4. `docs-sync.md` 是否对 `src/**` / `web/**` 的覆盖合理，还是应该更聚焦文档/配置边界
5. `logging-otel.md` / `logging-console.md` 是否真的应在 `README.md` 与 `config.example.yml` 上触发
6. `testing-architecture.md` 是否遗漏了测试基础设施相关路径，或对 `.claude/settings.json` 的覆盖是否过宽

这些是“重点检查”，不是预设结论。最终以审计证据为准。

## 10. 交付形式

最终交付分两部分：

### 10.1 审计总表

给出 9 个 rule 的完整审计表。

### 10.2 总结建议

按优先级分组：

- **无需修改**：当前 `paths:` 可保持
- **建议修改**：有明显优化空间，但不一定阻塞
- **应立即修改**：当前会造成明显误触发或漏触发

并补充：

- 哪些是语法层正确、但语义层有问题
- 哪些是合理重叠
- 哪些是“为了降低漏触发而保留稍宽匹配”的特例

## 11. 非目标

- 本轮不直接修改任何 `paths:`
- 本轮不重写 rule 正文
- 本轮不重做 instruction surface 结构设计
- 本轮不讨论技能、hooks、settings 的整体重构
- 本轮不把审计扩展到 `.claude/CLAUDE.md` 或子目录 `CLAUDE.md`
