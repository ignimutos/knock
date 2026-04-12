# Finishing Development Branch Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repo-local `workflow-init` / `workflow-finish` workflow with a repo-local override of `finishing-a-development-branch` that reuses the existing finish/cleanup safety logic, adds subagent worktree ledger hooks, and defaults cleanup to the current root session's subagent worktrees.

**Architecture:** Keep the current `workflow-finish` scripts as the backend core, but move them under a new local `finishing-a-development-branch` skill and refactor the orchestration contract: no `ralph-loop`, no PR/discard path, explicit worktree-only entry, structured statuses for repair loops, and batched cleanup with a ledger-backed child-worktree sweep. Store child-worktree state in `.claude/state/subagent-worktrees.json`, update it from hook events, and let `cleanup.ts` classify every deletion attempt as `deleted`, `skipped`, or `failed`.

**Tech Stack:** Deno, TypeScript, Claude Code local skills, Claude Code hooks, git worktrees

---

## File Map

### New skill surface

- Create: `.claude/skills/finishing-a-development-branch/SKILL.md` — repo-local override for the official finish skill.
- Create: `.claude/skills/finishing-a-development-branch/scripts/finish.ts` — migrated and refactored backend from the current `workflow-finish` finish script.
- Create: `.claude/skills/finishing-a-development-branch/scripts/finish_test.ts` — unit coverage for status selection, verification planning, and new structured finish states.
- Create: `.claude/skills/finishing-a-development-branch/scripts/cleanup.ts` — migrated and extended backend cleanup script that deletes the main worktree first, then current-root-session child worktrees.
- Create: `.claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts` — unit coverage for ledger-driven child cleanup classification.

### Shared ledger support

- Create: `.claude/lib/subagent_worktree_ledger.ts` — JSON ledger read/write/update helpers shared by hooks and cleanup.
- Create: `.claude/lib/subagent_worktree_ledger_test.ts` — tests for state-table updates, event compaction, session grouping, and empty-file deletion.
- Create: `.claude/hooks/subagent-worktree-ledger.ts` — single Deno hook entrypoint handling `WorktreeCreate`, `WorktreeRemove`, `SubagentStart`, and `SubagentStop`.

### Settings and ignore rules

- Modify: `.claude/settings.json` — register the four hook events and point them to the new ledger hook script.
- Modify: `.gitignore` — ignore `.claude/state/` artifacts while keeping tracked code under `.claude/` intact.

### Repo instructions and docs

- Modify: `CLAUDE.md` — replace `/workflow-init` / `/workflow-finish` references with the new `claude -w <name>` start path and local `finishing-a-development-branch` finish path.
- Modify: `docs/superpowers/specs/2026-04-12-finishing-development-branch-override-design.md` only if implementation-specific terminology drifts during coding.
- Create: `docs/superpowers/plans/2026-04-12-finishing-development-branch-override.md` — this implementation plan.

### Removal targets

- Delete: `.claude/skills/workflow-init/SKILL.md`
- Delete: `.claude/skills/workflow-init/scripts/init.ts`
- Delete: `.claude/skills/workflow-finish/SKILL.md`
- Delete: `.claude/skills/workflow-finish/scripts/finish.ts`
- Delete: `.claude/skills/workflow-finish/scripts/cleanup.ts`

---

### Task 1: Build the shared subagent worktree ledger module

**Files:**

- Create: `.claude/lib/subagent_worktree_ledger.ts`
- Create: `.claude/lib/subagent_worktree_ledger_test.ts`
- Test: `.claude/lib/subagent_worktree_ledger_test.ts`

- [ ] **Step 1: Write the failing ledger tests first**

