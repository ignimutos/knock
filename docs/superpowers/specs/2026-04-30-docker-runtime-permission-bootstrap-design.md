# Docker runtime 挂载权限自愈入口设计

## 背景

当前镜像在 `Dockerfile` runtime 层固定使用非 root 用户 `knock` 运行，并默认从 `/app/runtime/config.yml` 读取配置。只要宿主机 bind mount 进来的 `runtime/` 目录 owner 或 mode 不适合该用户，即使 `config.yml` 本身是可读的，也会因为目录不可遍历或文件不可写而在容器启动早期直接失败。

之前的修复只覆盖了 release 脚本自建临时目录的权限预检，并没有解决通用 `docker run` / `docker compose` 场景：用户把任意宿主机目录挂进 `/app/runtime` 后，容器仍可能因宿主权限模型与镜像内用户模型不匹配而报错。

用户给出的参考实现 `TG-SignPulse/docker/entrypoint.sh` 的关键思路不是“把报错写得更清楚”，而是把容器入口改成一个 bootstrap 层：先以 root 进入入口，检查挂载目录 owner / permission，必要时主动修复，再决定以目标 UID/GID 或 root 启动主进程。用户已明确要求按这条路实现，并且允许入口修改挂载目录及其内部文件的 owner / mode。

## 目标

1. 让默认 `docker run` / `docker compose` 挂载宿主 `runtime/` 到 `/app/runtime` 时，不再要求用户手工 `chmod` / `chown` / `--user` 才能启动成功。
2. 参考用户提供的 `entrypoint.sh` 思路，把容器入口升级为 runtime 权限自愈 bootstrap。
3. 当 `/app/runtime` 已挂载且权限不匹配时，由入口主动修复 owner / mode，并在必要时保留 root 运行，优先保证可启动。
4. 保持当前应用 CLI / 默认参数注入语义稳定，不把 shell bootstrap 扩大成业务参数重写层。
5. 保留已有的权限错误提示，作为自愈失败时的最终兜底。

## 非目标

1. 不改变当前配置契约、CLI 参数 shape 或失败路径的业务语义。
2. 不把现有 TypeScript 容器参数默认逻辑搬回 shell 重写。
3. 不做“只报错不修复”的保守方案。
4. 不要求用户在 compose 里显式写 `user:`、也不要求宿主目录预先处理权限。
5. 不扩展到仓库外其他挂载点；本次只覆盖 `/app/runtime` 及其内部常见运行时文件。

## 设计原则

### 优先解决真实可用性

用户要求的是“忽略宿主文件夹权限，容器自己处理并正常启动”。因此本次设计优先级是启动成功，而不是坚持镜像内非 root 运行的洁癖。若 root 才能保证挂载目录可用，则允许 root 继续运行。

### shell 只管文件系统与身份

参考脚本的核心价值在于“权限 bootstrap + 身份切换”。这部分适合留在 shell。应用参数补齐、`--mode` 语义、`KNOCK_CONFIG_PATH` / `KNOCK_WEB_HOST` / `KNOCK_WEB_PORT` / `KNOCK_IMMEDIATE` 等现有容器参数默认逻辑继续保留在 TypeScript 层，避免两套语义并存。

### 自愈优先，报错兜底

入口先尝试自愈；只有在检测或修复后仍无法保证可用时，才落回应用层已有的配置文件权限错误提示。这样既解决真实问题，也保留诊断可见性。

### 最小完整改动

只重构 Docker 入口与运行用户模型，不顺手重画应用启动拓扑。`container_entrypoint -> main -> startup_orchestrator` 继续保持不变。

## 方案对比

### 方案 A：root bootstrap + 权限自愈 + 按需降权

容器以 root 进入 shell 入口；入口检查 `/app/runtime` 的 owner / mode，必要时修 owner / permission，然后：

- 若可安全降权，则以目标 UID/GID 执行应用；
- 若目标 owner 为 root，或降权反而失去写权限，则保留 root 运行。

优点：

- 能真正覆盖用户当前问题。
- 与用户提供的参考脚本思路一致。
- 不再依赖手工 `chmod/chown/--user`。

缺点：

- 启动阶段需要 root。
- 入口逻辑比当前固定 `USER knock` 更复杂。

### 方案 B：维持 `USER knock`，只做更强 preflight / fail-fast

保留现有镜像用户模型，只在入口或应用层更早发现目录权限不匹配并输出更强提示。

