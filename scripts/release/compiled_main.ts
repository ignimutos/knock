import { parseCliCommand } from '../../src/bootstrap/parse_cli_command.ts'
import { dispatchStartupCommand } from '../../src/bootstrap/startup_orchestrator.ts'
import { startCompiledWeb } from './start_compiled_web.ts'

export async function compiledMain(args: string[]): Promise<void> {
  await dispatchStartupCommand(parseCliCommand(args), {
    startWeb: startCompiledWeb,
  })
}
