import { emptyDir, ensureDir } from '@std/fs'

export async function prepareOwnedRuntime(runtimeDir: string): Promise<void> {
  await emptyDir(runtimeDir)
  await ensureDir(runtimeDir)
}

export async function cleanupOwnedRuntime(runtimeDir: string): Promise<void> {
  try {
    await Deno.remove(runtimeDir, { recursive: true })
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw error
  }
}

export async function withOwnedRuntime<T>(
  runtimeDir: string,
  run: (runtimeDir: string) => Promise<T> | T,
): Promise<T> {
  await prepareOwnedRuntime(runtimeDir)
  try {
    return await run(runtimeDir)
  } finally {
    await cleanupOwnedRuntime(runtimeDir)
  }
}
