import { assertEquals } from '@std/assert'
import { loadRiskMatrix } from './risk_mapping.ts'

Deno.test('risk-mapping: 应读取并返回 20 条冻结风险', async () => {
  const matrix = await loadRiskMatrix('docs/testing/risk-matrix.yml')
  assertEquals(matrix.length, 20)
  assertEquals(matrix[0].id, 'R01')
  assertEquals(matrix[19].id, 'R20')
})
