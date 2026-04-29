import { assertEquals } from '../../testing/assert.ts'
import { readFileSync } from 'node:fs'
import { test } from '../../testing/test_api.ts'

type PackageJson = {
  scripts?: Record<string, string>
}

test('[contract] package.json scripts: 外部 JS CLI 应显式由 Bun 执行', () => {
  const text = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
  const parsed = JSON.parse(text) as PackageJson
  const scripts = parsed.scripts ?? {}

  assertEquals(scripts['build:web'], 'bun --bun vite build --configLoader native')
  assertEquals(scripts.check, 'bun --bun tsc --project tsconfig.json')
  assertEquals(scripts.fmt, 'bun --bun prettier --write .')
  assertEquals(
    scripts['fmt:path'],
    'bash ./scripts/run-paths.sh bun --bun prettier --write -- . --',
  )
  assertEquals(scripts['fmt:check'], 'bun --bun prettier --check .')
  assertEquals(
    scripts['fmt:check:path'],
    'bash ./scripts/run-paths.sh bun --bun prettier --check -- . --',
  )
})
