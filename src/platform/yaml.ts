import { createRequire } from 'node:module'

interface YamlRuntime {
  parse(input: string): unknown
  stringify(input: unknown): string
}

const require = createRequire(import.meta.url)
const yaml = require('yaml') as YamlRuntime

export function parse(input: string): unknown {
  return yaml.parse(input)
}

export function stringify(input: unknown): string {
  return yaml.stringify(input)
}

const YAML = { parse, stringify }

export default YAML
