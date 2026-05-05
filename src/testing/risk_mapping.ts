import { walk } from './fs.ts'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { readTextFile } from '../platform/fs.ts'
import { z } from 'zod'
import type { RepoTestCaseMeta, TestLayer } from './test_api.ts'

export type RequiredLayer = 'unit' | 'contract' | 'flow' | 'flow+contract'

export interface RiskRule {
  id: string
  domain: string
  trigger: string
  expected_guardrail: string
  required_layer: RequiredLayer
  owner_tests: string[]
}

interface TestCaseRef {
  filePath: string
  title: string
  layer: TestLayer
  riskIds: string[]
}

interface ImportedTestMetaModule {
  testMeta?: readonly RepoTestCaseMeta[]
}

interface RiskCoverage {
  contract: Set<string>
  flow: Set<string>
}

const nonEmptyStringSchema = z.string().trim().min(1)
const testLayerSchema = z.enum(['unit', 'contract', 'flow'])
const riskIdSchema = nonEmptyStringSchema.regex(/^R\d+$/)

const testMetaEntrySchema = z
  .object({
    title: nonEmptyStringSchema,
    layer: testLayerSchema,
    risks: z.array(riskIdSchema),
  })
  .strict()

const testMetaExportSchema = z.array(testMetaEntrySchema)

const riskRuleSchema = z.object({
  id: riskIdSchema,
  domain: nonEmptyStringSchema,
  trigger: nonEmptyStringSchema,
  expected_guardrail: nonEmptyStringSchema,
  required_layer: z.enum(['unit', 'contract', 'flow', 'flow+contract']),
  owner_tests: z.array(nonEmptyStringSchema).min(1),
})

const riskMatrixSchema = z
  .array(riskRuleSchema)
  .min(1, '风险矩阵必须至少包含1条当前风险')
  .superRefine((matrix, ctx) => {
    const seen = new Map<string, number>()

    matrix.forEach((rule, index) => {
      const previousIndex = seen.get(rule.id)
      if (previousIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `风险矩阵包含重复风险 ID: ${rule.id}`,
          path: [index, 'id'],
        })
        return
      }

      seen.set(rule.id, index)
    })
  })

const testFilePattern = /_test\.tsx?$/

function getProjectRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function normalizeRelativePath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/')
}

function createRiskCoverage(): RiskCoverage {
  return {
    contract: new Set<string>(),
    flow: new Set<string>(),
  }
}

function getRiskCoverage(byRisk: Map<string, RiskCoverage>, riskId: string): RiskCoverage {
  const current = byRisk.get(riskId)
  if (current) return current

  const created = createRiskCoverage()
  byRisk.set(riskId, created)
  return created
}

async function loadExplicitTestMeta(
  projectRoot: string,
  testFile: string,
): Promise<readonly RepoTestCaseMeta[]> {
  const absolutePath = join(projectRoot, testFile)
  const previous = process.env.KNOCK_TEST_METADATA_MODE
  process.env.KNOCK_TEST_METADATA_MODE = '1'

  try {
    const imported = (await import(pathToFileURL(absolutePath).href)) as ImportedTestMetaModule
    if (!imported.testMeta || imported.testMeta.length === 0) {
      return []
    }
    return testMetaExportSchema.parse(imported.testMeta)
  } finally {
    if (previous === undefined) {
      delete process.env.KNOCK_TEST_METADATA_MODE
    } else {
      process.env.KNOCK_TEST_METADATA_MODE = previous
    }
  }
}

function normalizeTestMeta(filePath: string, testMeta: readonly RepoTestCaseMeta[]): TestCaseRef[] {
  return testMeta.map((meta) => ({
    filePath,
    title: meta.title,
    layer: testLayerSchema.parse(meta.layer),
    riskIds: Array.from(new Set(meta.risks.map((risk) => riskIdSchema.parse(risk)))).sort(),
  }))
}

async function listTestFiles(projectRoot: string): Promise<string[]> {
  const results: string[] = []

  for (const directory of ['src', 'web']) {
    for await (const entry of walk(join(projectRoot, directory), {
      includeDirs: false,
      match: [testFilePattern],
    })) {
      results.push(normalizeRelativePath(projectRoot, entry.path))
    }
  }

  results.sort()
  return results
}

async function collectTestMetadata(projectRoot: string): Promise<{
  testFiles: Set<string>
  testCases: TestCaseRef[]
}> {
  const testFiles = await listTestFiles(projectRoot)
  const testCases: TestCaseRef[] = []

  for (const testFile of testFiles) {
    const explicitTestMeta = await loadExplicitTestMeta(projectRoot, testFile)
    if (explicitTestMeta.length === 0) continue
    testCases.push(...normalizeTestMeta(testFile, explicitTestMeta))
  }

  return {
    testFiles: new Set(testFiles),
    testCases,
  }
}

