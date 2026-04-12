#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { dirname, join, normalize, resolve } from 'node:path'

const SUBAGENT_WORKTREE_LEDGER_RELATIVE_PATH = '.claude/state/subagent-worktrees.json'
const SUBAGENT_WORKTREE_LEDGER_STATUSES = [
  'created',
  'active',
  'stopped',
  'removed',
  'cleanup_skipped',
  'cleanup_done',
] as const
const TERMINAL_LEDGER_STATUSES = new Set<LedgerStatus>(['removed', 'cleanup_done'])
const MAX_LEDGER_EVENTS = 100
const UNKNOWN_ROOT_SESSION_ID = 'unknown-root-session'
const UNKNOWN_AGENT_SESSION_ID = 'unknown-agent-session'

type LedgerStatus = (typeof SUBAGENT_WORKTREE_LEDGER_STATUSES)[number]

type LedgerOwnershipFields = {
  rootSessionId: string
  rootWorktreePath: string
  agentId: string
  agentSessionId: string
}

type LedgerEvent = LedgerOwnershipFields & {
  hookEventName: string
  status: LedgerStatus
  at: string
  worktreePath: string
  cwd?: string
  sessionId?: string
  branch?: string
  cleanupReason?: string
}

type LedgerEventInput = Omit<LedgerEvent, keyof LedgerOwnershipFields> &
  Partial<LedgerOwnershipFields>

type LedgerRecord = LedgerOwnershipFields & {
  worktreePath: string
  status: LedgerStatus
  createdAt: string
  updatedAt: string
  lastSeenCwd: string
  sessionId?: string
  branch?: string
  cleanupReason?: string
}

type SubagentWorktreeLedger = {
  records: LedgerRecord[]
  events: LedgerEvent[]
}

type JsonRecord = Record<string, unknown>

type LedgerEventContext = {
  rootSessionId?: string
  rootWorktreePath?: string
  timestamp?: string
}

const CONTINUE_RESPONSE = {
  continue: true,
  suppressOutput: true,
} as const

function createEmptyLedger(): SubagentWorktreeLedger {
  return {
    records: [],
    events: [],
  }
}

function applyLedgerEvent(
  ledger: SubagentWorktreeLedger,
  event: LedgerEventInput,
): SubagentWorktreeLedger {
  const nextEvent = normalizeLedgerEventInput(event)

  const nextRecords = ledger.records.map((record) =>
    record.worktreePath === nextEvent.worktreePath ? mergeLedgerRecord(record, nextEvent) : record,
  )

  if (!nextRecords.some((record) => record.worktreePath === nextEvent.worktreePath)) {
    nextRecords.push(createLedgerRecord(nextEvent))
  }

  return {
    records: nextRecords,
    events: trimLedgerEvents([...ledger.events, nextEvent]),
  }
}

function summarizeCleanupState(ledger: SubagentWorktreeLedger) {
  return {
    deleteLedgerFile:
      ledger.records.length === 0 ||
      ledger.records.every((record) => TERMINAL_LEDGER_STATUSES.has(record.status)),
  }
}

async function readLedger(repoRoot: string): Promise<SubagentWorktreeLedger> {
  const ledgerPath = resolveLedgerPath(repoRoot)

  try {
    const content = await Deno.readTextFile(ledgerPath)
    return normalizeLedger(JSON.parse(content) as unknown)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return createEmptyLedger()
    }
    throw error
  }
}

async function writeLedger(repoRoot: string, ledger: SubagentWorktreeLedger): Promise<void> {
  const ledgerPath = resolveLedgerPath(repoRoot)

  if (summarizeCleanupState(ledger).deleteLedgerFile) {
    await Deno.remove(ledgerPath).catch((error) => {
      if (error instanceof Deno.errors.NotFound) return
      throw error
    })
    return
  }

  await Deno.mkdir(dirname(ledgerPath), { recursive: true })
  await Deno.writeTextFile(`${ledgerPath}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`)
  await Deno.rename(`${ledgerPath}.tmp`, ledgerPath)
}