```ts
import { assertEquals, assertExists } from '@std/assert'
import {
  applyLedgerEvent,
  createEmptyLedger,
  summarizeCleanupState,
} from './subagent_worktree_ledger.ts'

Deno.test(
  'ledger: WorktreeCreate + SubagentStop updates one record and appends compact events',
  () => {
    let ledger = createEmptyLedger()

    ledger = applyLedgerEvent(ledger, {
      type: 'create',
      rootSessionId: 'root-1',
      rootWorktreePath: '/repo/.claude/worktrees/root-task',
      agentId: 'agent-a',
      agentSessionId: 'session-a',
      worktreePath: '/repo/.claude/worktrees/agent-a',
      branch: 'agent-a-branch',
      cwd: '/repo/.claude/worktrees/agent-a',
      timestamp: '2026-04-12T02:10:00.000Z',
    })

    ledger = applyLedgerEvent(ledger, {
      type: 'stop',
      rootSessionId: 'root-1',
      rootWorktreePath: '/repo/.claude/worktrees/root-task',
      agentId: 'agent-a',
      agentSessionId: 'session-a',
      worktreePath: '/repo/.claude/worktrees/agent-a',
      branch: 'agent-a-branch',
      cwd: '/repo/.claude/worktrees/agent-a',
      timestamp: '2026-04-12T02:11:00.000Z',
    })

    assertEquals(ledger.records.length, 1)
    assertEquals(ledger.records[0].status, 'stopped')
    assertEquals(ledger.records[0].rootSessionId, 'root-1')
    assertEquals(
      ledger.events.map((event) => event.type),
      ['create', 'stop'],
    )
  },
)

Deno.test(
  'ledger: summarizeCleanupState deletes empty file only when all records are terminal',
  () => {
    const summary = summarizeCleanupState({
      version: 1,
      records: [
        {
          rootSessionId: 'root-1',
          rootWorktreePath: '/repo/.claude/worktrees/root-task',
          agentId: 'agent-a',
          agentSessionId: 'session-a',
          worktreePath: '/repo/.claude/worktrees/agent-a',
          branch: 'agent-a-branch',
          status: 'cleanup_done',
          createdAt: '2026-04-12T02:10:00.000Z',
          updatedAt: '2026-04-12T02:20:00.000Z',
          lastSeenCwd: '/repo/.claude/worktrees/agent-a',
        },
      ],
      events: [],
    })

    assertEquals(summary.deleteLedgerFile, true)
    assertEquals(summary.remainingRecords.length, 0)
  },
)
```

- [ ] **Step 2: Run the new ledger tests and watch them fail**

Run: `deno task test .claude/lib/subagent_worktree_ledger_test.ts`
Expected: FAIL because `subagent_worktree_ledger.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal ledger module**

```ts
export type LedgerRecordStatus =
  | 'created'
  | 'active'
  | 'stopped'
  | 'removed'
  | 'cleanup_skipped'
  | 'cleanup_done'

export type LedgerRecord = {
  rootSessionId: string
  rootWorktreePath: string
  agentId: string
  agentSessionId: string
  worktreePath: string
  branch: string
  status: LedgerRecordStatus
  createdAt: string
  updatedAt: string
  lastSeenCwd: string
  cleanupReason?: string
}

export type LedgerEvent = {
  type: 'create' | 'start' | 'stop' | 'remove' | 'cleanup'
  rootSessionId: string
  rootWorktreePath: string
  agentId: string
  agentSessionId: string
  worktreePath: string
  branch: string
  cwd: string
  timestamp: string
  cleanupReason?: string
}

export type LedgerState = {
  version: 1
  records: LedgerRecord[]
  events: LedgerEvent[]
}

export function createEmptyLedger(): LedgerState {
  return { version: 1, records: [], events: [] }
}

export function applyLedgerEvent(
  state: LedgerState,
  event: LedgerEvent,
): LedgerState {
  const records = [...state.records]
  const index = records.findIndex(
    (record) => record.worktreePath === event.worktreePath,
  )
  const nextStatus =
    event.type === 'create'
      ? 'created'
      : event.type === 'start'
        ? 'active'
        : event.type === 'stop'
          ? 'stopped'
          : event.type === 'remove'
            ? 'removed'
            : event.cleanupReason === 'deleted'
              ? 'cleanup_done'
              : 'cleanup_skipped'

  const nextRecord: LedgerRecord = {
    rootSessionId: event.rootSessionId,
    rootWorktreePath: event.rootWorktreePath,
    agentId: event.agentId,
    agentSessionId: event.agentSessionId,
    worktreePath: event.worktreePath,
    branch: event.branch,
    status: nextStatus,
    createdAt: index === -1 ? event.timestamp : records[index].createdAt,
    updatedAt: event.timestamp,
    lastSeenCwd: event.cwd,
    ...(event.cleanupReason ? { cleanupReason: event.cleanupReason } : {}),
  }

  if (index === -1) records.push(nextRecord)
  else records[index] = nextRecord

  return {
    version: 1,
    records,
    events: [...state.events, event].slice(-100),
  }
}

