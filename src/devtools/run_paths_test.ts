import { assertEquals } from '@std/assert'

const workspaceRoot = new URL('../../', import.meta.url).pathname
const scriptPath = new URL('../../scripts/run-paths.sh', import.meta.url)

async function runScript(args: string[]) {
  const result = await new Deno.Command('bash', {
    args: [scriptPath.pathname, ...args],
    cwd: workspaceRoot,
    stdout: 'piped',
    stderr: 'piped',
  }).output()

  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  }
}

Deno.test('run-paths: 未传 paths 时保留默认参数', async () => {
  const result = await runScript([
    'deno',
    'eval',
    'console.log(Deno.args.join("|"))',
    '--',
    'default-a',
    'default-b',
  ])

  assertEquals(result.code, 0, result.stderr)
  assertEquals(result.stdout, 'default-a|default-b')
})

Deno.test('run-paths: 传入 paths 时覆盖默认参数', async () => {
  const result = await runScript([
    'deno',
    'eval',
    'console.log(Deno.args.join("|"))',
    '--',
    'default-a',
    'default-b',
    '--',
    'path-a',
    'path-b',
  ])

  assertEquals(result.code, 0, result.stderr)
  assertEquals(result.stdout, 'path-a|path-b')
})

Deno.test('check task: 传入 paths 时覆盖默认 check 目标', async () => {
  const result = await runScript([
    'deno',
    'check',
    '--',
    'src/main.ts',
    'web/main.ts',
    'web/routes/**/*.tsx',
    'web/islands/**/*.tsx',
    '--',
    'src/devtools/run_paths_test.ts',
  ])

  assertEquals(result.code, 0, result.stderr)
  assertEquals(result.stdout, '')
  assertEquals(result.stderr, '')
})
