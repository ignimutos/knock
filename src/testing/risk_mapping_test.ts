import { assertEquals, assertRejects, assertStringIncludes } from './assert.ts'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirPath, removePath, writeTextFile } from '../platform/fs.ts'
import { loadRiskMatrix, validateRiskMatrix } from './risk_mapping.ts'
import { test } from './test_api.ts'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(TEST_DIR, 'fixtures')
const CANONICAL_RISK_MATRIX_PATH = join(TEST_DIR, '..', '..', 'docs', 'testing', 'risk-matrix.yml')
const TMP_ROOT = join(TEST_DIR, '..', '..', '.tmp', 'risk-mapping')

async function withTempProject(name: string, run: (projectRoot: string) => Promise<void>) {
  const projectRoot = join(TMP_ROOT, name)
  await removePath(projectRoot, { recursive: true, force: true })
  await mkdirPath(join(projectRoot, 'src'), { recursive: true })
  await mkdirPath(join(projectRoot, 'src', 'testing'), { recursive: true })
  await mkdirPath(join(projectRoot, 'web'), { recursive: true })
  await mkdirPath(join(projectRoot, 'testing'), { recursive: true })
  await mkdirPath(join(projectRoot, 'docs', 'testing'), { recursive: true })
  await writeTextFile(join(projectRoot, 'testing', 'test_api.ts'), 'export function test() {}\n')
  await writeTextFile(
    join(projectRoot, 'src', 'testing', 'test_api.ts'),
    'export function test() {}\n',
  )

  try {
    await run(projectRoot)
  } finally {
    await removePath(projectRoot, { recursive: true, force: true })
  }
}

function createFixtureTestMetaSource(input: {
  title: string
  layer: 'unit' | 'contract' | 'flow'
  risks: string[]
}): string {
  return [
    'export const testMeta = [',
    '  {',
    `    title: ${JSON.stringify(input.title)},`,
    `    layer: ${JSON.stringify(input.layer)},`,
    `    risks: ${JSON.stringify(input.risks)},`,
    '  },',
    '] as const',
    '',
  ].join('\n')
}

test('[contract] risk-mapping: canonical 风险矩阵与当前测试现实一致时应通过', async () => {
  const matrix = await validateRiskMatrix(CANONICAL_RISK_MATRIX_PATH)

  assertEquals(matrix.length > 0, true)
  assertEquals(
    matrix.some((rule) => rule.required_layer === 'flow+contract'),
    true,
  )
  assertEquals(
    matrix.some((rule) => rule.required_layer === 'contract'),
    true,
  )
  assertEquals(
    matrix.every(
      (rule) =>
        rule.owner_tests.length > 0 &&
        rule.owner_tests.every((ownerTest) => /_test\.tsx?$/.test(ownerTest)),
    ),
    true,
  )
})

test('[contract] risk-mapping: 非空矩阵不应再依赖固定 20 条', async () => {
  await withTempProject('single-entry', async (projectRoot) => {
    const matrixPath = join(projectRoot, 'docs', 'testing', 'risk-matrix.yml')

    await writeTextFile(
      matrixPath,
      `
- id: R1
  domain: config
  trigger: config parse failure
  expected_guardrail: current validator rejects unsupported shape
  required_layer: contract
  owner_tests:
    - src/config_contract_test.ts
`.trim() + '\n',
    )

    const matrix = await loadRiskMatrix(matrixPath)
    assertEquals(
      matrix.map((item) => item.id),
      ['R1'],
    )
  })
})

test('[contract] risk-mapping: 重复风险 ID 应被拒绝', async () => {
  await withTempProject('duplicate-risk-id', async (projectRoot) => {
    const matrixPath = join(projectRoot, 'docs', 'testing', 'risk-matrix.yml')

    await writeTextFile(
      matrixPath,
      `
- id: R1
  domain: config
  trigger: config parse failure
  expected_guardrail: current validator rejects unsupported shape
  required_layer: contract
  owner_tests:
    - src/config_contract_test.ts
- id: R1
  domain: config
  trigger: config parse failure again
  expected_guardrail: duplicate ids must not merge coverage
  required_layer: contract
  owner_tests:
    - src/other_config_contract_test.ts
`.trim() + '\n',
    )

    const error = await assertRejects(() => loadRiskMatrix(matrixPath), Error)
    assertStringIncludes(error.message, '重复')
  })
})

test('[contract] risk-mapping: 非法风险 ID 格式应被拒绝', async () => {
  await withTempProject('invalid-risk-id-format', async (projectRoot) => {
    const matrixPath = join(projectRoot, 'docs', 'testing', 'risk-matrix.yml')

    await writeTextFile(
      matrixPath,
      `
- id: risk-1
  domain: config
  trigger: config parse failure
  expected_guardrail: matrix should reject invalid risk id format early
  required_layer: contract
  owner_tests:
    - src/config_contract_test.ts
`.trim() + '\n',
    )

    const error = await assertRejects(() => loadRiskMatrix(matrixPath), Error)
    assertStringIncludes(error.message, 'id')
  })
})

