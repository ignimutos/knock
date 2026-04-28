import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

export async function emptyDir(path) {
  await rm(path, { recursive: true, force: true })
  await mkdir(path, { recursive: true })
}

export async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function* walk(root, options = {}) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (options.includeDirs !== false) {
        yield { path, name: entry.name, isFile: false, isDirectory: true }
      }
      yield* walk(path, options)
      continue
    }
    if (!entry.isFile()) continue
    if (options.exts && !options.exts.some((ext) => path.endsWith(ext))) continue
    if (options.match && !options.match.some((pattern) => pattern.test(path))) continue
    yield { path, name: entry.name, isFile: true, isDirectory: false }
  }
}
