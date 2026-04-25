import { main } from './main.ts'

export function hasFlag(flag: string, args: string[]): boolean {
  return args.includes(flag)
}

export function shouldEnableImmediate(): boolean {
  const value = Deno.env.get('KNOCK_IMMEDIATE')

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

  return 'web'
}

export function normalizeAppArgs(rawArgs: string[]): string[] | undefined {
  if (rawArgs.length === 0) return ['--mode', 'web']
  if (rawArgs[0] === 'deno' && rawArgs[1] === 'task' && rawArgs[2] === 'start') {
    return rawArgs.slice(3)
  }
  if (rawArgs[0]?.startsWith('--')) return [...rawArgs]
  return undefined
}

async function runRawCommand(args: string[]): Promise<void> {
  const command = new Deno.Command(args[0]!, {
    args: args.slice(1),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const status = await command.status
  Deno.exit(status.code)
}

export async function runContainerEntrypoint(rawArgs: string[] = [...Deno.args]): Promise<void> {
  const appArgs = normalizeAppArgs(rawArgs)

  if (!appArgs) {
    await runRawCommand(rawArgs)
    return
  }

  if (!hasFlag('--config', appArgs)) {
    const configPath = Deno.env.get('KNOCK_CONFIG_PATH')
    if (configPath) appArgs.push('--config', configPath)
  }

  const targetMode = resolveTargetMode(appArgs)
  if (targetMode === 'web' && !hasFlag('--web_host', appArgs)) {
    const webHost = Deno.env.get('KNOCK_WEB_HOST')
    if (webHost) appArgs.push('--web_host', webHost)
  }

  if (targetMode === 'web' && !hasFlag('--web_port', appArgs)) {
    const webPort = Deno.env.get('KNOCK_WEB_PORT')
    if (webPort) appArgs.push('--web_port', webPort)
  }

  if (!hasFlag('--immediate', appArgs) && shouldEnableImmediate()) {
    appArgs.push('--immediate')
  }

  await main(appArgs)
}

if (import.meta.main) {
  await runContainerEntrypoint()
}
