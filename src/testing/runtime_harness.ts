import { dirname, join } from 'node:path'
import { deleteEnv, getEnv, setEnv } from '../platform/env.ts'
import {
  makeTempDir,
  mkdirPath,
  removePath,
  writeTextFile as writePlatformTextFile,
} from '../platform/fs.ts'

export interface RuntimeHarnessContext {
  runtimeDir: string
}

export interface WithEnvOptions {
  clear?: boolean
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
    const value = getEnv(key)
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
  await removePath(runtimeDir, { recursive: true, force: true })
  await mkdirPath(runtimeDir, { recursive: true })
}

export async function cleanupRuntimeHarness(runtimeDir: string): Promise<void> {
  await removePath(runtimeDir, { recursive: true, force: true })
}

export async function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T> | T,
  options: WithEnvOptions = {},
): Promise<T> {
  const previous = new Map<string, string | undefined>()

  for (const key of Object.keys(values)) {
    previous.set(key, getEnv(key))
  }

  if (options.clear) {
    for (const key of Object.keys(values)) {
      deleteEnv(key)
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      setEnv(key, value)
    } else {
      deleteEnv(key)
    }
  }

  try {
    return await run()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        deleteEnv(key)
      } else {
        setEnv(key, value)
      }
    }
  }
}

export async function writeTextFile(path: string, content: string): Promise<string> {
  await mkdirPath(dirname(path), { recursive: true })
  await writePlatformTextFile(path, content)
  return path
}

export async function writeRuntimeFile(
  runtimeDir: string,
  relativePath: string,
  content: string,
): Promise<string> {
  return await writeTextFile(join(runtimeDir, relativePath), content)
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
  const runtimeDir = await makeTempDir('knock-test-')
  await prepareRuntimeHarness(runtimeDir)
  try {
    return await run({ runtimeDir })
  } finally {
    await cleanupRuntimeHarness(runtimeDir)
  }
}