export function summarizeCleanupState(state: LedgerState) {
  const remainingRecords = state.records.filter(
    (record) => !['removed', 'cleanup_done'].includes(record.status),
  )

  return {
    remainingRecords,
    deleteLedgerFile: remainingRecords.length === 0,
  }
}
```

- [ ] **Step 4: Add file I/O helpers for hooks and cleanup**

```ts
import { dirname, resolve } from '@std/path'

export const LEDGER_PATH = '.claude/state/subagent-worktrees.json'

export async function readLedger(cwd = Deno.cwd()): Promise<LedgerState> {
  try {
    const raw = await Deno.readTextFile(resolve(cwd, LEDGER_PATH))
    return JSON.parse(raw) as LedgerState
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return createEmptyLedger()
    throw error
  }
}

export async function writeLedger(state: LedgerState, cwd = Deno.cwd()) {
  const target = resolve(cwd, LEDGER_PATH)
  await Deno.mkdir(dirname(target), { recursive: true })

  const summary = summarizeCleanupState(state)
  if (summary.deleteLedgerFile) {
    await Deno.remove(target).catch(() => undefined)
    return
  }

  await Deno.writeTextFile(target, `${JSON.stringify(state, null, 2)}\n`)
}
```

- [ ] **Step 5: Run ledger tests and commit the helper**

Run: `deno task test .claude/lib/subagent_worktree_ledger_test.ts`
Expected: PASS

```bash
git add .claude/lib/subagent_worktree_ledger.ts .claude/lib/subagent_worktree_ledger_test.ts
git commit -m "feat: add subagent worktree ledger helpers"
```

---

### Task 2: Wire the four hook events into the ledger

**Files:**

- Create: `.claude/hooks/subagent-worktree-ledger.ts`
- Modify: `.claude/settings.json`
- Modify: `.gitignore`
- Test: `.claude/lib/subagent_worktree_ledger_test.ts`

- [ ] **Step 1: Add a failing hook extraction test to the ledger test file**

```ts
import { extractLedgerEventFromHookInput } from './subagent_worktree_ledger.ts'

Deno.test(
  'ledger hook extraction: SubagentStop falls back to cwd when worktree path field is absent',
  () => {
    const event = extractLedgerEventFromHookInput(
      {
        hook_event_name: 'SubagentStop',
        session_id: 'child-session',
        cwd: '/repo/.claude/worktrees/agent-a',
        reason: 'DONE',
      },
      {
        rootSessionId: 'root-session',
        rootWorktreePath: '/repo/.claude/worktrees/root-task',
        timestamp: '2026-04-12T03:00:00.000Z',
      },
    )

    assertExists(event)
    assertEquals(event.type, 'stop')
    assertEquals(event.worktreePath, '/repo/.claude/worktrees/agent-a')
    assertEquals(event.agentSessionId, 'child-session')
  },
)
```

- [ ] **Step 2: Run the helper tests and verify the extractor is missing**

Run: `deno task test .claude/lib/subagent_worktree_ledger_test.ts`
Expected: FAIL because `extractLedgerEventFromHookInput()` is not implemented.

- [ ] **Step 3: Implement robust hook extraction in the shared helper**

```ts
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function inferWorktreePath(
  payload: Record<string, unknown>,
): string | undefined {
  return (
    readString(payload.worktree_path) ||
    readString(payload.worktreePath) ||
    readString(
      (payload.hookSpecificOutput as Record<string, unknown> | undefined)
        ?.worktreePath,
    ) ||
    readString(payload.cwd)
  )
}

