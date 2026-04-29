import { getArgs, isMainModule } from './platform/process.ts'
import { parseCliCommand, type CliCommand } from './interfaces/cli/parse_cli_command.ts'
import { dispatchStartupCommand } from './interfaces/startup/startup_orchestrator.ts'
import { startWeb as startWebImpl } from './interfaces/web/start_web.ts'

export { startDaemonProcess as startApp } from './interfaces/startup/start_daemon_process.ts'
export type {
  StartDaemonProcessOptions as StartAppOptions,
  StartDaemonProcessResult as StartAppResult,
} from './interfaces/startup/start_daemon_process.ts'

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

if (isMainModule(import.meta.url)) {
  await main(getArgs())
}
