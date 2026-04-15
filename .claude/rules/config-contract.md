---
paths:
  - 'src/config/**'
  - 'src/interfaces/**'
  - 'src/main.ts'
  - 'config.example.yml'
  - 'README.md'
---

# config-contract

- 当前配置模型：`deliveries.<id>` 定义 canonical delivery，`sources.<id>.deliveries` 是 keyed map；key 为 delivery ID，value 为该 source 对对应 delivery 的 override。source 侧只允许按 delivery 类型覆写消息子树：file 覆写 `file.content`、push 的 canonical 消息子树是 `push.request.payload` 且 source override 键为 `payload`、email 覆写 `email.message`；空 override 使用 `{}`。
- MUST NOT 恢复 `templates` / `destinations` 等旧结构。
- MUST 保持单一事实源，MUST NOT 制造双 shape。
- 若任务未明确要求迁移兼容，MUST NOT 添加历史字段兼容层、别名或迁移提示。
- MUST 保留 `${ENV_VAR}` 展开语义。
- MUST NOT 在代码或提交配置中硬编码 token/chatId/password 等 secrets。
- MUST NOT 在日志中输出敏感原始值。
