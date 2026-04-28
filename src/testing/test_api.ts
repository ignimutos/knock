import { test as nodeTest } from 'node:test'

const DEFAULT_TEST_TIMEOUT_MS = 90_000

export interface RepoTestOptions {
  layer?: 'unit' | 'contract' | 'flow'
  timeoutMs?: number
}

function normalizeLayeredName(name: string, layer: RepoTestOptions['layer'] = 'contract'): string {
  if (name.startsWith('[')) return name
  return `[${layer}] ${name}`
}

type RuntimeTest = (
  name: string,
  options: { timeout?: number },
  fn: () => Promise<void> | void,
) => void

const runtimeTest: RuntimeTest =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
    ? ((await import('bun:test')).test as unknown as RuntimeTest)
    : (nodeTest as unknown as RuntimeTest)

export function test(
  name: string,
  fn: () => Promise<void> | void,
  options: RepoTestOptions = {},
): void {
  runtimeTest(
    normalizeLayeredName(name, options.layer),
    { timeout: options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS },
    fn,
  )
}
