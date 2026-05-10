import { getEnvObject } from '../platform/env.ts'
import { spawnSelf, type SpawnedProcess } from '../platform/process.ts'
import { startWeb, type StartWebOptions } from '../adapters/web/start_web.ts'
import {
  startDaemonProcess,
  type StartDaemonProcessOptions,
} from './start_daemon_process.ts'
import { resolveDaemonStartOptions, type CliCommand } from './parse_cli_command.ts'
import { runAllModeProcesses } from './process_orchestration.ts'

export interface StartupOrchestratorDeps {
  startDaemon?: (options: StartDaemonProcessOptions) => Promise<unknown>
  startWeb?: (options: StartWebOptions) => Promise<void>
  spawnChild?: (input: {
    args: string[]
    env: Record<string, string | undefined>
  }) => SpawnedProcess
  env?: Record<string, string | undefined>
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

  await runAllModeProcesses(command, {
    env,
    spawnChild,
  })
}