优点：

- 风险面更小。
- 安全模型更保守。

缺点：

- 不能自动解决用户当前问题。
- 仍要求用户手动修宿主机权限。

### 方案 C：完全把容器参数默认逻辑搬进 shell

除了权限 bootstrap，还把 `KNOCK_CONFIG_PATH` / `KNOCK_WEB_HOST` / `KNOCK_WEB_PORT` / `KNOCK_IMMEDIATE` 等默认逻辑重新放进 shell，最终直接 `exec` 应用。

优点：

- shell 入口自包含。

缺点：

- 会与现有 `src/container_entrypoint_defaults.ts` 形成双实现。
- 漂移风险高，测试面更大。

## 结论

采用 **方案 A**，并显式排除方案 B/C。

## 具体设计

## 一、入口架构

### 1. Docker 运行用户模型

`Dockerfile` 不再在镜像层固定 `USER knock`。容器启动时先以 root 进入真正入口，以获得检查和修复 bind mount 权限所需的能力。

镜像仍保留 `knock` 用户与组，作为默认降权目标身份；但它不再是容器进程的硬编码起点，而是 bootstrap 计算出的候选运行身份。

### 2. 统一入口

`docker/entrypoint.sh` 成为唯一容器入口。它负责：

1. 检查 `/app/runtime` 是否存在；
2. 推导目标 UID/GID；
3. 修复 `/app/runtime` 及其内部已存在路径的 owner / permission；
4. 决定最终以 root 还是目标 UID/GID 执行主进程；
5. 交给编译后二进制入口继续处理应用参数默认值。

`src/container_entrypoint.ts` 与 `src/container_entrypoint_defaults.ts` 继续保留并负责应用参数层语义，不把这部分复制到 shell。

### 3. 最终执行路径

shell 入口最终执行编译后二进制入口，而不是 `bun src/main.ts`。这保证 Docker 正式运行路径与当前镜像默认入口一致，并避免出现 shell 层与 TypeScript 层各自改写参数的双写问题。

## 二、权限自愈策略

### 1. 目标 UID/GID 推导

默认目标身份来源于镜像内 `knock` 用户/组的 UID/GID。

若 `/app/runtime` 存在，则优先读取其 owner uid/gid 作为目标 UID/GID。设计意图与参考脚本一致：bind mount 过来的宿主目录通常最适合按它当前 owner 身份运行，而不是硬套镜像内部默认 uid/gid。

若读取 owner 失败，或运行环境不支持对应探测，则回退到镜像默认 `knock` 身份。

### 2. 修复触发条件

仅当入口当前以 root 启动且 `/app/runtime` 存在时，执行自动修复。若容器本身被用户显式限制成非 root 启动，则入口无法自愈，此时保留失败兜底路径。

### 3. 修复范围

参考用户给的脚本，本次入口至少对以下路径执行“存在才修”的策略：

- `/app/runtime`
- `/app/runtime/config.yml`
- `/app/runtime/config.yaml`
- `/app/runtime/outputs`
- `/app/runtime/logs`
- `/app/runtime/db.sqlite`
- `/app/runtime/knock.db`

另外，为避免只修一层目录但遗漏已有历史文件，入口会对 `/app/runtime` 做递归 owner / permission 修复；对上面这些高频路径则保留显式列表，方便阅读与后续针对性扩展。

### 4. 修复动作

对存在的目标路径执行：

- `chown -R <target_uid>:<target_gid>`
- `chmod -R u+rwX`
- `chmod -R g+rwX`

目的不是把所有东西改成 `777/666`，而是像参考脚本一样在“尽量对齐 owner”的前提下，为 owner/group 赋予足够读写与目录穿越能力。

该策略满足两个目标：

1. 让挂载目录在多数 Linux bind mount 场景下恢复为可用；
2. 避免继续依赖 release 脚本那种更宽松但更粗暴的全开放权限模型。

### 5. root 保留条件

若推导出的目标 UID/GID 为 `0:0`，或修复后仍判断 root 才能保持对 mount 的稳定可写性，则像参考脚本一样保留 root 运行，不强行降权。

这是本次设计的关键取舍：**启动成功优先于固定降权**。

## 三、与现有 TypeScript 入口的衔接

### 1. shell 与 TS 的职责边界

- `docker/entrypoint.sh`：文件系统 bootstrap、权限修复、身份选择
- `src/container_entrypoint.ts` / `src/container_entrypoint_defaults.ts`：应用参数规范化与默认值注入

