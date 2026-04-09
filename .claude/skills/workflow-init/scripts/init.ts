#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

type Success<T> = {
  ok: true
  action: string
  data: T
}

type Failure = {
  ok: false
  action: string
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

async function runGit(args: string[], cwd = Deno.cwd()) {
  try {
    const command = new Deno.Command('git', {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
    })
    const result = await command.output()
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout).trim(),
      stderr: new TextDecoder().decode(result.stderr).trim(),
    }
  } catch (error) {
    return {
      code: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function requireGitValue(action: string, args: string[], code: string) {
  const result = await runGit(args)
  if (result.code !== 0 || !result.stdout) {
    fail(action, code, result.stderr || 'git 命令失败', { args })
  }
  return result.stdout
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

function fail(
  action: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  printJson({
    ok: false,
    action,
    error: { code, message, details },
  } satisfies Failure)
  Deno.exit(1)
}

function parseFlag(args: string[], flag: string) {
  const index = args.indexOf(flag)
  if (index === -1 || index === args.length - 1) return undefined
  return args[index + 1]
}

function normalizeWorktreeName(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function getWorktreeDirName(worktreePath: string) {
  if (!worktreePath.includes('/.claude/worktrees/')) return undefined
  const segments = worktreePath.split('/').filter(Boolean)
  return segments.at(-1)
}

async function main() {
  const action = 'init'
  const explicitName = parseFlag(Deno.args, '--name')?.trim()
  if (!explicitName) {
    fail(action, 'missing_worktree_name', 'workflow-init 需要完整的 worktree 名称')
  }

  const normalizedName = normalizeWorktreeName(explicitName)
  if (!normalizedName) {
    fail(action, 'invalid_worktree_name', 'worktree 名称无效', { worktreeName: explicitName })
  }

  const topLevel = await requireGitValue(
    action,
    ['rev-parse', '--show-toplevel'],
    'git_root_failed',
  )

  if (topLevel.includes('/.claude/worktrees/')) {
    const currentName = getWorktreeDirName(topLevel)
    if (currentName && currentName !== normalizedName) {
      fail(action, 'already_in_other_worktree', '当前已在其他 worktree 中，拒绝复用错误上下文', {
        currentWorktreeName: currentName,
        requestedWorktreeName: normalizedName,
        worktreePath: topLevel,
      })
    }

    console.log(`已在目标 worktree 中：${topLevel}`)
    printJson({
      ok: true,
      action,
      data: {
        mode: 'already_in_target_worktree',
        ...(currentName ? { worktreeName: currentName } : { worktreeName: normalizedName }),
        worktreePath: topLevel,
      },
    } satisfies Success<Record<string, unknown>>)
    return
  }

  console.log(`准备进入/创建 worktree：${normalizedName}`)

  printJson({
    ok: true,
    action,
    data: {
      mode: 'create_worktree',
      currentRoot: topLevel,
      worktreeName: normalizedName,
    },
  } satisfies Success<Record<string, unknown>>)
}

if (import.meta.main) {
  await main()
}
