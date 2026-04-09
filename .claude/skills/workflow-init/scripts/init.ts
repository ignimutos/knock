#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

import { normalize, resolve } from '@std/path'

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

async function createWorktree(rootPath: string, name: string) {
  const targetPath = resolve(rootPath, '.claude', 'worktrees', name)
  let candidateName = name
  let candidatePath = targetPath
  let suffix = 2

  while (true) {
    const result = await runGit(
      ['worktree', 'add', '-b', `worktree-${candidateName}`, candidatePath],
      rootPath,
    )
    if (result.code === 0) {
      return {
        worktreeName: candidateName,
        worktreePath: normalize(candidatePath),
      }
    }

    const combined = `${result.stdout}\n${result.stderr}`
    const hasCollision =
      /already exists|already registered|is a missing but already registered worktree|already checked out/i.test(
        combined,
      )

    if (!hasCollision) {
      fail('init', 'worktree_create_failed', result.stderr || '创建 worktree 失败', {
        rootPath,
        worktreeName: candidateName,
        worktreePath: candidatePath,
        stdout: result.stdout,
        stderr: result.stderr,
      })
    }

    candidateName = `${name}-${suffix}`
    candidatePath = resolve(rootPath, '.claude', 'worktrees', candidateName)
    suffix++
  }
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
    console.log(`已在 worktree 中：${topLevel}`)
    printJson({
      ok: true,
      action,
      data: {
        mode: 'already_in_worktree',
        ...(currentName ? { worktreeName: currentName } : { worktreeName: normalizedName }),
        worktreePath: topLevel,
      },
    } satisfies Success<Record<string, unknown>>)
    return
  }

  console.log(`准备创建 worktree：${normalizedName}`)
  const created = await createWorktree(topLevel, normalizedName)
  console.log(`已创建 worktree：${created.worktreePath}`)

  printJson({
    ok: true,
    action,
    data: {
      mode: 'create_worktree',
      currentRoot: topLevel,
      worktreeName: created.worktreeName,
      worktreePath: created.worktreePath,
    },
  } satisfies Success<Record<string, unknown>>)
}

if (import.meta.main) {
  await main()
}
