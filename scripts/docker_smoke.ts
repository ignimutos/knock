import { join } from '@std/path'

const image = Deno.env.get('KNOCK_IMAGE_TAG') ?? 'knock:local'
const runtimeRoot = await Deno.makeTempDir({ prefix: 'knock-docker-smoke-' })
const runtimeDir = join(runtimeRoot, 'runtime')
const logPath = join(runtimeDir, 'logs', 'app.jsonl')

await Deno.mkdir(runtimeDir, { recursive: true })
await Deno.chmod(runtimeDir, 0o777)

await Deno.writeTextFile(
  join(runtimeDir, 'config.yml'),
  [
    'sqlite:',
    '  path: knock.db',
    '',
    'logging:',
    '  sinks:',
    '    file:',
    '      type: file',
    '      format: jsonl',
    '      path: logs/app.jsonl',
    '',
    'sources: {}',
    '',
  ].join('\n'),
)

async function run(command: Deno.Command): Promise<Deno.CommandOutput> {
  const output = await command.output()
  if (!output.success) {
    throw new Error(
      new TextDecoder().decode(output.stderr).trim() || `command failed: ${output.code}`,
    )
  }
  return output
}

async function waitForWebReady(port: number): Promise<void> {
  const deadline = Date.now() + 20_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/config`)
      if (response.ok) {
        const html = await response.text()
        if (html.includes('Knock Config')) return
        lastError = new Error('unexpected ready payload')
      } else {
        lastError = new Error(`unexpected status: ${response.status}`)
      }
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw lastError instanceof Error ? lastError : new Error('等待 Docker Web 服务就绪超时')
}

const daemonRun = new Deno.Command('docker', {
  args: [
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${runtimeDir}:/app/runtime`,
    image,
    '--mode',
    'daemon',
    '--immediate',
  ],
  stdout: 'piped',
  stderr: 'piped',
})
await run(daemonRun)
await Deno.stat(logPath)

const portListener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
const { port } = portListener.addr as Deno.NetAddr
portListener.close()

const containerName = `knock-docker-smoke-${crypto.randomUUID()}`
const webRun = await run(
  new Deno.Command('docker', {
    args: [
      'run',
      '--detach',
      '--name',
      containerName,
      '-v',
      `${runtimeDir}:/app/runtime`,
      '-p',
      `${port}:8000`,
      '-e',
      'KNOCK_WEB_HOST=0.0.0.0',
      '-e',
      'KNOCK_WEB_PORT=8000',
      image,
    ],
    stdout: 'piped',
    stderr: 'piped',
  }),
)

const containerId = new TextDecoder().decode(webRun.stdout).trim()

try {
  await waitForWebReady(port)
} finally {
  await new Deno.Command('docker', {
    args: ['rm', '-f', containerId || containerName],
    stdout: 'null',
    stderr: 'null',
  })
    .output()
    .catch(() => undefined)
}

await Deno.remove(runtimeRoot, { recursive: true })
