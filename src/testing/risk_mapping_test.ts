import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { loadRiskMatrix, validateRiskMatrix } from './risk_mapping.ts'

const TEST_DIR = dirname(fromFileUrl(import.meta.url))
const FIXTURE_DIR = join(TEST_DIR, 'fixtures')
const CANONICAL_RISK_MATRIX_PATH = join(TEST_DIR, '..', '..', 'docs', 'testing', 'risk-matrix.yml')

Deno.test('[contract] risk-mapping: canonical 风险矩阵与测试映射应通过校验', async () => {
  const matrix = await validateRiskMatrix(CANONICAL_RISK_MATRIX_PATH)

  assertEquals(matrix.length, 20)
  assertEquals(matrix[0].id, 'R01')
  assertEquals(matrix[19].id, 'R20')
  assertEquals(matrix[0].domain, 'source')
  assertEquals(matrix[0].trigger, 'source fetch timeout')
  assertEquals(matrix[0].owner_tests, [
    'src/infrastructure/sources/http_source_input_gateway_test.ts',
    'src/infrastructure/sources/byparr_source_input_gateway_test.ts',
    'src/sources/syndication_test.ts',
  ])
})

Deno.test('[contract] risk-mapping: 数量不匹配应抛出固定错误', async () => {
  await assertRejects(
    () => loadRiskMatrix(join(FIXTURE_DIR, 'risk-matrix-count-mismatch.yml')),
    Error,
    '风险矩阵必须固定为20条',
  )
})

Deno.test('[contract] risk-mapping: 非法 required_layer 应被拒绝', async () => {
  const error = await assertRejects(
    () => loadRiskMatrix(join(FIXTURE_DIR, 'risk-matrix-invalid-layer.yml')),
    Error,
  )

  assertStringIncludes(error.message, 'required_layer')
})

Deno.test('[contract] risk-mapping: ID 序列漂移应被拒绝', async () => {
  const error = await assertRejects(
    () => loadRiskMatrix(join(FIXTURE_DIR, 'risk-matrix-id-drift.yml')),
    Error,
  )

  assertStringIncludes(error.message, '风险矩阵ID必须按顺序固定为R01..R20')
})
