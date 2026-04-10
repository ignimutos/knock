---
name: otel-logging-design
description: Use when adding, refactoring, or reviewing structured logs and deciding OpenTelemetry field placement, scope names, attribute namespaces, or context ownership between resource, scope, attributes, and trace fields.
---

# otel-logging-design

先把日志设计问题当成“上下文归谁拥有”的问题，而不是“字段放哪儿顺手”的问题。

这个 skill 只处理判断流程：当固定 rules 还不足以直接回答时，用它决定字段放置、`scope.name`、业务 namespace，以及上下文该落在 `resource` / `scope` / `attributes` / trace 字段何处。

## 何时使用

- 新增结构化日志点
- 重构既有日志模型
- review 日志字段是否放错层级
- 不确定某段上下文属于资源、生产者、事件还是 trace 关联
- 不确定 `scope.name` 是否稳定
- 不确定自定义业务字段应该挂到哪个 namespace

不适用：

- 只是在既有规则下机械补字段
- 只讨论展示层样式或输出排版

## 决策顺序

1. 先定义事件本身
   - 这条日志到底在描述什么事件？
   - 这条记录最短的人类可读结论是什么？这通常就是 `body` 的核心。

2. 列出候选上下文
   - 把你想记录的每个字段单独列出来。
   - 不要先假设它们都在 `attributes`。

3. 逐个判断归属

| 问题                                                         | 归属                  |
| ------------------------------------------------------------ | --------------------- |
| 这个事实是否对同一运行实体的大量日志都稳定成立？             | `resource.attributes` |
| 这个事实是否在标识“哪一个日志生产者”而不是“哪一次事件”？     | `scope`               |
| 这个事实是否只是在表达当前日志与 trace/span 的真实因果关联？ | trace 字段            |
| 否则，它是否属于当前这次事件，并且需要被过滤、聚合、统计？   | `attributes`          |
| 如果它只是给人看的叙述，不需要机器查询？                     | `body`                |

4. 再判断是否已有标准键
   - 若标准键足够准确，直接用标准键。
   - 若标准键不够，再落到自定义业务 namespace。
   - 不要为了“更顺口”重造标准概念的近义词。

5. 决定 `scope.name`
   - 先问自己：我是在给“生产者”命名，还是在给“事件结果”命名？
   - 如果名字里出现实例 ID、环境、结果态、重试态、用户输入，通常已经偏离了 `scope.name` 的职责。
   - 目标是：同一生产者在不同事件上复用同一个 `scope.name`，只让事件差异进入 `attributes` 或 `body`。

6. 决定自定义业务 namespace
   - 先找最接近职责归属的业务域，再继续往下细分。
   - 若一个值横跨多个步骤，优先按“谁拥有这个语义并负责解释它”来放置，而不是按“最早在哪里拿到它”来放置。
   - 若两个字段只有自由文本区别、没有稳定枚举意义，优先保留一个结构化字段加 `body`，而不是制造两套近义字段。

7. 做一次可观测性复盘
   - 不读 `body`，只看结构化字段，能否回答：
     - 谁产生日志？
     - 属于哪个运行资源？
     - 当前发生了什么？
     - 结果如何？
     - 为什么这样？
     - 是否与 trace 关联？
   - 如果不能，说明字段归属还没定好。

## 快速判断提示

- “这台进程/这个部署一直如此”通常是 `resource.attributes`
- “这个 logger/handler/client 发出的”通常是 `scope`
- “这一次请求/抓取/投递/重试才有”通常是 `attributes`
- “只是因为当前 span 存在”才成立的关联，才是 trace 字段
- “需要人读一句话才能懂”写进 `body`，但不要把可查询字段只埋在 `body`

## 常见误判

- 把请求级、任务级、重试级上下文塞进 `resource.attributes`
- 把 source id、delivery id、结果态塞进 `scope.name`
- 明明已有标准键，却另造一套业务近义词
- 把自由文本原因当成唯一结构化结果字段
- 因为展示层想看得舒服，就反推底层模型结构

## 交付前自检

- 每个字段都能解释“为什么属于这一层”
- `scope.name` 在不同实例、不同结果下仍然稳定
- 自定义字段只在标准键不够用时出现
- 非成功结果既有人类可读结论，也有机器可查询字段
- 脱敏发生在任何展示层格式化之前