test('[contract] risk-mapping: flow 测试应接受任意位数风险 ID', async () => {
  await withTempProject('flow-risk-id', async (projectRoot) => {
    const matrixPath = join(projectRoot, 'docs', 'testing', 'risk-matrix.yml')

    await writeTextFile(
      matrixPath,
      `
- id: R123
  domain: pipeline
  trigger: incoming entry hits flow test
  expected_guardrail: flow test coverage is mapped by live risk id
  required_layer: flow
  owner_tests:
    - src/flow_risk_test.ts
`.trim() + '\n',
    )

    await writeTextFile(
      join(projectRoot, 'src', 'flow_risk_test.ts'),
      createFixtureTestMetaSource({
        title: '[flow] risk mapping uses R123 current fact',
        layer: 'flow',
        risks: ['R123'],
      }),
    )

    await validateRiskMatrix(matrixPath, projectRoot)
  })
})

test('[contract] risk-mapping: exported testMeta 应驱动风险覆盖校验', async () => {
  await withTempProject('module-meta', async (projectRoot) => {
    const matrixPath = join(projectRoot, 'docs', 'testing', 'risk-matrix.yml')

    await writeTextFile(
      matrixPath,
      `
- id: R1
  domain: config
  trigger: config parse failure
  expected_guardrail: explicit testMeta should be the only coverage source
  required_layer: flow+contract
  owner_tests:
    - src/config_contract_test.ts
    - web/config_flow_test.ts
`.trim() + '\n',
    )

    await writeTextFile(
      join(projectRoot, 'src', 'config_contract_test.ts'),
      createFixtureTestMetaSource({
        title: 'config contract covers R1',
        layer: 'contract',
        risks: ['R1'],
      }),
    )

    await writeTextFile(
      join(projectRoot, 'web', 'config_flow_test.ts'),
      createFixtureTestMetaSource({
        title: 'R1 config flow covers same risk',
        layer: 'flow',
        risks: ['R1'],
      }),
    )

    await validateRiskMatrix(matrixPath, projectRoot)
  })
})

test('[contract] risk-mapping: 测试引用未知风险 ID 时应报错', async () => {
  await withTempProject('unknown-risk-id', async (projectRoot) => {
    const matrixPath = join(projectRoot, 'docs', 'testing', 'risk-matrix.yml')

    await writeTextFile(
      matrixPath,
      `
- id: R1
  domain: config
  trigger: config parse failure
  expected_guardrail: current validator rejects unsupported shape
  required_layer: contract
  owner_tests:
    - src/unknown_risk_test.ts
`.trim() + '\n',
    )

    await writeTextFile(
      join(projectRoot, 'src', 'unknown_risk_test.ts'),
      createFixtureTestMetaSource({
        title: '[contract] risk mapping rejects unknown R99',
        layer: 'contract',
        risks: ['R99'],
      }),
    )

    const error = await assertRejects(() => validateRiskMatrix(matrixPath, projectRoot), Error)
    assertStringIncludes(error.message, '未知风险 ID')
    assertStringIncludes(error.message, 'R99')
  })
})

test('[contract] risk-mapping: 非法 required_layer 应被拒绝', async () => {
  const error = await assertRejects(
    () => loadRiskMatrix(join(FIXTURE_DIR, 'risk-matrix-invalid-layer.yml')),
    Error,
  )

  assertStringIncludes(error.message, 'required_layer')
})

test('[contract] risk-mapping: owner_tests 引用不存在文件时应报错', async () => {
  await withTempProject('missing-owner-test', async (projectRoot) => {
    const matrixPath = join(projectRoot, 'docs', 'testing', 'risk-matrix.yml')

    await writeTextFile(
      matrixPath,
      `
- id: R1
  domain: config
  trigger: config parse failure
  expected_guardrail: current validator rejects unsupported shape
  required_layer: contract
  owner_tests:
    - src/config_contract_test.ts
    - src/missing_config_test.ts
`.trim() + '\n',
    )

    await writeTextFile(
      join(projectRoot, 'src', 'config_contract_test.ts'),
      createFixtureTestMetaSource({
        title: '[contract] risk-mapping: R1 owner coverage',
        layer: 'contract',
        risks: ['R1'],
      }),
    )

    const error = await assertRejects(() => validateRiskMatrix(matrixPath, projectRoot), Error)
    assertStringIncludes(error.message, 'src/missing_config_test.ts')
  })
})
