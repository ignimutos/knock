import { parse } from '@std/yaml'
import { z } from 'zod'

export type RequiredLayer = 'unit' | 'contract' | 'flow' | 'flow+contract'

export interface RiskRule {
  id: string
  domain: string
  trigger: string
  expected_guardrail: string
  required_layer: RequiredLayer
  owner_tests: string[]
}

const nonEmptyStringSchema = z.string().trim().min(1)

const riskRuleSchema = z.object({
  id: nonEmptyStringSchema,
  domain: nonEmptyStringSchema,
  trigger: nonEmptyStringSchema,
  expected_guardrail: nonEmptyStringSchema,
  required_layer: z.enum(['unit', 'contract', 'flow', 'flow+contract']),
  owner_tests: z.array(nonEmptyStringSchema).min(1),
})

const riskMatrixSchema = z.array(riskRuleSchema).superRefine((matrix, ctx) => {
  matrix.forEach((entry, index) => {
    const expectedId = `R${String(index + 1).padStart(2, '0')}`
    if (entry.id !== expectedId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'id'],
        message: `风险矩阵ID必须按顺序固定为R01..R20，索引${index}期望${expectedId}，实际${entry.id}`,
      })
    }
  })
})

export async function loadRiskMatrix(path: string): Promise<RiskRule[]> {
  const text = await Deno.readTextFile(path)
  const parsed = parse(text)

  if (!Array.isArray(parsed) || parsed.length !== 20) {
    throw new Error('风险矩阵必须固定为20条')
  }

  return riskMatrixSchema.parse(parsed)
}
