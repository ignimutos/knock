import { main } from './main.ts'
import { getEnv, getEnvObject } from './platform/env.ts'
import { exit, getArgs, isMainModule, spawnCommand } from './platform/process.ts'

export function hasFlag(flag: string, args: string[]): boolean {
  return args.includes(flag)
}

export function shouldEnableImmediate(
  value: string | undefined = getEnv('KNOCK_IMMEDIATE'),
): boolean {
  switch (value) {
    case undefined:
    case '':
      return false
    case '1':
    case 'true':
    case 'TRUE':
    case 'yes':
    case 'YES':
    case 'on':
    case 'ON':
      return true
    case '0':
    case 'false':
    case 'FALSE':
    case 'no':
    case 'NO':
    case 'off':
    case 'OFF':
      return false
    default:
      throw new Error(`KNOCK_IMMEDIATE 非法: ${value}`)
  }
}

export function resolveTargetMode(args: string[]): 'web' | 'daemon' | 'all' {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--mode') {
      const value = args[index + 1]
      if (value === 'daemon' || value === 'all' || value === 'web') return value
    }
  }

  return 'all'
}

export function normalizeAppArgs(rawArgs: string[]): string[] | undefined {
  if (rawArgs.length === 0) return []
  if (rawArgs[0] === 'bun' && rawArgs[1] === 'run' && rawArgs[2] === 'start') {
    return rawArgs.slice(3)
  }
  if (rawArgs[0] === 'bun' && rawArgs[1] === 'start') {
    return rawArgs.slice(2)
  }
  if (rawArgs[0]?.startsWith('--')) return [...rawArgs]
  return undefined
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

export function applyContainerDefaults(
  appArgs: string[],
  env: Record<string, string | undefined> = getEnvObject(),
): string[] {
  const nextArgs = [...appArgs]
  const targetMode = resolveTargetMode(nextArgs)

  if (targetMode !== 'web' && !hasFlag('--config', nextArgs)) {
    const configPath = env.KNOCK_CONFIG_PATH
    if (configPath) nextArgs.push('--config', configPath)
  }

  if (targetMode !== 'daemon' && !hasFlag('--web_host', nextArgs)) {
    const webHost = env.KNOCK_WEB_HOST
    if (webHost) nextArgs.push('--web_host', webHost)
  }

  if (targetMode !== 'daemon' && !hasFlag('--web_port', nextArgs)) {
    const webPort = env.KNOCK_WEB_PORT
    if (webPort) nextArgs.push('--web_port', webPort)
  }

  if (!hasFlag('--immediate', nextArgs) && shouldEnableImmediate(env.KNOCK_IMMEDIATE)) {
    nextArgs.push('--immediate')
  }

  return nextArgs
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
