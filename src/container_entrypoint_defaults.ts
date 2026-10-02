import { getEnv, getEnvObject } from './platform/env.ts'

export function hasFlag(flag: string, args: string[]): boolean {
  return args.includes(flag)
}

function parseBooleanEnv(name: string, value: string | undefined): boolean {
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
      throw new Error(`${name} 非法: ${value}`)
  }
}

export function shouldEnableImmediate(
  value: string | undefined = getEnv('KNOCK_IMMEDIATE'),
): boolean {
  return parseBooleanEnv('KNOCK_IMMEDIATE', value)
}

export function shouldEnableOnce(value: string | undefined = getEnv('KNOCK_ONCE')): boolean {
  return parseBooleanEnv('KNOCK_ONCE', value)
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

export function applyContainerDefaults(
  appArgs: string[],
  env: Record<string, string | undefined> = getEnvObject(),
): string[] {
  const nextArgs = [...appArgs]

  if (!hasFlag('--config', nextArgs)) {
    const configPath = env.KNOCK_CONFIG_PATH
    if (configPath) nextArgs.push('--config', configPath)
  }

  const hasExplicitStartupFlag = hasFlag('--once', nextArgs) || hasFlag('--immediate', nextArgs)

  if (!hasExplicitStartupFlag && shouldEnableOnce(env.KNOCK_ONCE)) {
    nextArgs.push('--once')
  }

  if (!hasExplicitStartupFlag && shouldEnableImmediate(env.KNOCK_IMMEDIATE)) {
    nextArgs.push('--immediate')
  }

  return nextArgs
}