function extractLedgerEventFromHookInput(
  payload: unknown,
  context: LedgerEventContext = {},
): LedgerEvent | undefined {
  const input = asRecord(payload)
  if (!input) return undefined

  const hookEventName = getString(input, 'hook_event_name') ?? getString(input, 'hookEventName')
  if (!hookEventName) return undefined

  const cwd = normalizeMaybeWorktreePath(getString(input, 'cwd'))
  const hookSpecificOutput = asRecord(input.hookSpecificOutput)
  const worktreePath = [
    getString(input, 'worktree_path'),
    getString(input, 'worktreePath'),
    getString(hookSpecificOutput, 'worktreePath'),
    cwd,
  ]
    .map(normalizeMaybeWorktreePath)
    .find((value): value is string => value !== undefined)

  if (!worktreePath) return undefined

  const status =
    asLedgerStatus(getString(input, 'status')) ??
    asLedgerStatus(getString(input, 'state')) ??
    deriveLedgerStatusFromHookEvent(hookEventName)

  if (!status) return undefined

  const at =
    getString(input, 'at') ??
    getString(input, 'timestamp') ??
    getString(input, 'occurred_at') ??
    context.timestamp ??
    new Date().toISOString()

  const sessionId = getString(input, 'session_id') ?? getString(input, 'sessionId')
  const cleanupReason =
    getString(input, 'cleanup_reason') ??
    getString(input, 'cleanupReason') ??
    getString(input, 'reason')
  const branch = getString(input, 'branch')

  return normalizeLedgerEventInput({
    hookEventName,
    status,
    at,
    worktreePath,
    rootSessionId: context.rootSessionId,
    rootWorktreePath: context.rootWorktreePath,
    agentId: getString(input, 'agent_id') ?? getString(input, 'agentId'),
    agentSessionId:
      getString(input, 'agent_session_id') ?? getString(input, 'agentSessionId') ?? sessionId,
    ...(cwd ? { cwd } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(branch ? { branch } : {}),
    ...(cleanupReason ? { cleanupReason } : {}),
  })
}

function createLedgerRecord(event: LedgerEvent): LedgerRecord {
  return {
    worktreePath: event.worktreePath,
    status: event.status,
    createdAt: event.at,
    updatedAt: event.at,
    lastSeenCwd: event.cwd ?? event.worktreePath,
    rootSessionId: event.rootSessionId,
    rootWorktreePath: event.rootWorktreePath,
    agentId: event.agentId,
    agentSessionId: event.agentSessionId,
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.branch ? { branch: event.branch } : {}),
    ...(event.cleanupReason ? { cleanupReason: event.cleanupReason } : {}),
  }
}

function mergeLedgerRecord(record: LedgerRecord, event: LedgerEvent): LedgerRecord {
  if (TERMINAL_LEDGER_STATUSES.has(record.status) && event.hookEventName === 'WorktreeCreate') {
    return createLedgerRecord(event)
  }

  return normalizeLedgerRecordValue({
    ...record,
    status: event.status,
    updatedAt: event.at,
    lastSeenCwd: event.cwd ?? record.lastSeenCwd,
    rootSessionId: event.rootSessionId,
    rootWorktreePath: event.rootWorktreePath,
    agentId: event.agentId,
    agentSessionId: event.agentSessionId,
    sessionId: event.sessionId ?? record.sessionId,
    branch: event.branch ?? record.branch,
    cleanupReason: event.cleanupReason ?? record.cleanupReason,
  })
}

function trimLedgerEvents(events: LedgerEvent[]) {
  return events.slice(-MAX_LEDGER_EVENTS)
}

function normalizeLedger(input: unknown): SubagentWorktreeLedger {
  const data = asRecord(input)
  if (!data) return createEmptyLedger()

  return {
    records: Array.isArray(data.records)
      ? data.records
          .map((entry) => normalizeLedgerRecord(entry))
          .filter((entry): entry is LedgerRecord => entry !== undefined)
      : [],
    events: Array.isArray(data.events)
      ? data.events
          .map((entry) => normalizeLedgerEvent(entry))
          .filter((entry): entry is LedgerEvent => entry !== undefined)
          .slice(-MAX_LEDGER_EVENTS)
      : [],
  }
}

