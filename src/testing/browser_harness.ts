import { join } from '@std/path'
import { createFactsDbClient } from '../db/client.ts'
import { insertPipelineItem } from '../infrastructure/sqlite/item_repository.ts'
import {
  insertSourceRun,
  setSourceRunFeedSnapshot,
} from '../infrastructure/sqlite/run_repository.ts'
import { withRuntimeHarness } from './runtime_harness.ts'

export interface BrowserSmokeAppContext {
  runtimeDir: string
  baseUrl: string
}

const sqliteConfig = {
  busyTimeout: '5s',
  journalMode: 'WAL' as const,
  retention: {
    maxAge: '1d',
    maxEntriesPerSource: 100,
    vacuum: 'off' as const,
  },
}

function createSmokeConfig(): string {
  return `language: zh-CN
timezone: UTC
timestampFormat: yyyy-MM-dd HH:mm:ss

sqlite:
  path: knock.db
  busyTimeout: 5s
  journalMode: WAL
  retention:
    maxAge: 1d
    maxEntriesPerSource: 100
    vacuum: off

deliveries:
  local:
    file:
      path: outputs/reader.md
      content: '{{ entry.title }}'

sources:
  rust:
    name: Rust Blog
    enabled: true
    schedule: '0 */30 * * * *'
    http:
      url: https://example.com/feed.xml
    deliveries:
      local: {}

logging:
  level: info
  sinks:
    console:
      type: console
      format: jsonl
`
}

async function seedReaderFacts(runtimeDir: string): Promise<void> {
  const db = createFactsDbClient({
    sqlite: {
      path: join(runtimeDir, 'knock.db'),
      ...sqliteConfig,
    },
  })

  try {
    await insertSourceRun(db, {
      runId: 'run-browser-smoke',
      sourceId: 'rust',
      trigger: 'scheduled',
      profile: 'production',
      effectDomain: 'production',
      status: 'success',
      scheduledAt: '2026-04-24T09:00:00.000Z',
      startedAt: '2026-04-24T09:00:01.000Z',
      finishedAt: '2026-04-24T09:00:02.000Z',
      counts: {
        fetchedCount: 2,
        parsedCount: 2,
        filteredCount: 0,
        duplicateItemCount: 0,
        deliveredCount: 1,
        failedAttemptCount: 0,
        skippedCount: 1,
      },
    })

    await setSourceRunFeedSnapshot(db, 'run-browser-smoke', {
      title: 'Rust Feed',
      link: 'https://example.com/',
      description: '<p>Latest posts</p>',
      generator: 'rss',
      language: 'en',
      published: '2026-04-24T09:00:00.000Z',
    })

    await insertPipelineItem(db, {
      itemId: 'item-browser-1',
      sourceRunId: 'run-browser-smoke',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'entry-browser-1',
        title: 'First entry',
        link: 'https://example.com/1',
        description: '<p>First summary</p>',
        content: '<p>First content</p>',
        published: '2026-04-24T08:30:00.000Z',
        updated: '',
      },
      status: 'delivered',
    })

    await insertPipelineItem(db, {
      itemId: 'item-browser-2',
      sourceRunId: 'run-browser-smoke',
      sourceId: 'rust',
      effectDomain: 'production',
      normalized: {
        id: 'entry-browser-2',
        title: 'Second entry',
        link: 'https://example.com/2',
        description: '<p>Second summary</p>',
        content: '<p>Second content</p>',
        published: '2026-04-24T08:00:00.000Z',
        updated: '',
      },
      status: 'skipped',
      skippedReason: 'no_deliveries',
    })
  } finally {
    db.$client.close()
  }
}

async function reservePort(): Promise<number> {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()
  return port
}

async function waitForWebReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/config`)
      if (response.status === 200) {
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

  throw lastError instanceof Error ? lastError : new Error('等待 Web 服务就绪超时')
}

async function stopWebChild(child: Deno.ChildProcess): Promise<void> {
  try {
    child.kill('SIGTERM')
  } catch {
    // noop
  }
  try {
    await child.stdout?.cancel()
  } catch {
    // noop
  }
  try {
    await child.stderr?.cancel()
  } catch {
    // noop
  }
  await child.status.catch(() => {})
}

export async function withBrowserSmokeApp(
  run: (context: BrowserSmokeAppContext) => Promise<void>,
): Promise<void> {
  await withRuntimeHarness(async ({ runtimeDir }) => {
    await Deno.writeTextFile(join(runtimeDir, 'config.yml'), createSmokeConfig())
    await seedReaderFacts(runtimeDir)

    const port = await reservePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '--allow-read',
        '--allow-write',
        '--allow-env',
        '--allow-net',
        '--allow-ffi',
        '--allow-run',
        '--allow-sys',
        'src/main.ts',
        '--mode',
        'web',
        '--web_host',
        '127.0.0.1',
        '--web_port',
        String(port),
      ],
      cwd: Deno.cwd(),
      env: {
        ...Deno.env.toObject(),
        KNOCK_RUNTIME_DIR: runtimeDir,
      },
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()

    try {
      await waitForWebReady(baseUrl)
      await run({ runtimeDir, baseUrl })
    } finally {
      await stopWebChild(child)
    }
  })
}