export function extractLedgerEventFromHookInput(
  payload: Record<string, unknown>,
  context: {
    rootSessionId: string
    rootWorktreePath: string
    timestamp: string
  },
): LedgerEvent | undefined {
  const hookEventName = readString(payload.hook_event_name)
  const worktreePath = inferWorktreePath(payload)
  if (
    !hookEventName ||
    !worktreePath ||
    !worktreePath.includes('/.claude/worktrees/')
  )
    return undefined

  const agentSessionId = readString(payload.session_id) ?? 'unknown-session'
  const agentId = readString(payload.agent_id) ?? agentSessionId
  const branch =
    readString(payload.branch) ??
    worktreePath.split('/').at(-1) ??
    'unknown-branch'

  const type =
    hookEventName === 'WorktreeCreate'
      ? 'create'
      : hookEventName === 'WorktreeRemove'
        ? 'remove'
        : hookEventName === 'SubagentStart'
          ? 'start'
          : hookEventName === 'SubagentStop'
            ? 'stop'
            : undefined

  if (!type) return undefined

  return {
    type,
    rootSessionId: context.rootSessionId,
    rootWorktreePath: context.rootWorktreePath,
    agentId,
    agentSessionId,
    worktreePath,
    branch,
    cwd: readString(payload.cwd) ?? worktreePath,
    timestamp: context.timestamp,
  }
}
```

- [ ] **Step 4: Create the single hook entrypoint and register all four events**

```ts
#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import {
  applyLedgerEvent,
  extractLedgerEventFromHookInput,
  readLedger,
  writeLedger,
} from '../lib/subagent_worktree_ledger.ts'

const payload = JSON.parse(
  await new Response(Deno.stdin.readable).text(),
) as Record<string, unknown>
const rootSessionId =
  Deno.env.get('CLAUDE_SESSION_ID') ??
  String(payload.session_id ?? 'unknown-root')
const rootWorktreePath = String(payload.cwd ?? Deno.cwd())
const event = extractLedgerEventFromHookInput(payload, {
  rootSessionId,
  rootWorktreePath,
  timestamp: new Date().toISOString(),
})

if (event) {
  const ledger = await readLedger()
  await writeLedger(applyLedgerEvent(ledger, event))
}

console.log('{"continue":true,"suppressOutput":true}')
```

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "deno run --allow-read --allow-write --allow-env .claude/hooks/subagent-worktree-ledger.ts"
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "deno run --allow-read --allow-write --allow-env .claude/hooks/subagent-worktree-ledger.ts"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "deno run --allow-read --allow-write --allow-env .claude/hooks/subagent-worktree-ledger.ts"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "deno run --allow-read --allow-write --allow-env .claude/hooks/subagent-worktree-ledger.ts"
          }
        ]
      }
    ]
  }
}
```

```gitignore
.claude/state/
```

- [ ] **Step 5: Run helper tests, check the settings diff, and commit the hook wiring**

Run: `deno task test .claude/lib/subagent_worktree_ledger_test.ts`
Expected: PASS

Run: `deno task fmt:check .claude/hooks/subagent-worktree-ledger.ts .claude/lib/subagent_worktree_ledger.ts .claude/lib/subagent_worktree_ledger_test.ts`
Expected: PASS

```bash
git add .claude/hooks/subagent-worktree-ledger.ts .claude/settings.json .gitignore .claude/lib/subagent_worktree_ledger.ts .claude/lib/subagent_worktree_ledger_test.ts
git commit -m "feat: track subagent worktrees with hooks"
```

---

### Task 3: Migrate and refactor `finish.ts` under the new skill

**Files:**

- Create: `.claude/skills/finishing-a-development-branch/scripts/finish.ts`
- Create: `.claude/skills/finishing-a-development-branch/scripts/finish_test.ts`
- Modify: `.claude/skills/finishing-a-development-branch/scripts/finish.ts`
- Test: `.claude/skills/finishing-a-development-branch/scripts/finish_test.ts`

- [ ] **Step 1: Write failing tests for the new finish status contract**

```ts
import { assertEquals } from '@std/assert'
import { buildCompletionChoices, classifyFinishAttention } from './finish.ts'

Deno.test(
  'finish: completion choices keep only delete / keep / user input',
  () => {
    assertEquals(
      buildCompletionChoices({
        worktreePath: '/repo/.claude/worktrees/root-task',
        rootRepoPath: '/repo',
        featureBranch: 'root-task',
        baseBranch: 'main',
      }).map((choice) => choice.id),
      ['1', '2', '3'],
    )
  },
)

Deno.test('finish: classify merge-back conflicts without ralph-loop', () => {
  assertEquals(
    classifyFinishAttention({
      step: 'merge_feature_into_main',
      stdout: 'CONFLICT (content): Merge conflict in CLAUDE.md',
      stderr:
        'Automatic merge failed; fix conflicts and then commit the result.',
    }),
    'merge_back_conflict',
  )
})
```

- [ ] **Step 2: Run the finish tests and confirm the new file does not exist yet**

