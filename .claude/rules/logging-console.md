# logging-console

这些规则只覆盖控制台日志展示层的强约束。

- 控制台日志默认格式 MUST 为 `json`。
- 控制台 MAY 提供 `pretty` 作为可选展示模式。
- `pretty` 只是展示层；MUST NOT 改变底层 OTel 数据模型、字段归属或语义边界。
- `pretty` MUST 基于已经脱敏后的 record 渲染；MUST NOT 直接消费未脱敏原始输入。
- 控制台展示的最小可见字段集 MUST 至少包含：时间戳、severity、`scope.name`、`body`。
- `json` 模式 SHOULD 直接反映底层 record；`pretty` 模式 MAY 在不改变语义前提下重排、裁剪、着色，但 MUST NOT 隐去最小可见字段集。
- 任何字段裁剪、重排、着色或人类可读优化，都 MUST 发生在脱敏之后，并且 MUST NOT 重新暴露敏感值。
- `warn` / `error` 展示 SHOULD 优先呈现真实且相关的结果、原因与 trace 关联上下文；若不存在，就直接省略，而不是补占位字段。
- `debug` / `trace` 展示 MAY 暴露更多真实诊断属性，以支持排障；但仍 MUST 基于同一条底层 record，而不是拼接展示层私货。
- `info` 展示 SHOULD 以最小字段集为主，只在确有助于理解当前事件时再附带少量相关上下文。
- 若 `json` 与 `pretty` 同时存在，它们 SHOULD 表达同一条底层 record，而不是两套不同契约。
- `pretty` MUST NOT 为了展示完整性而发明占位的 trace / event / attribute 字段；不存在就省略，不得凭空补 `traceId: "-"`、空 `event_name`、空对象 `attributes` 等展示层占位值。
