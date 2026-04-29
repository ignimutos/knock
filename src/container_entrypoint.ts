import { main } from './main.ts'
import { exit, getArgs, isMainModule, spawnCommand } from './platform/process.ts'
import {
  applyContainerDefaults,
  hasFlag,
  normalizeAppArgs,
  resolveTargetMode,
  shouldEnableImmediate,
} from './container_entrypoint_defaults.ts'

export {
  applyContainerDefaults,
  hasFlag,
  normalizeAppArgs,
  resolveTargetMode,
  shouldEnableImmediate,
}

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

export interface RunContainerEntrypointDeps {
  main?: (args: string[]) => Promise<void>
  runRawCommand?: (args: string[]) => Promise<void>
}

export async function runContainerEntrypoint(
  rawArgs: string[] = getArgs(),
  deps: RunContainerEntrypointDeps = {},
): Promise<void> {
  const appArgs = normalizeAppArgs(rawArgs)

  if (!appArgs) {
    await (deps.runRawCommand ?? runRawCommand)(rawArgs)
    return
  }

  await (deps.main ?? main)(applyContainerDefaults(appArgs))
}

if (isMainModule(import.meta.url)) {
  await runContainerEntrypoint()
}
