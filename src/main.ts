import { main } from './bootstrap/dispatch_cli_command.ts'
import { getArgs, isMainModule } from './platform/process.ts'

export {
  dispatchCliCommand,
  main,
  startApp,
  startWeb,
  type StartAppOptions,
  type StartAppResult,
} from './bootstrap/dispatch_cli_command.ts'

if (isMainModule(import.meta.url)) {
  await main(getArgs())
}
