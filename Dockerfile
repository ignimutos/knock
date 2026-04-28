ARG BUN_VERSION=1.3.13
ARG BUILDPLATFORM

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json vite.config.ts ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY web ./web
RUN bun run build:web

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS prod-deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM alpine:3.21 AS runtime-assets

RUN apk add --no-cache ca-certificates tzdata \
  && mkdir -p /runtime

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS runtime

WORKDIR /app

ENV KNOCK_RUNTIME_DIR=/app/runtime

COPY --from=runtime-assets /etc/ssl/certs /etc/ssl/certs
COPY --from=runtime-assets /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=runtime-assets --chown=bun:bun /runtime /app/runtime
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock tsconfig.json ./
COPY --chown=bun:bun src ./src
COPY --chown=bun:bun web ./web
COPY --from=build --chown=bun:bun /app/.web-dist ./.web-dist

USER bun

EXPOSE 8000

ENTRYPOINT ["bun", "src/container_main.ts"]
CMD []