Run: `deno task test .claude/skills/finishing-a-development-branch/scripts/finish_test.ts`
Expected: FAIL because the new skill path and exports are missing.

- [ ] **Step 3: Copy the current backend into the new skill path and refactor its public contract**

```ts
export function classifyFinishAttention(input: {
  step: 'merge_main_into_feature' | 'verification' | 'merge_feature_into_main'
  stdout: string
  stderr: string
}) {
  if (input.step === 'merge_main_into_feature') return 'merge_main_conflict'
  if (input.step === 'merge_feature_into_main') return 'merge_back_conflict'
  return 'verification_failed'
}

function buildNeedsAttentionPayload(args: {
  reason: 'merge_main_conflict' | 'merge_back_conflict' | 'verification_failed'
  worktreePath: string
  rootRepoPath: string
  featureBranch: string
  baseBranch: string
  paths: readonly string[]
  stdout?: string
  stderr?: string
  verification?: Record<string, unknown>
}) {
  return {
    status: 'needs_attention',
    nextAction: 'repair_loop',
    ...args,
  }
}

export function buildCompletionChoices(context: {
  worktreePath: string
  rootRepoPath: string
  featureBranch: string
  baseBranch: string
}) {
  return [
    {
      id: '1',
      label:
        '删除当前 worktree（默认也清理当前 root session 的子代理 worktree）',
      worktreePath: context.worktreePath,
      featureBranch: context.featureBranch,
      rootRepoPath: context.rootRepoPath,
      baseBranch: context.baseBranch,
    },
    {
      id: '2',
      label:
        '保留当前 worktree（默认仍清理当前 root session 的子代理 worktree）',
      worktreePath: context.worktreePath,
      featureBranch: context.featureBranch,
      rootRepoPath: context.rootRepoPath,
      baseBranch: context.baseBranch,
    },
    { id: '3', label: '用户输入' },
  ] as const
}
```

- [ ] **Step 4: Remove `ralph-loop` assumptions and keep explicit worktree-only guards**

```ts
if (!worktreePath.includes('/.claude/worktrees/')) {
  fail(
    action,
    'finish_requires_worktree',
    '当前不在 .claude/worktrees/ 下，拒绝执行 finishing-a-development-branch',
    {
      worktreePath,
    },
  )
}

if (mergeMainIntoFeature.code !== 0 && isMergeConflict(mergeMainIntoFeature)) {
  printJson({
    ok: true,
    action,
    data: buildNeedsAttentionPayload({
      reason: classifyFinishAttention({
        step: 'merge_main_into_feature',
        stdout: mergeMainIntoFeature.stdout,
        stderr: mergeMainIntoFeature.stderr,
      }),
      worktreePath,
      rootRepoPath,
      featureBranch,
      baseBranch,
      paths: uniquePaths,
      stdout: mergeMainIntoFeature.stdout,
      stderr: mergeMainIntoFeature.stderr,
    }),
  })
  return
}
```

- [ ] **Step 5: Run script tests and commit the migrated backend**

Run: `deno task test .claude/skills/finishing-a-development-branch/scripts/finish_test.ts`
Expected: PASS

Run: `deno task check .claude/skills/finishing-a-development-branch/scripts/finish.ts .claude/skills/finishing-a-development-branch/scripts/finish_test.ts`
Expected: PASS

```bash
git add .claude/skills/finishing-a-development-branch/scripts/finish.ts .claude/skills/finishing-a-development-branch/scripts/finish_test.ts
git commit -m "refactor: migrate finish backend to local finishing skill"
```

---

### Task 4: Extend cleanup to batch current-root-session child worktrees

**Files:**

- Create: `.claude/skills/finishing-a-development-branch/scripts/cleanup.ts`
- Create: `.claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts`
- Modify: `.claude/lib/subagent_worktree_ledger.ts`
- Test: `.claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts`

- [ ] **Step 1: Write failing cleanup tests for `deleted` / `skipped` / `failed` classification**

