import { dirname, join, resolve } from 'node:path'

const textEncoder = new TextEncoder()
const sourceDir = resolve(dirname(new URL(import.meta.url).pathname))
const sourceRepoRoot = resolve(sourceDir, '../../../../')

export type FinishSmokeFixture = {
  rootRepoPath: string
  rootWorktreePath: string
  childWorktreePath: string
  ledgerPath: string
  finishScriptPath: string
  cleanupScriptPath: string
  dispose: () => Promise<void>
}

export async function createFinishSmokeFixture(): Promise<FinishSmokeFixture> {
  const tempRoot = await Deno.makeTempDir({ prefix: 'finish-smoke-' })
  const rootRepoPath = join(tempRoot, 'repo')
  const rootWorktreePath = join(rootRepoPath, '.claude', 'worktrees', 'root-task')
  const childWorktreePath = join(rootRepoPath, '.claude', 'worktrees', 'child-task')
  const ledgerPath = join(rootRepoPath, '.claude', 'state', 'subagent-worktrees.json')
  const scriptsDir = join(rootRepoPath, '.claude', 'skills', 'workflow-finish', 'scripts')

  await Deno.mkdir(join(rootRepoPath, '.claude', 'lib'), { recursive: true })
  await Deno.mkdir(join(rootRepoPath, '.claude', 'hooks'), { recursive: true })
  await Deno.mkdir(scriptsDir, { recursive: true })

  await Deno.writeTextFile(
    join(rootRepoPath, 'deno.json'),
    JSON.stringify(
      {
        tasks: {
          'fmt:check': 'deno eval --no-lock ""',
          'lint:check': 'deno eval --no-lock ""',
          check: 'deno eval --no-lock ""',
          test: 'deno eval --no-lock ""',
        },
        imports: {
          '@std/path': 'jsr:@std/path@^1.1.4',
        },
      },
      null,
      2,
    ) + '\n',
  )
  await Deno.writeTextFile(join(rootRepoPath, 'README.md'), 'smoke fixture\n')
  await Deno.writeTextFile(join(rootRepoPath, '.gitignore'), '.claude/worktrees/\n.claude/state/\n')

  await copyIntoFixture(
    join(sourceRepoRoot, '.claude', 'skills', 'workflow-finish', 'SKILL.md'),
    join(rootRepoPath, '.claude', 'skills', 'workflow-finish', 'SKILL.md'),
  )
  await copyIntoFixture(join(sourceDir, 'finish.ts'), join(scriptsDir, 'finish.ts'))
  await copyIntoFixture(join(sourceDir, 'cleanup.ts'), join(scriptsDir, 'cleanup.ts'))
  await copyIntoFixture(
    join(sourceRepoRoot, '.claude', 'lib', 'subagent_worktree_ledger.ts'),
    join(rootRepoPath, '.claude', 'lib', 'subagent_worktree_ledger.ts'),
  )
  await copyIntoFixture(
    join(sourceRepoRoot, '.claude', 'hooks', 'subagent-worktree-ledger.ts'),
    join(rootRepoPath, '.claude', 'hooks', 'subagent-worktree-ledger.ts'),
  )
  await runChecked(
    [
      'deno',
      'cache',
      '--lock=deno.lock',
      '.claude/skills/workflow-finish/scripts/finish.ts',
      '.claude/skills/workflow-finish/scripts/cleanup.ts',
      '.claude/lib/subagent_worktree_ledger.ts',
    ],
    rootRepoPath,
  )

  await runChecked(['git', 'init', '-b', 'main'], rootRepoPath)
  await runChecked(['git', 'config', 'user.email', 'smoke@example.com'], rootRepoPath)
  await runChecked(['git', 'config', 'user.name', 'Smoke Fixture'], rootRepoPath)
  await runChecked(['git', 'add', '.'], rootRepoPath)
  await runChecked(['git', 'commit', '-m', 'init smoke fixture'], rootRepoPath)

  await runChecked(
    ['git', 'worktree', 'add', '-b', 'feature/root-task', rootWorktreePath],
    rootRepoPath,
  )
  await runChecked(
    ['git', 'worktree', 'add', '-b', 'feature/child-task', childWorktreePath],
    rootRepoPath,
  )

  await Deno.mkdir(dirname(ledgerPath), { recursive: true })

  await Deno.writeTextFile(
    ledgerPath,
    JSON.stringify(
      {
        records: [
          {
            rootSessionId: 'root-session-smoke',
            rootWorktreePath,
            agentId: 'child-task',
            agentSessionId: 'child-session-smoke',
            worktreePath: childWorktreePath,
            branch: 'feature/child-task',
            status: 'stopped',
            createdAt: '2026-04-12T02:00:00.000Z',
            updatedAt: '2026-04-12T02:00:00.000Z',
            lastSeenCwd: childWorktreePath,
          },
        ],
        events: [],
      },
      null,
      2,
    ) + '\n',
  )
  return {
    rootRepoPath,
    rootWorktreePath,
    childWorktreePath,
    ledgerPath,
    finishScriptPath: join(scriptsDir, 'finish.ts'),
    cleanupScriptPath: join(scriptsDir, 'cleanup.ts'),
    dispose: async () => {
      await Deno.remove(tempRoot, { recursive: true })
    },
  }
}

export async function runJsonScript(args: {
  cwd: string
  scriptPath: string
  args: string[]
  stdinJson?: unknown
  env?: Record<string, string>
}): Promise<{
  code: number
  stdout: string
  stderr: string
  json: {
    ok?: boolean
    action?: string
    error?: {
      code?: string
      message?: string
      details?: Record<string, unknown>
    }
    data?: Record<string, unknown>
  }
}> {
  const command = new Deno.Command('deno', {
    cwd: args.cwd,
    args: [
      'run',
      '--no-lock',
      '--allow-read',
      '--allow-write',
      '--allow-run',
      '--allow-env',
      args.scriptPath,
      ...args.args,
    ],
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
    env: args.env,
  })

  const child = command.spawn()
  const writer = child.stdin.getWriter()
  if (args.stdinJson !== undefined) {
    await writer.write(textEncoder.encode(JSON.stringify(args.stdinJson)))
  }
  await writer.close()

  const output = await child.output()
  const stdout = new TextDecoder().decode(output.stdout).trim()
  const stderr = new TextDecoder().decode(output.stderr).trim()

  return {
    code: output.code,
    stdout,
    stderr,
    json: extractJsonObject(stdout),
  }
}

function extractJsonObject(stdout: string) {
  const trimmed = stdout.trim()
  if (!trimmed) return {}

  const lines = trimmed.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = lines.slice(index).join('\n').trim()
    if (!candidate.startsWith('{')) continue
    try {
      return JSON.parse(candidate) as {
        ok?: boolean
        action?: string
        error?: {
          code?: string
          message?: string
          details?: Record<string, unknown>
        }
        data?: Record<string, unknown>
      }
    } catch {
      continue
    }
  }

  return {}
}

async function copyIntoFixture(sourcePath: string, targetPath: string) {
  await Deno.mkdir(dirname(targetPath), { recursive: true })
  await Deno.copyFile(sourcePath, targetPath)
}

async function runChecked(command: string[], cwd: string) {
  const result = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output()

  if (result.code !== 0) {
    throw new Error(
      [
        `command failed: ${command.join(' ')}`,
        new TextDecoder().decode(result.stdout).trim(),
        new TextDecoder().decode(result.stderr).trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
}