两层之间通过“最终 exec 当前二进制入口”衔接，不复制业务参数逻辑。

### 2. 保持当前参数语义

现有语义继续保持：

- `KNOCK_CONFIG_PATH` 在非 web-only 模式下注入 `--config`
- `KNOCK_WEB_HOST` / `KNOCK_WEB_PORT` 在非 daemon-only 模式下注入
- `KNOCK_IMMEDIATE` 继续复用当前布尔解析规则
- 空参数默认仍保留 `all` 模式

因此，本次改动不会扩大成 CLI 契约重写，只是让“容器能读写 `/app/runtime`”这件事更稳。

### 3. 自愈失败兜底

此前已加入的 `toConfigLoadError(...)` 权限提示继续保留。若以下任一情况发生：

- 用户显式强制非 root 运行导致入口无法修复
- bind mount 场景下 `chown/chmod` 被底层文件系统限制
- 自愈后仍无法访问配置文件

则应用层仍会给出带 Docker bind mount 指引的可操作错误信息。

## 四、测试与验证设计

### 1. contract 测试

新增/扩展入口 contract 测试，锁定以下行为：

1. 当 `/app/runtime` 存在时，入口会按其 owner uid/gid 推导目标身份。
2. root 启动时会尝试修复 `/app/runtime` 及既有关键路径权限。
3. 当目标 owner 为 root，或设计判定 root 才能保持可用性时，入口会保留 root 运行。
4. 应用参数默认逻辑仍由现有 TypeScript 入口提供，不因 shell bootstrap 变化而回归。

若 shell 入口无法直接在当前测试框架里细粒度断言，则补充围绕其行为的 black-box 测试，但仍以最小覆盖这 4 条契约为准。

### 2. 镜像级 smoke

在真实 Docker 运行下验证至少两类挂载现场：

1. `runtime/` 为 `700/644 root:root`
2. `runtime/` 为普通 `755/644`

成功标准：挂载后容器能完成启动，不再直接死于读取 `/app/runtime/config.yml` 的权限错误。

### 3. 必跑验证

因为会触及共享高影响边界 `Dockerfile` 与容器入口，最终验证应至少包含：

1. 命中入口与相关测试的 scoped `bun run test:path -- <paths>`
2. `bun run fmt:check:path -- <changed-paths>`
3. `bun run lint:check:path -- <changed-paths>`
4. `bun run check`
5. `bun run test`
6. 至少一次真实 `docker build` + `docker run -v <runtime>:/app/runtime` smoke

## 五、文档变更

`docker/README.md` 需要同步调整：

1. 把“显式 `--user "$(id -u):$(id -g)"`”从主推荐路径降级为可选高级覆盖。
2. 明确默认入口会对 `/app/runtime` bind mount 做启动期权限自愈。
3. 说明在极端文件系统限制下，若自愈失败，仍会看到配置文件权限错误提示。

文档必须反映新的默认行为，不能再把手工 `--user` 描述成主路径。

## 风险与取舍

1. **启动阶段需要 root**：这是为了解决 bind mount 权限不可控的必要条件；用户已明确不在乎 root 细节，只要求问题被真正解决。
2. **会修改宿主挂载内容的 owner / mode**：用户已明确允许。设计上仍只修 `/app/runtime` 及其内部路径，不扩展到其他 mount。
3. **部分宿主文件系统可能限制 chown/chmod**：例如某些特殊卷或权限映射场景。此时入口只能尽力自愈，失败后落回已有提示兜底。
4. **保留 root 运行降低了“始终非 root”纯度**：但这是有意取舍，优先满足“能启动”。

## 实施结果预期

完成后，Knock 的 Docker 默认运行路径应满足：

1. 用户把任意宿主 `runtime/` bind mount 到 `/app/runtime` 后，不再需要手工 `chmod` / `chown` / `--user`。
2. 入口会像参考 `TG-SignPulse/docker/entrypoint.sh` 一样，先做权限 bootstrap，再决定最终运行身份。
3. root-owned 或 mode 不匹配的挂载目录不再直接因 `EACCES` 阻塞启动。
4. 应用参数默认语义、容器 CLI 契约与已有 TypeScript 启动结构保持稳定。
5. 若极端环境下自愈仍失败，错误日志仍给出可操作提示，而不是只留下裸 `EACCES`。
