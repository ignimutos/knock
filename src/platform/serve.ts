export interface ServeOptions {
  hostname: string
  port: number
  signal: AbortSignal
}

export interface ServerHandle {
  finished: Promise<void>
  shutdown: () => Promise<void>
}

export function serve(
  options: ServeOptions,
  handler: (request: Request) => Response | Promise<Response>,
): ServerHandle {
  const server = Deno.serve(options, handler)
  return {
    finished: server.finished,
    shutdown: () => server.shutdown(),
  }
}
