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
  assertEquals(scripts['smoke:image'], 'bash ./scripts/release/smoke_image.sh')
  assertEquals(scripts['measure:cold-start'], 'bash ./scripts/release/measure_cold_start.sh')
  assertEquals(
    scripts['image:prepare'],
    'bun run docker:build && bun run smoke:image && bun run docker:size:check',
  )
  assertEquals(
    scripts['release:prepare'],
    'bun run verify:full && bun run build:binary && bun run smoke:binary && bun run image:prepare',
  )

  assert(existsSync(new URL('../../../scripts/release/build_binary.ts', import.meta.url)))
  assert(existsSync(new URL('../../../scripts/release/smoke_binary.sh', import.meta.url)))
  assert(existsSync(new URL('../../../scripts/release/smoke_image.sh', import.meta.url)))
  assert(existsSync(new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)))
})
