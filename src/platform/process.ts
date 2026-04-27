export interface SpawnOptions {
  args: string[]
  env?: Record<string, string>
  cwd?: string
  stdin?: 'inherit' | 'piped' | 'null'
  stdout?: 'inherit' | 'piped' | 'null'
  stderr?: 'inherit' | 'piped' | 'null'
}

export function execPath(): string {
  return Deno.execPath()
}

export function exit(code: number): never {
  Deno.exit(code)
}

export function spawnSelf(options: SpawnOptions): Deno.ChildProcess {
  return new Deno.Command(execPath(), {
    args: options.args,
    env: options.env,
    cwd: options.cwd,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
  }).spawn()
}

export function spawnCommand(command: string, options: SpawnOptions): Deno.ChildProcess {
  return new Deno.Command(command, {
    args: options.args,
    env: options.env,
    cwd: options.cwd,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
  }).spawn()
}
