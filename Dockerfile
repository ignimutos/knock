ARG BUN_VERSION=1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e
ARG BUILDPLATFORM

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json vite.config.ts ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY web ./web
COPY scripts ./scripts
RUN bun run build:binary

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system knock \
  && useradd --system --gid knock --home-dir /app --shell /usr/sbin/nologin knock \
  && mkdir -p /app/runtime

WORKDIR /app

ENV KNOCK_RUNTIME_DIR=/app/runtime

COPY --from=build --chown=knock:knock /app/dist/knock-linux-x64 /app/knock-linux-x64
COPY --from=build --chown=knock:knock /app/node_modules/jsdom /app/node_modules/jsdom
COPY --from=build --chown=knock:knock /app/node_modules/css-tree /app/node_modules/css-tree
COPY --from=build --chown=knock:knock /app/node_modules/mdn-data /app/node_modules/mdn-data
COPY --chown=knock:knock docker/entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD []
