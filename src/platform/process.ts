import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'

export interface SpawnOptions {
  args: string[]
  env?: Record<string, string>
  cwd?: string
  stdin?: 'inherit' | 'piped' | 'null'
  stdout?: 'inherit' | 'piped' | 'null'
  stderr?: 'inherit' | 'piped' | 'null'
}

export interface ProcessStatus {
  success: boolean
  code: number
  signal?: NodeJS.Signals
}

export interface SpawnedProcess {
  status: Promise<ProcessStatus>
  kill(signal?: NodeJS.Signals): void
}

function toStdio(value: SpawnOptions['stdin']): 'inherit' | 'pipe' | 'ignore' {
  if (value === 'piped') return 'pipe'
  if (value === 'null') return 'ignore'
  return 'inherit'
}

function wrapChildProcess(child: ChildProcess): SpawnedProcess {
  return {
    status: new Promise<ProcessStatus>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        resolve({
          success: code === 0,
          code: code ?? 1,
          signal: signal ?? undefined,
        })
      })
    }),
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      child.kill(signal)
    },
  }
}

function spawnProcess(command: string, options: SpawnOptions): SpawnedProcess {
  return wrapChildProcess(
    spawn(command, options.args, {
      env: options.env,
      cwd: options.cwd,
      stdio: [toStdio(options.stdin), toStdio(options.stdout), toStdio(options.stderr)],
    }),
  )
}

export function execPath(): string {
  return process.execPath
}

export function exit(code: number): never {
  process.exit(code)
}

export function getArgs(): string[] {
  return process.argv.slice(2)
}

export function spawnSelf(options: SpawnOptions): SpawnedProcess {
  return spawnProcess(execPath(), options)
}

export function spawnCommand(command: string, options: SpawnOptions): SpawnedProcess {
  return spawnProcess(command, options)
}
