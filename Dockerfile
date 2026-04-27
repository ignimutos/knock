ARG DENO_VERSION=2.7.13
ARG BUILDPLATFORM

FROM --platform=$BUILDPLATFORM denoland/deno:${DENO_VERSION} AS web-build

WORKDIR /app

COPY deno.json ./
COPY deno.lock ./
COPY vite.config.ts ./
COPY src ./src
COPY web ./web

RUN deno task deps:prefetch \
  && deno task build:web

FROM --platform=$BUILDPLATFORM denoland/deno:${DENO_VERSION} AS build

WORKDIR /app

COPY deno.json ./
COPY deno.lock ./
COPY docker/deno.compile.json ./docker/deno.compile.json
COPY src ./src
COPY web ./web
COPY --from=web-build /app/_fresh ./_fresh

RUN deno compile \
    --config /app/docker/deno.compile.json \
    --target x86_64-unknown-linux-gnu \
    --allow-read \
    --allow-write \
    --allow-env \
    --allow-net \
    --allow-ffi \
    --allow-run \
    --allow-sys \
    --output /app/knock \
    /app/src/container_main.ts

FROM alpine:3.21 AS runtime-assets

RUN apk add --no-cache ca-certificates tzdata \
  && mkdir -p /runtime

FROM cgr.dev/chainguard/glibc-dynamic

WORKDIR /app

ENV KNOCK_RUNTIME_DIR=/app/runtime

COPY --from=runtime-assets /etc/ssl/certs /etc/ssl/certs
COPY --from=runtime-assets /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=runtime-assets --chown=10001:10001 /runtime /app/runtime
COPY --from=build --chown=10001:10001 /app/knock ./knock
COPY --from=build --chown=10001:10001 /app/_fresh ./_fresh

USER 10001:10001

EXPOSE 8000

ENTRYPOINT ["/app/knock"]
CMD []
