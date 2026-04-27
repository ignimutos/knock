import { test as nodeTest } from 'node:test'

export interface RepoTestOptions {
  layer?: 'unit' | 'contract' | 'flow'
}

function normalizeLayeredName(name: string, layer: RepoTestOptions['layer'] = 'contract'): string {
  if (name.startsWith('[')) return name
  return `[${layer}] ${name}`
}

export function test(
  name: string,
  fn: () => Promise<void> | void,
  options: RepoTestOptions = {},
): void {
  nodeTest(normalizeLayeredName(name, options.layer), fn)
}
