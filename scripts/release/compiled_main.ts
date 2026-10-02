import { parseCliCommand } from '../../src/bootstrap/parse_cli_command.ts'
import { dispatchStartupCommand } from '../../src/bootstrap/startup_orchestrator.ts'

export async function compiledMain(args: string[]): Promise<void> {
  await dispatchStartupCommand(parseCliCommand(args))
}
