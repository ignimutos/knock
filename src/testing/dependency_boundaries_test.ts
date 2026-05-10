import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEquals } from './assert.ts'
import { readDir, readTextFile } from '../platform/fs.ts'
import { test } from './test_api.ts'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(TEST_DIR, '..')
const WEB_DIR = join(SRC_DIR, '..', 'web')
const MODERN_ROOTS = [
  join(SRC_DIR, 'bootstrap'),
  join(SRC_DIR, 'config'),
  join(SRC_DIR, 'workflow'),
  join(SRC_DIR, 'persistence'),
  join(SRC_DIR, 'adapters'),
  WEB_DIR,
]
const ROOT_ENTRY_FILES = [join(SRC_DIR, 'main.ts')]
const FORBIDDEN_ROOTS = ['application/', 'composition/', 'infrastructure/', 'interfaces/', 'db/']

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readDir(dir)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory) {
      files.push(...(await collectTypeScriptFiles(fullPath)))
      continue
    }
    if (entry.isFile && (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx'))) {
      files.push(fullPath)
    }
  }

  return files
}

function collectForbiddenImports(content: string): string[] {
  const matches: string[] = []

  for (const root of FORBIDDEN_ROOTS) {
    const staticImport = new RegExp(`from\\s+['\"]([^'\"]*${root}[^'\"]*)['\"]`, 'g')
    const dynamicImport = new RegExp(`import\\(\\s*['\"]([^'\"]*${root}[^'\"]*)['\"]\\s*\\)`, 'g')

    for (const regex of [staticImport, dynamicImport]) {
      let match = regex.exec(content)
      while (match) {
        matches.push(match[1] ?? '')
        match = regex.exec(content)
      }
    }
  }

  return matches
}

test('[contract] dependency boundaries: modern roots 不应反向依赖 legacy roots', async () => {
  const files = [
    ...ROOT_ENTRY_FILES,
    ...(await Promise.all(MODERN_ROOTS.map((dir) => collectTypeScriptFiles(dir)))).flat(),
  ]
  const offenders: string[] = []

  for (const filePath of files) {
    const content = await readTextFile(filePath)
    const forbiddenImports = collectForbiddenImports(content)
    for (const forbiddenImport of forbiddenImports) {
      offenders.push(`${filePath} -> ${forbiddenImport}`)
    }
  }

  assertEquals(offenders, [])
})
