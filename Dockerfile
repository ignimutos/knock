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

FROM denoland/deno:${DENO_VERSION} AS build

WORKDIR /app

COPY deno.json ./
COPY deno.lock ./
COPY src ./src
COPY web ./web
COPY --from=web-build /app/_fresh ./_fresh

RUN deno compile \
  --allow-read \
  --allow-write \
  --allow-env \
  --allow-net \
  --allow-ffi \
  --allow-run \
  --allow-sys \
  --output /app/knock \
  /app/src/container_main.ts

FROM debian:bookworm-slim

WORKDIR /app

ENV KNOCK_RUNTIME_DIR=/app/runtime

RUN useradd --system --uid 10001 --create-home knock

COPY --from=build --chown=10001:10001 /app/knock ./knock
COPY --from=build --chown=10001:10001 /app/_fresh ./_fresh

RUN install -d -o 10001 -g 10001 /app/runtime

USER 10001:10001

EXPOSE 8000

ENTRYPOINT ["/app/knock"]
CMD []
