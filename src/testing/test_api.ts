import { test as nodeTest } from 'node:test'

const DEFAULT_TEST_TIMEOUT_MS = 90_000

function isMetadataOnlyMode(): boolean {
  return process.env.KNOCK_TEST_METADATA_MODE === '1'
}

export type TestLayer = 'unit' | 'contract' | 'flow'

export interface RepoTestCaseMeta {
  title: string
  layer: TestLayer
  risks: readonly string[]
}

export interface RepoTestOptions {
  layer?: TestLayer
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
  if (isMetadataOnlyMode()) return

  runtimeTest(
    normalizeLayeredName(name, options.layer),
    { timeout: options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS },
    fn,
  )
}
