ARG DENO_VERSION=2.7.13

FROM denoland/deno:${DENO_VERSION} AS build

WORKDIR /app

COPY deno.json ./
COPY deno.lock ./
COPY vite.config.ts ./
COPY src ./src
COPY web ./web

RUN deno task deps:prefetch \
  && deno task build:web

RUN deno eval 'const config = JSON.parse(await Deno.readTextFile("deno.json")); delete config.imports.vite; delete config.imports["@fresh/plugin-vite"]; config.nodeModulesDir = "none"; config.tasks = { start: "deno run --cached-only --node-modules-dir=none --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-run --allow-sys src/main.ts", web: "deno task start --mode web", daemon: "deno task start --mode daemon" }; await Deno.writeTextFile("/tmp/deno.runtime.json", `${JSON.stringify(config, null, 2)}\n`);'

RUN deno eval 'await Deno.writeTextFile("/app/container_main.ts", ["import { runContainerEntrypoint } from \"./src/container_entrypoint.ts\";", "await runContainerEntrypoint();", ""].join("\n"));'

RUN deno eval 'await Deno.writeTextFile("/app/runtime_preload.ts", ["import \"./src/main.ts\";", "import \"./src/container_entrypoint.ts\";", "import \"./_fresh/server.js\";", "import \"./src/composition/create_production_runtime.ts\";", "import \"./src/web/playground_preview.ts\";", "import \"./web/client.ts\";", ""].join("\n"));'

RUN DENO_DIR=/tmp/runtime-deno-dir deno cache --config /tmp/deno.runtime.json --lock /tmp/deno.runtime.lock /app/runtime_preload.ts \
  && rm -f /app/runtime_preload.ts \
  && rm -rf node_modules

FROM denoland/deno:distroless-${DENO_VERSION}

WORKDIR /app

ENV DENO_DIR=/deno-dir
ENV KNOCK_RUNTIME_DIR=/app/runtime

COPY --from=build --chown=10001:10001 /tmp/runtime-deno-dir /deno-dir
COPY --from=build /tmp/deno.runtime.json ./deno.json
COPY --from=build /tmp/deno.runtime.lock ./deno.lock
COPY --from=build /app/container_main.ts ./container_main.ts
COPY --from=build /app/src ./src
COPY --from=build /app/_fresh ./_fresh

USER 10001:10001

EXPOSE 8000

ENTRYPOINT ["deno", "run", "--cached-only", "--node-modules-dir=none", "--allow-read", "--allow-write", "--allow-env", "--allow-net", "--allow-ffi", "--allow-run", "--allow-sys", "container_main.ts"]
CMD []
