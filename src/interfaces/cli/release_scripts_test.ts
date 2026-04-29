import { assert, assertEquals } from '../../testing/assert.ts'
import { existsSync, readFileSync } from 'node:fs'
import { test } from '../../testing/test_api.ts'

type PackageJson = {
  scripts?: Record<string, string>
}

test('[contract] package.json scripts: binary release entrypoints', () => {
  const text = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
  const parsed = JSON.parse(text) as PackageJson
  const scripts = parsed.scripts ?? {}

  assertEquals(scripts['build:binary'], 'bun run scripts/release/build_binary.ts')
  assertEquals(scripts['smoke:binary'], 'bash ./scripts/release/smoke_binary.sh')

  assert(existsSync(new URL('../../../scripts/release/build_binary.ts', import.meta.url)))
  assert(existsSync(new URL('../../../scripts/release/smoke_binary.sh', import.meta.url)))
})