function normalizeLedgerRecord(input: unknown): LedgerRecord | undefined {
  const record = asRecord(input)
  if (!record) return undefined

  const worktreePath = normalizeMaybeWorktreePath(getString(record, 'worktreePath'))
  const status = asLedgerStatus(getString(record, 'status'))
  const createdAt = getString(record, 'createdAt')
  const updatedAt = getString(record, 'updatedAt')
  const lastSeenCwd = normalizeMaybeWorktreePath(getString(record, 'lastSeenCwd'))
  if (!worktreePath || !status || !createdAt || !updatedAt || !lastSeenCwd) return undefined

  return normalizeLedgerRecordValue({
    worktreePath,
    status,
    createdAt,
    updatedAt,
    lastSeenCwd,
    rootSessionId: getString(record, 'rootSessionId'),
    rootWorktreePath: getString(record, 'rootWorktreePath'),
    agentId: getString(record, 'agentId'),
    agentSessionId: getString(record, 'agentSessionId'),
    sessionId: getString(record, 'sessionId'),
    branch: getString(record, 'branch'),
    cleanupReason: getString(record, 'cleanupReason'),
  })
}

function normalizeLedgerEvent(input: unknown): LedgerEvent | undefined {
  const event = asRecord(input)
  if (!event) return undefined

  const hookEventName = getString(event, 'hookEventName')
  const status = asLedgerStatus(getString(event, 'status'))
  const at = getString(event, 'at')
  const worktreePath = normalizeMaybeWorktreePath(getString(event, 'worktreePath'))
  if (!hookEventName || !status || !at || !worktreePath) return undefined

  return normalizeLedgerEventInput({
    hookEventName,
    status,
    at,
    worktreePath,
    rootSessionId: getString(event, 'rootSessionId'),
    rootWorktreePath: getString(event, 'rootWorktreePath'),
    agentId: getString(event, 'agentId'),
    agentSessionId: getString(event, 'agentSessionId'),
    cwd: getString(event, 'cwd'),
    sessionId: getString(event, 'sessionId'),
    branch: getString(event, 'branch'),
    cleanupReason: getString(event, 'cleanupReason'),
  })
}

