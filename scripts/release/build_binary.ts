import { mkdir, rm } from 'node:fs/promises'

async function run(command: string[], failureMessage: string): Promise<void> {
  const child = Bun.spawn(command, {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`${failureMessage}: ${code}`)
  }
}

await mkdir('dist', { recursive: true })
await rm('dist/knock-linux-x64', { force: true })

await run(['bun', 'run', 'build:web'], 'build:web failed')
await run(
  [
    'bun',
    'build',
    './scripts/release/compiled_container_main.ts',
    '--compile',
    '--target=bun-linux-x64',
    '--minify',
    '--bytecode',
    '--outfile',
    './dist/knock-linux-x64',
  ],
  'binary compile failed',
)
