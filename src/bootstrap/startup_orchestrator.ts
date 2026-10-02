import { getEnvObject } from '../platform/env.ts'
import { startDaemonProcess, type StartDaemonProcessOptions } from './start_daemon_process.ts'
import { resolveDaemonStartOptions, type CliCommand } from './parse_cli_command.ts'

export interface StartupOrchestratorDeps {
  startDaemon?: (options: StartDaemonProcessOptions) => Promise<unknown>
  env?: Record<string, string | undefined>
}

export async function dispatchStartupCommand(
  command: CliCommand,
  deps: StartupOrchestratorDeps = {},
): Promise<void> {
  const env = deps.env ?? getEnvObject()
  const startDaemon = deps.startDaemon ?? startDaemonProcess

  await startDaemon(resolveDaemonStartOptions(command, env))
}
