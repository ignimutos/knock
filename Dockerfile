ARG BUN_VERSION=1.3.13
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
  && apt-get install -y --no-install-recommends ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system knock \
  && useradd --system --gid knock --home-dir /app --shell /usr/sbin/nologin knock \
  && mkdir -p /app/runtime

WORKDIR /app

ENV KNOCK_RUNTIME_DIR=/app/runtime

COPY --from=build /app/dist/knock-linux-x64 /app/knock-linux-x64
COPY --from=build /app/node_modules/jsdom /app/node_modules/jsdom
COPY --from=build /app/node_modules/css-tree /app/node_modules/css-tree
COPY --from=build /app/node_modules/mdn-data /app/node_modules/mdn-data
RUN chown -R knock:knock /app

USER knock

EXPOSE 8000

ENTRYPOINT ["/app/knock-linux-x64"]
CMD []
