import { join } from 'node:path'
import { isNotFoundError, mkdirPath, readDir, removePath, statPath } from '../platform/fs.ts'

export async function ensureDir(path: string): Promise<void> {
  await mkdirPath(path, { recursive: true })
}

export async function exists(path: string): Promise<boolean> {
  try {
    await statPath(path)
    return true
  } catch (error) {
    if (isNotFoundError(error)) {
      return false
    }
    throw error
  }
}

export async function emptyDir(path: string): Promise<void> {
  await removePath(path, { recursive: true, force: true })
  await ensureDir(path)
}

export interface WalkEntry {
  path: string
}

export async function* walk(
  root: string,
  options: { includeDirs?: boolean; match?: RegExp[] } = {},
): AsyncIterable<WalkEntry> {
  for (const entry of await readDir(root)) {
    const absolutePath = join(root, entry.name)
    if (entry.isDirectory) {
      if (
        options.includeDirs &&
        (!options.match || options.match.some((pattern) => pattern.test(absolutePath)))
      ) {
        yield { path: absolutePath }
      }
      yield* walk(absolutePath, options)
      continue
    }

    if (!options.match || options.match.some((pattern) => pattern.test(absolutePath))) {
      yield { path: absolutePath }
    }
  }
}
