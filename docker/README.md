# Knock

Knock 是一个基于 Bun + TypeScript 的订阅抓取与投递守护进程。

它可以抓取 RSS / Atom / JSON Feed，或通过 XQuery 从 HTML/XML 提取条目；随后统一 feed 与 entry 字段，执行 Liquid 过滤与渲染，并将结果投递到 file、push(HTTP)、email 通道，同时把状态与去重信息写入 SQLite。

## 镜像约定

- 工作目录：`/app`
- 默认运行目录：`/app/runtime`
- 默认环境变量：`KNOCK_RUNTIME_DIR=/app/runtime`
- 支持的容器启动默认变量：`KNOCK_CONFIG_PATH`、`KNOCK_WEB_HOST`、`KNOCK_WEB_PORT`、`KNOCK_IMMEDIATE`
- 容器默认以非 root 用户 `knock` 运行
- 默认入口：`/app/knock-linux-x64`，内部仍复用 `src/container_entrypoint.ts` 的参数归一化语义，默认保留项目 CLI 的 `all` 模式
- 构建阶段固定使用 `oven/bun:1.3.13`
- 运行阶段固定使用 `debian:bookworm-slim`，并内置 CA 证书与 `tzdata`
- 运行镜像不再携带 `src/`、`web/`、完整 `node_modules/` 或 `.web-dist/`；仅保留二进制运行时需要的 `jsdom`、`css-tree`、`mdn-data` 资产目录
- 发布前门禁固定执行：`bun run verify:full`、`bun run build:binary`、`bun run smoke:binary`、`bun run image:prepare`
- 已发布标签：`latest`、`sha-<git-sha>`

## 准备配置

先在宿主机准备 `runtime/config.yml`。最小示例：

```yml
sqlite:
  path: knock.db

deliveries:
  local:
    file:
      path: outputs/releases.md
      content: |
        ## [{{ entry.title }}]({{ entry.link }})

        {{ entry.content | strip_html }}

        ---

sources:
  bun:
    http:
      url: https://github.com/oven-sh/bun/releases.atom
    deliveries:
      local: {}
```

`config.yml` 支持 `${ENV_VAR}` 展开；`sqlite.path` 与 `deliveries.*.file.path` 的相对路径都相对 `/app/runtime` 解析。

容器启动相关环境变量：

- 镜像内置：`KNOCK_RUNTIME_DIR=/app/runtime`
- 可选覆盖：`KNOCK_CONFIG_PATH=/app/runtime/config.yml`
- 可选覆盖：`KNOCK_WEB_HOST=0.0.0.0`
- 可选覆盖：`KNOCK_WEB_PORT=8000`
- 可选覆盖：`KNOCK_IMMEDIATE=true|false`

这些变量只在镜像默认入口下生效；挂载到 `/app/runtime` 的 `config.yml` 会被默认读取。`src/container_entrypoint.ts` 会在未显式提供参数时保留项目 CLI 的 `all` 模式：`KNOCK_CONFIG_PATH` 会继续注入到含 daemon 分支的启动参数，`KNOCK_WEB_HOST` / `KNOCK_WEB_PORT` 会继续注入到含 web 分支的启动参数，`KNOCK_IMMEDIATE` 则按原约定补齐。若显式指定 `--mode daemon`，入口不会再注入 `KNOCK_WEB_HOST/KNOCK_WEB_PORT`；若显式指定 `--mode web`，入口不会把 `KNOCK_CONFIG_PATH` 改写成 CLI `--config`。若 `docker run` 里显式追加了对应 CLI 参数，则 CLI 参数优先。

## 一次性执行 daemon

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$(pwd)/runtime:/app/runtime" \
  -e KNOCK_IMMEDIATE=true \
  <image>
```

这里的 `<image>` 请替换成当前 Docker Hub 仓库名，例如 `<namespace>/knock:latest`。

## 启动常驻模式并暴露 Web

容器内默认 `web` 监听地址是 `127.0.0.1`。如果需要通过 `-p` 暴露端口，必须显式改成 `0.0.0.0`：

```bash
docker run -d \
  --name knock \
  --user "$(id -u):$(id -g)" \
  -p 8000:8000 \
  -v "$(pwd)/runtime:/app/runtime" \
  -e KNOCK_WEB_HOST=0.0.0.0 \
  -e KNOCK_WEB_PORT=8000 \
  <image>
```

## 常见用法

- 修改 Web 监听地址：`docker run --rm -e KNOCK_WEB_HOST=0.0.0.0 <image>`
- 修改 Web 监听端口：`docker run --rm -e KNOCK_WEB_PORT=9000 -p 9000:9000 <image>`
- 指定配置文件：`docker run --rm -e KNOCK_CONFIG_PATH=/app/runtime/config.yml <image>`
- 立即执行一次后退出：`docker run --rm -e KNOCK_IMMEDIATE=true <image>`
- 显式参数覆盖环境变量：`docker run --rm -e KNOCK_WEB_PORT=8000 <image> --web_port 9000`

如果你通过环境变量注入 provider 凭据、SMTP 配置或 webhook URL，直接在 `docker run` 时追加 `-e KEY=value` 即可；入口脚本只会补齐未显式传入的 CLI 参数。若挂载宿主机 runtime 目录，Linux 下应保证该目录对容器进程可写；最直接的做法是像上面的示例一样显式传 `--user "$(id -u):$(id -g)"`。

本仓库 CI 会先做三层门禁：

1. `verify`：`bun run verify:full`
2. `image`：`bun run image:prepare`（构建并校验镜像体积）
3. `publish`：仅 `main` 推送 `linux/amd64` 镜像并同步 Docker Hub README

镜像体积默认预算由 `KNOCK_IMAGE_MAX_SIZE_MB` 控制，CI 当前使用 `450` MB。
