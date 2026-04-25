FROM denoland/deno:latest AS build

WORKDIR /app

COPY deno.json ./
COPY deno.lock ./
COPY vite.config.ts ./
COPY src ./src
COPY web ./web

RUN deno cache --node-modules-dir=none src/main.ts web/main.ts vite.config.ts npm:vite \
  && deno task build:web

RUN deno eval 'const config = JSON.parse(await Deno.readTextFile("deno.json")); delete config.imports.vite; delete config.imports["@fresh/plugin-vite"]; config.nodeModulesDir = "none"; config.tasks = { start: "deno run --cached-only --node-modules-dir=none --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-run --allow-sys src/main.ts", web: "deno task start --mode web", daemon: "deno task start --mode daemon" }; await Deno.writeTextFile("/tmp/deno.runtime.json", `${JSON.stringify(config, null, 2)}\n`);'

RUN deno eval 'await Deno.writeTextFile("/app/runtime_preload.ts", ["import \"./src/main.ts\";", "import \"./_fresh/server.js\";", "import \"./src/composition/create_production_runtime.ts\";", "import \"./src/web/playground_preview.ts\";", "import \"./web/client.ts\";", ""].join("\n"));'

RUN DENO_DIR=/tmp/runtime-deno-dir deno cache --config /tmp/deno.runtime.json --lock /tmp/deno.runtime.lock /app/runtime_preload.ts \
  && rm -f /app/runtime_preload.ts \
  && rm -rf node_modules

FROM denoland/deno:bin AS deno-bin

FROM debian:bookworm-slim

WORKDIR /app

ENV DENO_DIR=/deno-dir
ENV KNOCK_RUNTIME_DIR=/app/runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 knock

COPY --from=deno-bin /deno /usr/local/bin/deno
COPY --from=build /tmp/runtime-deno-dir /deno-dir
COPY --from=build /tmp/deno.runtime.json ./deno.json
COPY --from=build /tmp/deno.runtime.lock ./deno.lock
COPY --from=build /app/src ./src
COPY --from=build /app/_fresh ./_fresh
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh

RUN chown -R knock:knock /app /deno-dir
USER knock

ENTRYPOINT ["/entrypoint.sh"]
CMD ["deno", "task", "start", "--mode", "web"]