```ts
import { assertEquals } from '@std/assert'
import { classifyChildCleanupPlan } from './cleanup.ts'

Deno.test(
  'cleanup: only current root session child worktrees are eligible',
  () => {
    const plan = classifyChildCleanupPlan({
      rootSessionId: 'root-1',
      rootWorktreePath: '/repo/.claude/worktrees/root-task',
      records: [
        {
          rootSessionId: 'root-1',
          rootWorktreePath: '/repo/.claude/worktrees/root-task',
          agentId: 'agent-a',
          agentSessionId: 'session-a',
          worktreePath: '/repo/.claude/worktrees/agent-a',
          branch: 'agent-a-branch',
          status: 'stopped',
          createdAt: '2026-04-12T03:00:00.000Z',
          updatedAt: '2026-04-12T03:05:00.000Z',
          lastSeenCwd: '/repo/.claude/worktrees/agent-a',
        },
        {
          rootSessionId: 'root-2',
          rootWorktreePath: '/repo/.claude/worktrees/other-task',
          agentId: 'agent-b',
          agentSessionId: 'session-b',
          worktreePath: '/repo/.claude/worktrees/agent-b',
          branch: 'agent-b-branch',
          status: 'stopped',
          createdAt: '2026-04-12T03:00:00.000Z',
          updatedAt: '2026-04-12T03:05:00.000Z',
          lastSeenCwd: '/repo/.claude/worktrees/agent-b',
        },
      ],
    })

    assertEquals(
      plan.candidates.map((record) => record.worktreePath),
      ['/repo/.claude/worktrees/agent-a'],
    )
  },
)
```

- [ ] **Step 2: Run the cleanup tests and verify the new cleanup file is missing**

Run: `deno task test .claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts`
Expected: FAIL because the new cleanup module does not exist yet.

- [ ] **Step 3: Copy the old cleanup backend and add child-worktree planning helpers**

```ts
import {
  applyLedgerEvent,
  readLedger,
  writeLedger,
  type LedgerRecord,
} from '../../../lib/subagent_worktree_ledger.ts'

export function classifyChildCleanupPlan(args: {
  rootSessionId: string
  rootWorktreePath: string
  records: LedgerRecord[]
}) {
  return {
    candidates: args.records.filter(
      (record) =>
        record.rootSessionId === args.rootSessionId ||
        record.rootWorktreePath === args.rootWorktreePath,
    ),
  }
}

function buildCleanupResult(
  kind: 'deleted' | 'skipped' | 'failed',
  worktreePath: string,
  reason: string,
) {
  return { kind, worktreePath, reason }
}
```

- [ ] **Step 4: Implement main-first, children-second cleanup and ledger updates**

```ts
const childResults: Array<{
  kind: 'deleted' | 'skipped' | 'failed'
  worktreePath: string
  reason: string
}> = []
const ledger = await readLedger(normalizedRootRepoPath)
const childPlan = classifyChildCleanupPlan({
  rootSessionId,
  rootWorktreePath: normalizedWorktreePath,
  records: ledger.records,
})

for (const child of childPlan.candidates) {
  if (!child.worktreePath.includes('/.claude/worktrees/')) {
    childResults.push(
      buildCleanupResult(
        'skipped',
        child.worktreePath,
        'outside_managed_worktrees',
      ),
    )
    continue
  }

  const childStatus = await runGit(['status', '--short'], child.worktreePath)
  if (childStatus.code !== 0 || childStatus.stdout) {
    childResults.push(
      buildCleanupResult('skipped', child.worktreePath, 'dirty_or_unreadable'),
    )
    continue
  }

  const removeChildWorktree = await runGit(
    ['worktree', 'remove', '-f', child.worktreePath],
    normalizedRootRepoPath,
  )
  if (removeChildWorktree.code !== 0) {
    childResults.push(
      buildCleanupResult(
        'failed',
        child.worktreePath,
        removeChildWorktree.stderr || 'worktree_remove_failed',
      ),
    )
    continue
  }

  const deleteChildBranch = await runGit(
    ['branch', '-D', child.branch],
    normalizedRootRepoPath,
  )
  if (deleteChildBranch.code !== 0) {
    childResults.push(
      buildCleanupResult(
        'failed',
        child.worktreePath,
        deleteChildBranch.stderr || 'branch_delete_failed',
      ),
    )
    continue
  }

  childResults.push(
    buildCleanupResult('deleted', child.worktreePath, 'deleted'),
  )
}

let nextLedger = ledger
for (const result of childResults) {
  nextLedger = applyLedgerEvent(nextLedger, {
    type: 'cleanup',
    rootSessionId,
    rootWorktreePath: normalizedWorktreePath,
    agentId: result.worktreePath,
    agentSessionId: result.worktreePath,
    worktreePath: result.worktreePath,
    branch: result.worktreePath.split('/').at(-1) ?? 'unknown-branch',
    cwd: normalizedRootRepoPath,
    timestamp: new Date().toISOString(),
    cleanupReason: result.kind === 'deleted' ? 'deleted' : result.reason,
  })
}
await writeLedger(nextLedger, normalizedRootRepoPath)
```