function validateFlowTestsHaveRiskIds(testCases: TestCaseRef[]): string[] {
  return testCases
    .filter((testCase) => testCase.layer === 'flow' && testCase.riskIds.length === 0)
    .map((testCase) => `${testCase.filePath}::${testCase.title}`)
}

function validateKnownRiskIds(input: { matrix: RiskRule[]; testCases: TestCaseRef[] }): void {
  const knownRiskIds = new Set(input.matrix.map((rule) => rule.id))
  const unknownRiskRefs = new Map<string, string[]>()

  const addReference = (riskId: string, source: string): void => {
    if (knownRiskIds.has(riskId)) return

    const current = unknownRiskRefs.get(riskId)
    if (current) {
      current.push(source)
      return
    }

    unknownRiskRefs.set(riskId, [source])
  }

  for (const testCase of input.testCases) {
    for (const riskId of testCase.riskIds) {
      addReference(riskId, `${testCase.filePath}::${testCase.title}`)
    }
  }

  if (unknownRiskRefs.size === 0) return

  const lines = ['以下测试引用了未知风险 ID：']
  for (const riskId of Array.from(unknownRiskRefs.keys()).sort()) {
    lines.push(`- ${riskId}: ${unknownRiskRefs.get(riskId)?.join(', ')}`)
  }

  throw new Error(lines.join('\n'))
}

function buildRiskCoverage(testCases: TestCaseRef[]): Map<string, RiskCoverage> {
  const byRisk = new Map<string, RiskCoverage>()

  for (const testCase of testCases) {
    if (testCase.riskIds.length === 0) continue
    for (const riskId of testCase.riskIds) {
      const coverage = getRiskCoverage(byRisk, riskId)
      if (testCase.layer === 'contract') coverage.contract.add(testCase.filePath)
      if (testCase.layer === 'flow') coverage.flow.add(testCase.filePath)
    }
  }

  return byRisk
}

function validateRiskCoverage(input: {
  matrix: RiskRule[]
  testFiles: Set<string>
  testCases: TestCaseRef[]
}): void {
  const problems: string[] = []
  const untaggedFlowTests = validateFlowTestsHaveRiskIds(input.testCases)
  if (untaggedFlowTests.length > 0) {
    problems.push(
      ['以下 [flow] 测试缺少风险 ID：', ...untaggedFlowTests.map((item) => `- ${item}`)].join('\n'),
    )
  }

  const byRisk = buildRiskCoverage(input.testCases)

  for (const rule of input.matrix) {
    const ownerTests = new Set(rule.owner_tests)
    const coverage = byRisk.get(rule.id) ?? createRiskCoverage()

    for (const ownerTest of rule.owner_tests) {
      if (!input.testFiles.has(ownerTest)) {
        problems.push(`风险 ${rule.id} 的 owner_tests 引用了不存在的测试文件: ${ownerTest}`)
      }
    }

    for (const filePath of coverage.contract) {
      if (!ownerTests.has(filePath)) {
        problems.push(`风险 ${rule.id} 的 contract 覆盖文件未登记到 owner_tests: ${filePath}`)
      }
    }
    for (const filePath of coverage.flow) {
      if (!ownerTests.has(filePath)) {
        problems.push(`风险 ${rule.id} 的 flow 覆盖文件未登记到 owner_tests: ${filePath}`)
      }
    }

    if (rule.required_layer === 'contract' || rule.required_layer === 'flow+contract') {
      if (coverage.contract.size === 0) {
        problems.push(`风险 ${rule.id} 缺少 contract 覆盖`)
      }
    }

    if (rule.required_layer === 'flow' || rule.required_layer === 'flow+contract') {
      if (coverage.flow.size === 0) {
        problems.push(`风险 ${rule.id} 缺少 flow 覆盖`)
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n\n'))
  }
}

export async function loadRiskMatrix(path: string): Promise<RiskRule[]> {
  const text = await readTextFile(path)
  const parsed = parse(text)

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('风险矩阵必须是非空数组')
  }

  return riskMatrixSchema.parse(parsed)
}

export async function validateRiskMatrix(
  path: string,
  projectRoot: string = getProjectRoot(),
): Promise<RiskRule[]> {
  const matrix = await loadRiskMatrix(path)
  const metadata = await collectTestMetadata(projectRoot)

  validateKnownRiskIds({
    matrix,
    testCases: metadata.testCases,
  })

  validateRiskCoverage({
    matrix,
    testFiles: metadata.testFiles,
    testCases: metadata.testCases,
  })

  return matrix
}
