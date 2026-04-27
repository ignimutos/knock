export function getEnv(name: string): string | undefined {
  return Deno.env.get(name)
}

export function setEnv(name: string, value: string): void {
  Deno.env.set(name, value)
}

export function deleteEnv(name: string): void {
  Deno.env.delete(name)
}

export function getEnvObject(): Record<string, string> {
  return Deno.env.toObject()
}
