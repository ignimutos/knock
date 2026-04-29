import { parseCliCommand } from '../../src/interfaces/cli/parse_cli_command.ts'
import { dispatchStartupCommand } from '../../src/interfaces/startup/startup_orchestrator.ts'
import { startCompiledWeb } from './start_compiled_web.ts'

export async function compiledMain(args: string[]): Promise<void> {
  await dispatchStartupCommand(parseCliCommand(args), {
    startWeb: startCompiledWeb,
  })
}
