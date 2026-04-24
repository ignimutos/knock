import { emptyDir, ensureDir } from '@std/fs'

export interface RuntimeHarnessContext {
  runtimeDir: string
}

const STABLE_CHILD_ENV_KEYS = [
  'HOME',
  'PATH',
  'TMPDIR',
  'TEMP',
  'TMP',
  'DENO_DIR',
  'SSL_CERT_FILE',
  'SystemRoot',
  'COMSPEC',
  'PATHEXT',
] as const

type RuntimeHarnessCallback<T> = (ctx: RuntimeHarnessContext) => Promise<T> | T
type OwnedRuntimeCallback<T> = (runtimeDir: string) => Promise<T> | T

export function createStableChildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const next: Record<string, string> = {}

  for (const key of STABLE_CHILD_ENV_KEYS) {
    const value = Deno.env.get(key)
    if (value !== undefined) {
      next[key] = value
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      next[key] = value
    }
  }

  return next
}

export async function prepareRuntimeHarness(runtimeDir: string): Promise<void> {
  await emptyDir(runtimeDir)
  await ensureDir(runtimeDir)
}

export async function cleanupRuntimeHarness(runtimeDir: string): Promise<void> {
  try {
    await Deno.remove(runtimeDir, { recursive: true })
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw error
  }
}

export function withRuntimeHarness<T>(run: RuntimeHarnessCallback<T>): Promise<T>
export function withRuntimeHarness<T>(runtimeDir: string, run: OwnedRuntimeCallback<T>): Promise<T>
export async function withRuntimeHarness<T>(
  runtimeDirOrRun: string | RuntimeHarnessCallback<T>,
  maybeRun?: OwnedRuntimeCallback<T>,
): Promise<T> {
  if (typeof runtimeDirOrRun === 'string') {
    const runtimeDir = runtimeDirOrRun
    const run = maybeRun
    if (!run) {
      throw new Error('withRuntimeHarness 需要传入运行函数')
    }

    await prepareRuntimeHarness(runtimeDir)
    try {
      return await run(runtimeDir)
    } finally {
      await cleanupRuntimeHarness(runtimeDir)
    }
  }

  const run = runtimeDirOrRun
  const runtimeDir = await Deno.makeTempDir({ prefix: 'knock-test-' })
  await prepareRuntimeHarness(runtimeDir)
  try {
    return await run({ runtimeDir })
  } finally {
    await cleanupRuntimeHarness(runtimeDir)
  }
}
