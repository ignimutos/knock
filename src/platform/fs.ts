import { mkdirSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

export interface FileInfo {
  isFile: boolean
  isDirectory: boolean
  size: number
  mtime: Date | null
}

export interface DirEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
}

function toFileInfo(stats: Awaited<ReturnType<typeof stat>>): FileInfo {
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    size: Number(stats.size),
    mtime: stats.mtime,
  }
}

export function cwd(): string {
  return process.cwd()
}

export async function readTextFile(path: string): Promise<string> {
  return await readFile(path, 'utf8')
}

export async function writeTextFile(
  path: string,
  content: string,
  options: { append?: boolean } = {},
): Promise<void> {
  await writeFile(path, content, {
    encoding: 'utf8',
    flag: options.append ? 'a' : 'w',
  })
}

export async function statPath(path: string): Promise<FileInfo> {
  return toFileInfo(await stat(path))
}

export async function mkdirPath(
  path: string,
  options: { recursive?: boolean } = {},
): Promise<void> {
  await mkdir(path, { recursive: options.recursive ?? false })
}

export function mkdirPathSync(path: string, options: { recursive?: boolean } = {}): void {
  mkdirSync(path, { recursive: options.recursive ?? false })
}

export async function removePath(
  path: string,
  options: { recursive?: boolean; force?: boolean } = {},
): Promise<void> {
  await rm(path, {
    recursive: options.recursive ?? false,
    force: options.force ?? false,
  })
}

export async function renamePath(from: string, to: string): Promise<void> {
  await rename(from, to)
}

export async function makeTempDir(prefix: string = 'knock-'): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

export async function readDir(path: string): Promise<DirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }))
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