- [ ] **Step 5: Run cleanup tests and commit the batched cleanup path**

Run: `deno task test .claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts .claude/lib/subagent_worktree_ledger_test.ts`
Expected: PASS

```bash
git add .claude/skills/finishing-a-development-branch/scripts/cleanup.ts .claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts .claude/lib/subagent_worktree_ledger.ts .claude/lib/subagent_worktree_ledger_test.ts
git commit -m "feat: batch child worktree cleanup in finish workflow"
```

---

### Task 5: Write the local override skill and remove old workflow skills

**Files:**

- Create: `.claude/skills/finishing-a-development-branch/SKILL.md`
- Delete: `.claude/skills/workflow-init/SKILL.md`
- Delete: `.claude/skills/workflow-init/scripts/init.ts`
- Delete: `.claude/skills/workflow-finish/SKILL.md`
- Delete: `.claude/skills/workflow-finish/scripts/finish.ts`
- Delete: `.claude/skills/workflow-finish/scripts/cleanup.ts`
- Test: `.claude/skills/finishing-a-development-branch/scripts/finish_test.ts`
- Test: `.claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts`

- [ ] **Step 1: Write the new local `SKILL.md` contract**

```md
---
name: finishing-a-development-branch
description: Use when implementation is complete, validated, and ready for the repo-local merge-back and cleanup workflow.
disable-model-invocation: false
---

# finishing-a-development-branch

这是 knock 仓库的本地覆写 finish skill。

## 入口规则

- 正式收尾以显式调用为准；自动触发只是补充。
- 当前不在 `.claude/worktrees/` 下时，必须直接拒绝执行。
- 默认只做本地 merge-back，不内建 PR / discard。

## 流程

1. 生成或接收 commit message
2. 计算 `git diff --name-only <base>...HEAD`，补齐关联测试路径
3. 调用 `scripts/finish.ts`
4. 若返回 `needs_attention`：
   - 复用当前 implementer 子代理
   - 执行 review -> test -> fix 循环
   - 继续 finish
5. 若返回 `completed_pending_choice`：
   - 展示 3 个选项
   - 选删除时先 `ExitWorktree({ action: "keep" })`，再调 `scripts/cleanup.ts`
   - no-op 时允许 root fallback
```

- [ ] **Step 2: Run the script tests before deleting the old workflow code**

Run: `deno task test .claude/skills/finishing-a-development-branch/scripts/finish_test.ts .claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts`
Expected: PASS

- [ ] **Step 3: Delete the old workflow skill directories after the new local finish surface exists**

```bash
rm -rf .claude/skills/workflow-init .claude/skills/workflow-finish
```

- [ ] **Step 4: Search for stale references so the repo has one finish entrypoint**

Run: `grep -R "workflow-init\|workflow-finish" -n .`
Expected: only planned doc updates remain; no live skill implementation paths remain.

- [ ] **Step 5: Commit the override skill and the deletions**

```bash
git add .claude/skills/finishing-a-development-branch/SKILL.md .claude/skills/workflow-init .claude/skills/workflow-finish
git commit -m "refactor: replace workflow skills with local finishing override"
```

---

### Task 6: Update repo instructions and verify the new finish path end-to-end

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-04-12-finishing-development-branch-override-design.md` only if terminology changed during implementation
- Test: `.claude/settings.json`
- Test: `.claude/skills/finishing-a-development-branch/scripts/finish_test.ts`
- Test: `.claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts`
- Test: `.claude/lib/subagent_worktree_ledger_test.ts`

- [ ] **Step 1: Rewrite the worktree policy section in `CLAUDE.md`**

```md
## Worktree policy

