import process from 'node:process'

export function getEnv(name: string): string | undefined {
  return process.env[name]
}

export function setEnv(name: string, value: string): void {
  process.env[name] = value
}

export function deleteEnv(name: string): void {
  delete process.env[name]
}

export function getEnvObject(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}
