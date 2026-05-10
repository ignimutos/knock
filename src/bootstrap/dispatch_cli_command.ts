import { parseCliCommand, type CliCommand } from './parse_cli_command.ts'
import { dispatchStartupCommand } from './startup_orchestrator.ts'
import { startWeb as startWebImpl } from '../adapters/web/start_web.ts'

export { startDaemonProcess as startApp } from './start_daemon_process.ts'
export type {
  StartDaemonProcessOptions as StartAppOptions,
  StartDaemonProcessResult as StartAppResult,
} from './start_daemon_process.ts'

export const startWeb = startWebImpl

export interface DispatchCliCommandDeps {
  dispatchStartupCommand?: (command: CliCommand) => Promise<void>
}

export async function dispatchCliCommand(
  command: CliCommand,
  deps: DispatchCliCommandDeps = {},
): Promise<void> {
  await (deps.dispatchStartupCommand ?? dispatchStartupCommand)(command)
}

export async function main(args: string[], deps: DispatchCliCommandDeps = {}): Promise<void> {
  await dispatchCliCommand(parseCliCommand(args), deps)
}
