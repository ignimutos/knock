import { compiledMain } from './compiled_main.ts'
import {
  normalizeAppArgs,
  applyContainerDefaults,
} from '../../src/container_entrypoint_defaults.ts'
import { exit, getArgs, spawnCommand } from '../../src/platform/process.ts'

async function runRawCommand(args: string[]): Promise<void> {
  const command = spawnCommand(args[0]!, {
    args: args.slice(1),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const status = await command.status
  exit(status.code)
}

export async function runCompiledContainerEntrypoint(rawArgs: string[] = getArgs()): Promise<void> {
  const appArgs = normalizeAppArgs(rawArgs)

  if (!appArgs) {
    await runRawCommand(rawArgs)
    return
  }

  await compiledMain(applyContainerDefaults(appArgs))
}

runCompiledContainerEntrypoint().catch((error) => {
  console.error(error)
  exit(1)
})
