import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { assertEquals } from './testing/assert.ts'
import { cwd, makeTempDir, removePath } from './platform/fs.ts'
import { execPath } from './platform/process.ts'
import { test } from './testing/test_api.ts'

async function readStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return ''

  let output = ''
  for await (const chunk of stream) {
    output += chunk.toString()
  }
  return output
}

test('[unit] compiled release entrypoint: bun build --compile 应能解析入口依赖', async () => {
  const tempDir = await makeTempDir('knock-compiled-build-')
  const outfile = join(tempDir, 'knock-linux-x64')
  const child = spawn(
    execPath(),
    [
      'build',
      './scripts/release/compiled_container_main.ts',
      '--compile',
      '--target=bun-linux-x64',
      '--outfile',
      outfile,
    ],
    {
      cwd: cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )

  try {
    const statusPromise = new Promise<{ success: boolean; code: number }>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => {
        resolve({
          success: code === 0,
          code: code ?? 1,
        })
      })
    })
    const [status, stderr] = await Promise.all([statusPromise, readStream(child.stderr)])

    assertEquals(status.success, true, stderr || `bun build 退出码异常: ${status.code}`)
  } finally {
    await removePath(tempDir, { recursive: true, force: true })
  }
})
