import { parse } from '@std/yaml'

export type RequiredLayer = 'unit' | 'contract' | 'flow' | 'flow+contract'

export interface RiskRule {
  id: string
  domain: string
  trigger: string
  expected_guardrail: string
  required_layer: RequiredLayer
  owner_tests: string[]
}

export async function loadRiskMatrix(path: string): Promise<RiskRule[]> {
  const text = await Deno.readTextFile(path)
  const parsed = parse(text)

  if (!Array.isArray(parsed) || parsed.length !== 20) {
    throw new Error('风险矩阵必须固定为20条')
  }

  return parsed as RiskRule[]
}
