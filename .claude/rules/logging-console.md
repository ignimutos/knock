# logging-console

这些规则只覆盖控制台日志展示层的强约束。

- 控制台日志默认格式 MUST 为 `json`。
- 控制台 MAY 提供 `pretty` 作为可选展示模式。
- `pretty` 只是展示层；MUST NOT 改变底层 OTel 数据模型、字段归属或语义边界。
- `pretty` MUST 基于已经脱敏后的 record 渲染；MUST NOT 直接消费未脱敏原始输入。
- 任何字段裁剪、重排、着色或人类可读优化，都 MUST 发生在脱敏之后，并且 MUST NOT 重新暴露敏感值。
- 若 `json` 与 `pretty` 同时存在，它们 SHOULD 表达同一条底层记录，而不是两套不同契约。
