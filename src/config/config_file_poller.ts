import { statPath, type FileInfo } from '../platform/fs.ts'

export interface ConfigFilePoller {
  poll(): Promise<void>
  stop(): void
}

type IntervalHandle = ReturnType<typeof setInterval>
type ClearIntervalHandle = Parameters<typeof clearInterval>[0]

export interface CreateConfigFilePollerOptions {
  configPath: string
  onChange: () => Promise<void> | void
  intervalMs?: number
  statPathImpl?: (path: string) => Promise<FileInfo>
  setIntervalImpl?: (callback: () => void, delay: number) => IntervalHandle
  clearIntervalImpl?: (handle: ClearIntervalHandle) => void
}

function getMtimeMs(value: Date | null): number | null {
  return value ? value.getTime() : null
}

export function createConfigFilePoller(options: CreateConfigFilePollerOptions): ConfigFilePoller {
  const readFileInfo = options.statPathImpl ?? statPath
  const setIntervalImpl = options.setIntervalImpl ?? setInterval
  const clearIntervalImpl =
    options.clearIntervalImpl ??
    ((handle: ClearIntervalHandle) => {
      clearInterval(handle)
    })
  let stopped = false
  let lastMtimeMs: number | null | undefined
  let inFlightPoll: Promise<void> | undefined

  async function runPoll(): Promise<void> {
    if (stopped) return

    const info = await readFileInfo(options.configPath)
    const nextMtimeMs = getMtimeMs(info.mtime)

    if (lastMtimeMs === undefined) {
      lastMtimeMs = nextMtimeMs
      return
    }

    if (nextMtimeMs === lastMtimeMs) {
      return
    }

    lastMtimeMs = nextMtimeMs
    if (stopped) {
      return
    }
    await options.onChange()
  }

  const poll = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (inFlightPoll) return inFlightPoll

    inFlightPoll = runPoll().finally(() => {
      inFlightPoll = undefined
    })
    return inFlightPoll
  }

  const intervalHandle = setIntervalImpl(() => {
    void poll().catch(() => {})
  }, options.intervalMs ?? 1000)

  void poll().catch(() => {})

  return {
    poll,
    stop(): void {
      stopped = true
      clearIntervalImpl(intervalHandle as ClearIntervalHandle)
    },
  }
}