function normalizeLedgerEventInput(event: LedgerEventInput): LedgerEvent {
  const worktreePath = normalizeWorktreePath(event.worktreePath)
  const sessionId = event.sessionId
  const ownership = normalizeLedgerOwnershipFields({
    worktreePath,
    rootSessionId: event.rootSessionId,
    rootWorktreePath: event.rootWorktreePath,
    agentId: event.agentId,
    agentSessionId: event.agentSessionId,
    sessionId,
  })

  return {
    hookEventName: event.hookEventName,
    status: event.status,
    at: event.at,
    worktreePath,
    ...ownership,
    ...(event.cwd ? { cwd: normalizeWorktreePath(event.cwd) } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(event.branch ? { branch: event.branch } : {}),
    ...(event.cleanupReason ? { cleanupReason: event.cleanupReason } : {}),
  }
}

function normalizeLedgerRecordValue(record: {
  worktreePath: string
  status: LedgerStatus
  createdAt: string
  updatedAt: string
  lastSeenCwd: string
  rootSessionId?: string
  rootWorktreePath?: string
  agentId?: string
  agentSessionId?: string
  sessionId?: string
  branch?: string
  cleanupReason?: string
}): LedgerRecord {
  const worktreePath = normalizeWorktreePath(record.worktreePath)
  const sessionId = record.sessionId
  const ownership = normalizeLedgerOwnershipFields({
    worktreePath,
    rootSessionId: record.rootSessionId,
    rootWorktreePath: record.rootWorktreePath,
    agentId: record.agentId,
    agentSessionId: record.agentSessionId,
    sessionId,
  })

  return {
    worktreePath,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastSeenCwd: normalizeWorktreePath(record.lastSeenCwd),
    ...ownership,
    ...(sessionId ? { sessionId } : {}),
    ...(record.branch ? { branch: record.branch } : {}),
    ...(record.cleanupReason ? { cleanupReason: record.cleanupReason } : {}),
  }
}

function normalizeLedgerOwnershipFields(input: {
  worktreePath: string
  rootSessionId?: string
  rootWorktreePath?: string
  agentId?: string
  agentSessionId?: string
  sessionId?: string
}): LedgerOwnershipFields {
  const rootWorktreePath = normalizeMaybeWorktreePath(input.rootWorktreePath) ?? input.worktreePath

  return {
    rootSessionId: input.rootSessionId ?? UNKNOWN_ROOT_SESSION_ID,
    rootWorktreePath,
    agentId:
      input.agentId ?? input.worktreePath.split('/').filter(Boolean).at(-1) ?? 'unknown-agent',
    agentSessionId: input.agentSessionId ?? input.sessionId ?? UNKNOWN_AGENT_SESSION_ID,
  }
}

function deriveLedgerStatusFromHookEvent(hookEventName: string): LedgerStatus | undefined {
  switch (hookEventName) {
    case 'WorktreeCreate':
      return 'created'
    case 'SubagentStart':
    case 'WorktreeActive':
      return 'active'
    case 'SubagentStop':
      return 'stopped'
    case 'WorktreeRemove':
    case 'WorktreeRemoved':
      return 'removed'
    case 'WorktreeCleanupSkipped':
      return 'cleanup_skipped'
    case 'WorktreeCleanupDone':
      return 'cleanup_done'
    default:
      return undefined
  }
}

function asLedgerStatus(input: string | undefined): LedgerStatus | undefined {
  return SUBAGENT_WORKTREE_LEDGER_STATUSES.find((status) => status === input)
}

function asRecord(input: unknown): JsonRecord | undefined {
  return input !== null && typeof input === 'object' ? (input as JsonRecord) : undefined
}

function getString(input: JsonRecord | undefined, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function resolveLedgerPath(repoRoot: string) {
  return join(repoRoot, SUBAGENT_WORKTREE_LEDGER_RELATIVE_PATH)
}

function normalizeMaybeWorktreePath(input: string | undefined) {
  if (!input) return undefined

  const normalized = normalizeWorktreePath(input)
  return normalized.includes('/.claude/worktrees/') ? normalized : undefined
}

function normalizeWorktreePath(input: string) {
  return normalize(resolve(input))
}

function buildLedgerContext(payload: unknown): LedgerEventContext {
  const input = asRecord(payload)
  const cwd = normalizeMaybeWorktreePath(getString(input, 'cwd'))
  const worktreePath = [
    getString(input, 'worktree_path'),
    getString(input, 'worktreePath'),
    getString(asRecord(input?.hookSpecificOutput), 'worktreePath'),
    cwd,
  ]
    .map(normalizeMaybeWorktreePath)
    .find((value): value is string => value !== undefined)

  return {
    rootSessionId: Deno.env.get('CLAUDE_SESSION_ID')?.trim() || undefined,
    rootWorktreePath: cwd ?? worktreePath,
    timestamp: new Date().toISOString(),
  }
}

function getProjectDir() {
  return Deno.env.get('CLAUDE_PROJECT_DIR')?.trim() || Deno.cwd()
}

async function readPayload(): Promise<unknown | undefined> {
  try {
    const text = await new Response(Deno.stdin.readable).text()
    if (!text.trim()) return undefined
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function emitContinueResponse() {
  console.log(JSON.stringify(CONTINUE_RESPONSE))
}

async function main() {
  const payload = await readPayload()
  if (payload === undefined) {
    emitContinueResponse()
    return
  }

  const event = extractLedgerEventFromHookInput(payload, buildLedgerContext(payload))
  if (!event) {
    emitContinueResponse()
    return
  }

  try {
    const repoRoot = getProjectDir()
    const ledger = await readLedger(repoRoot)
    await writeLedger(repoRoot, applyLedgerEvent(ledger, event))
  } catch {
    // fail-open：账本失败不阻塞 hook
  }

  emitContinueResponse()
}

if (import.meta.main) {
  await main()
}