- 功能开发前 **SHOULD** 直接使用 `claude -w <name>` 创建并进入目标 worktree。
- 将改动合回 `main` 的收尾操作 **SHOULD** 使用本地 `finishing-a-development-branch` finish skill 完成。
- 非 worktree 环境 **MAY** 进行只读检查、计划阶段工作与其他不依赖 worktree 隔离的操作。
- `/exit` **MUST NOT** 被描述为自动删除 worktree 或自动合并改动。
```

- [ ] **Step 2: Update the verification rule wording that still names `workflow-finish` explicitly**

```md
- 调用本地 `finishing-a-development-branch` finish 脚本时，agent **MUST** 先显式整理并传入 `--path`；这些路径除了直接改动文件外，**SHOULD** 包含需要补跑的关联测试文件或目录。
```

- [ ] **Step 3: Run the focused code validation for the new local finish stack**

Run: `deno task fmt:check .claude/settings.json .claude/hooks/subagent-worktree-ledger.ts .claude/lib/subagent_worktree_ledger.ts .claude/lib/subagent_worktree_ledger_test.ts .claude/skills/finishing-a-development-branch/SKILL.md .claude/skills/finishing-a-development-branch/scripts/finish.ts .claude/skills/finishing-a-development-branch/scripts/finish_test.ts .claude/skills/finishing-a-development-branch/scripts/cleanup.ts .claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts CLAUDE.md`
Expected: PASS

Run: `deno task check .claude/hooks/subagent-worktree-ledger.ts .claude/lib/subagent_worktree_ledger.ts .claude/lib/subagent_worktree_ledger_test.ts .claude/skills/finishing-a-development-branch/scripts/finish.ts .claude/skills/finishing-a-development-branch/scripts/finish_test.ts .claude/skills/finishing-a-development-branch/scripts/cleanup.ts .claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts`
Expected: PASS

Run: `deno task test .claude/lib/subagent_worktree_ledger_test.ts .claude/skills/finishing-a-development-branch/scripts/finish_test.ts .claude/skills/finishing-a-development-branch/scripts/cleanup_test.ts`
Expected: PASS

- [ ] **Step 4: Run one manual smoke pass against the local finish skill contract**

Run: `grep -R "workflow-init\|workflow-finish" -n CLAUDE.md .claude docs/superpowers/specs/2026-04-12-finishing-development-branch-override-design.md`
Expected: no live implementation references; only historical mention inside the approved design spec is acceptable.

Run: `claude /hooks`
Expected: `WorktreeCreate`, `WorktreeRemove`, `SubagentStart`, and `SubagentStop` appear in the active hook list for this workspace.

- [ ] **Step 5: Commit the instruction/doc sync and finish the branch**

```bash
git add CLAUDE.md .claude/settings.json .gitignore .claude/hooks/subagent-worktree-ledger.ts .claude/lib/subagent_worktree_ledger.ts .claude/lib/subagent_worktree_ledger_test.ts .claude/skills/finishing-a-development-branch .
git commit -m "docs: switch worktree workflow to local finishing override"
```

---

## Spec Coverage Self-Review

- **Single local finish entrypoint:** Task 5 creates the override skill and deletes `workflow-init` / `workflow-finish`.
- **Reuse current script backbone:** Tasks 3 and 4 copy and refactor `finish.ts` / `cleanup.ts` instead of re-inventing the backend.
- **No `ralph-loop`:** Task 3 changes `nextAction` to `repair_loop` and keeps the repair loop in skill orchestration.
- **Hook ledger with four events only:** Task 2 wires exactly `WorktreeCreate`, `WorktreeRemove`, `SubagentStart`, and `SubagentStop`.
- **Ledger file lifecycle:** Task 1 and Task 4 cover JSON persistence and deletion when only terminal records remain.
- **Default child cleanup:** Task 4 classifies and cleans child worktrees for the current root session only.
- **Worktree-only refusal:** Task 3 keeps and renames the explicit guard.
- **Docs and repo instructions:** Task 6 updates `CLAUDE.md` and checks stale references.

## Placeholder Scan

- No `TODO` / `TBD` placeholders remain.
- All file paths are concrete.
- Every code-changing step includes code.
- Every verification step includes exact commands and expected outcomes.

## Type / Naming Consistency Check

- New skill name is consistently `finishing-a-development-branch`.
- Ledger file path is consistently `.claude/state/subagent-worktrees.json`.
- Cleanup result kinds are consistently `deleted`, `skipped`, `failed`.
- Finish attention reasons are consistently `merge_main_conflict`, `verification_failed`, `merge_back_conflict`.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-12-finishing-development-branch-override.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
