type RuntimeWithServe = typeof globalThis & {
  Bun?: {
    serve: (options: {
      hostname: string
      port: number
      fetch: (request: Request) => Response | Promise<Response>
    }) => {
      stop: () => void
    }
  }
  Deno?: {
    serve: (
      options: {
        hostname: string
        port: number
        signal: AbortSignal
      },
      handler: (request: Request) => Response | Promise<Response>,
    ) => {
      finished: Promise<void>
      shutdown(): Promise<void>
    }
  }
}

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
  const runtime = globalThis as RuntimeWithServe

  if (runtime.Bun?.serve) {
    let resolveFinished: (() => void) | undefined
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve
    })
    let stopped = false
    const server = runtime.Bun.serve({
      hostname: options.hostname,
      port: options.port,
      fetch: handler,
    })

    const shutdown = () => {
      if (stopped) return Promise.resolve()
      stopped = true
      server.stop()
      resolveFinished?.()
      return Promise.resolve()
    }

    if (options.signal.aborted) {
      void shutdown()
    } else {
      options.signal.addEventListener(
        'abort',
        () => {
          void shutdown()
        },
        { once: true },
      )
    }

    return {
      finished,
      shutdown,
    }
  }

  if (runtime.Deno?.serve) {
    const server = runtime.Deno.serve(options, handler)
    return {
      finished: server.finished,
      shutdown: () => server.shutdown(),
    }
  }

  throw new Error('当前运行时不支持 HTTP 服务')
}

export function isAddrInUseError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}
