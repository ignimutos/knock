FROM denoland/deno:latest

WORKDIR /app

ENV KNOCK_RUNTIME_DIR=/app/runtime

COPY deno.json ./
COPY deno.lock ./
COPY vite.config.ts ./
COPY src ./src
COPY web ./web

RUN deno cache src/main.ts web/main.ts

CMD ["deno", "task", "start"]
