import { getEnvObject } from '../../platform/env.ts'
import { spawnSelf, type ProcessStatus, type SpawnedProcess } from '../../platform/process.ts'
import {
  buildChildArgs,
  resolveDaemonStartOptions,
  type CliCommand,
} from '../cli/parse_cli_command.ts'
import {
  SKIP_WEB_RUNTIME_READY_CHECK_ENV,
  startWeb,
  type StartWebOptions,
} from '../web/start_web.ts'
import { startDaemonProcess, type StartDaemonProcessOptions } from './start_daemon_process.ts'

export interface StartupOrchestratorDeps {
  startDaemon?: (options: StartDaemonProcessOptions) => Promise<unknown>
  startWeb?: (options: StartWebOptions) => Promise<void>
  spawnChild?: (input: {
    args: string[]
    env: Record<string, string | undefined>
  }) => SpawnedProcess
  env?: Record<string, string | undefined>
}

function buildChildEnv(
  command: Extract<CliCommand, { kind: 'all' }>,
  env: Record<string, string | undefined>,
) {
  return {
    ...env,
    ...(command.configPath ? { KNOCK_CONFIG_PATH: command.configPath } : {}),
    ...(command.runtimeDir ? { KNOCK_RUNTIME_DIR: command.runtimeDir } : {}),
  }
}

function stopChild(child: SpawnedProcess): void {
  try {
    child.kill('SIGTERM')
  } catch {
    // noop
  }
}

export async function dispatchStartupCommand(
  command: CliCommand,
  deps: StartupOrchestratorDeps = {},
): Promise<void> {
  const env = deps.env ?? getEnvObject()
  const startDaemon = deps.startDaemon ?? startDaemonProcess
  const startWebServer = deps.startWeb ?? startWeb
  const spawnChild =
    deps.spawnChild ??
    ((input) =>
      spawnSelf({
        args: input.args,
        env: input.env as Record<string, string>,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      }))

  if (command.kind === 'daemon') {
    await startDaemon(resolveDaemonStartOptions(command, env))
    return
  }

  if (command.kind === 'web') {
    await startWebServer({ host: command.host, port: command.port })
    return
  }

  const childEnv = buildChildEnv(command, env)
  const daemonChild = spawnChild({
    args: buildChildArgs(command, 'daemon'),
    env: childEnv,
  })
  const webChild = spawnChild({
    args: buildChildArgs(command, 'web'),
    env: {
      ...childEnv,
      [SKIP_WEB_RUNTIME_READY_CHECK_ENV]: '1',
    },
  })

  let daemonSettled = false
  let daemonResult: ProcessStatus | undefined
  const daemonStatus = daemonChild.status.then((status) => {
    daemonSettled = true
    daemonResult = status
    return status
  })

  let webSettled = false
  let webResult: ProcessStatus | undefined
  const webStatus = webChild.status.then((status) => {
    webSettled = true
    webResult = status
    return status
  })

  const firstExit = await Promise.race([
    daemonStatus.then((status) => ({ name: 'daemon' as const, status })),
    webStatus.then((status) => ({ name: 'web' as const, status })),
  ])

  const otherChild = firstExit.name === 'daemon' ? webChild : daemonChild
  const otherName = firstExit.name === 'daemon' ? ('web' as const) : ('daemon' as const)
  const otherSettled = firstExit.name === 'daemon' ? webSettled : daemonSettled
  const otherResult = firstExit.name === 'daemon' ? webResult : daemonResult
  const otherStatus = firstExit.name === 'daemon' ? webStatus : daemonStatus

  if (!firstExit.status.success) {
    stopChild(otherChild)
    await Promise.allSettled([daemonStatus, webStatus])
    throw new Error(`${firstExit.name} 子进程异常退出: ${firstExit.status.code}`)
  }

  if (!otherSettled) {
    stopChild(otherChild)
    await Promise.allSettled([daemonStatus, webStatus])
    return
  }

  if (!otherResult?.success) {
    throw new Error(`${otherName} 子进程异常退出: ${otherResult?.code ?? 1}`)
  }

  await otherStatus
}
