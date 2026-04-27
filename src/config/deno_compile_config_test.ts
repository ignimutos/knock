import { assertEquals } from '@std/assert'
import { test } from '../testing/test_api.ts'

interface DenoConfigShape {
  compilerOptions?: Record<string, unknown>
  imports?: Record<string, string>
  nodeModulesDir?: string
  lock?: {
    path?: string
  }
}

function readJsonConfig(path: string): DenoConfigShape {
  return JSON.parse(Deno.readTextFileSync(new URL(path, import.meta.url))) as DenoConfigShape
}

test('[contract] docker/deno.compile.json: 应与 deno.json 保持运行时依赖同步并排除 build-time imports', () => {
  const baseConfig = readJsonConfig('../../deno.json')
  const compileConfig = readJsonConfig('../../docker/deno.compile.json')
  const excludedImports = new Set(['vite', '@fresh/plugin-vite'])

  const expectedImports = Object.fromEntries(
    Object.entries(baseConfig.imports ?? {}).filter(([key]) => !excludedImports.has(key)),
  )

  assertEquals(baseConfig.imports?.vite, 'npm:vite@^7.3.2')
  assertEquals(baseConfig.imports?.['@fresh/plugin-vite'], 'jsr:@fresh/plugin-vite@^1.0.8')
  assertEquals(compileConfig.compilerOptions, baseConfig.compilerOptions)
  assertEquals(compileConfig.nodeModulesDir, 'none')
  assertEquals(compileConfig.lock?.path, '../deno.lock')
  assertEquals(compileConfig.imports, expectedImports)
})
