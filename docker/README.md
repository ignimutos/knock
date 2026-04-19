# Knock

Knock 是一个基于 Deno + TypeScript 的订阅抓取与投递守护进程。

它可以抓取 RSS / Atom / JSON Feed，或通过 XQuery 从 HTML/XML 提取条目；随后统一 feed 与 entry 字段，执行 Liquid 过滤与渲染，并将结果投递到 file、push(HTTP)、email 通道，同时把状态与去重信息写入 SQLite。

## 镜像约定

- 工作目录：`/app`
- 默认运行目录：`/app/runtime`
- 默认环境变量：`KNOCK_RUNTIME_DIR=/app/runtime`
- 默认命令：`deno task start`
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
  deno:
    http:
      url: https://github.com/denoland/deno/releases.atom
    deliveries:
      local: {}
```

`config.yml` 支持 `${ENV_VAR}` 展开；`sqlite.path` 与 `deliveries.*.file.path` 的相对路径都相对 `/app/runtime` 解析。

## 一次性执行 daemon

```bash
docker run --rm \
  -v "$(pwd)/runtime:/app/runtime" \
  <image> \
  deno task daemon --immediate
```

这里的 `<image>` 请替换成当前 Docker Hub 仓库名，例如 `<namespace>/knock:latest`。

## 启动常驻模式并暴露 Web

容器内默认 `web` 监听地址是 `127.0.0.1`。如果需要通过 `-p` 暴露端口，必须显式改成 `0.0.0.0`：

```bash
docker run -d \
  --name knock \
  -p 8000:8000 \
  -v "$(pwd)/runtime:/app/runtime" \
  <image> \
  deno task start --web_host 0.0.0.0
```

## 常见用法

- 只启动 Web：`deno task start --mode web --web_host 0.0.0.0`
- 只启动 daemon：`deno task daemon`
- 立即执行一次：`deno task daemon --immediate`

如果你通过环境变量注入 provider 凭据、SMTP 配置或 webhook URL，直接在 `docker run` 时追加 `-e KEY=value` 即可。
