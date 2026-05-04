import { walk } from './fs.ts'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { readTextFile } from '../platform/fs.ts'
import { z } from 'zod'

export type RequiredLayer = 'unit' | 'contract' | 'flow' | 'flow+contract'
export type TestLayer = 'unit' | 'contract' | 'flow'

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

interface FileRiskAnnotation {
  filePath: string
  layer: TestLayer
  riskIds: string[]
}

interface RiskCoverage {
  contract: Set<string>
  flow: Set<string>
}

const nonEmptyStringSchema = z.string().trim().min(1)
const testLayerSchema = z.enum(['unit', 'contract', 'flow'])

const riskIdSchema = nonEmptyStringSchema.regex(/^R\d+$/)

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

const testTitlePattern = /\btest\((?:\s|\n)*(['"`])([\s\S]*?)\1/g
const riskIdPattern = /\bR\d+\b/g
const riskCommentPattern = /^\s*\/\/\s*risk-id:\s*(.+)$/gm
const layerCommentPattern = /^\s*\/\/\s*layer:\s*(unit|contract|flow)\s*$/m
const helperDefaultLayerPattern =
  /name\.startsWith\(\s*['"]\[['"]\s*\)\s*\?\s*name\s*:\s*`\[(unit|contract|flow)\]\s*\$\{name\}`/
const testFilePattern = /_test\.tsx?$/

function getProjectRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function normalizeRelativePath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/')
}

function parseRiskIds(raw: string): string[] {
  return Array.from(new Set(raw.match(riskIdPattern) ?? [])).sort()
}

function parseLayerFromTitle(title: string): TestLayer | undefined {
  const match = /^\[(unit|contract|flow)\]/.exec(title)
  return match?.[1] as TestLayer | undefined
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

function parseHelperDefaultLayer(source: string): TestLayer | undefined {
  const match = source.match(helperDefaultLayerPattern)
  return match?.[1] as TestLayer | undefined
}

function parseTestCases(filePath: string, source: string): TestCaseRef[] {
  const cases: TestCaseRef[] = []
  const helperDefaultLayer = parseHelperDefaultLayer(source)
  const usesRepoTestApi =
    source.includes("from '../testing/test_api.ts'") ||
    source.includes('from "../testing/test_api.ts"') ||
    source.includes("from './testing/test_api.ts'") ||
    source.includes('from "./testing/test_api.ts"') ||
    source.includes("from '../src/testing/test_api.ts'") ||
    source.includes('from "../src/testing/test_api.ts"')

  for (const match of source.matchAll(testTitlePattern)) {
    const title = match[2]
    const layer =
      parseLayerFromTitle(title) ?? helperDefaultLayer ?? (usesRepoTestApi ? 'contract' : undefined)
    if (!layer) continue

    cases.push({
      filePath,
      title,
      layer,
      riskIds: parseRiskIds(title),
    })
  }

  return cases
}

function parseFileRiskAnnotation(filePath: string, source: string): FileRiskAnnotation | undefined {
  const layerMatch = source.match(layerCommentPattern)
  if (!layerMatch) return undefined

  const layer = testLayerSchema.parse(layerMatch[1])
  const riskIds = parseRiskIds(
    Array.from(source.matchAll(riskCommentPattern))
      .map((match) => match[1])
      .join(' '),
  )

  if (riskIds.length === 0) return undefined

  return {
    filePath,
    layer,
    riskIds,
  }
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
  fileAnnotations: FileRiskAnnotation[]
}> {
  const testFiles = await listTestFiles(projectRoot)
  const testCases: TestCaseRef[] = []
  const fileAnnotations: FileRiskAnnotation[] = []

  for (const testFile of testFiles) {
    const absolutePath = join(projectRoot, testFile)
    const source = await readTextFile(absolutePath)
    testCases.push(...parseTestCases(testFile, source))

    const annotation = parseFileRiskAnnotation(testFile, source)
    if (annotation) {
      fileAnnotations.push(annotation)
    }
  }

  return {
    testFiles: new Set(testFiles),
    testCases,
    fileAnnotations,
  }
}

function validateFlowTestsHaveRiskIds(testCases: TestCaseRef[]): string[] {
  return testCases
    .filter((testCase) => testCase.layer === 'flow' && testCase.riskIds.length === 0)
    .map((testCase) => `${testCase.filePath}::${testCase.title}`)
}

function validateKnownRiskIds(input: {
  matrix: RiskRule[]
  testCases: TestCaseRef[]
  fileAnnotations: FileRiskAnnotation[]
}): void {
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

  for (const annotation of input.fileAnnotations) {
    for (const riskId of annotation.riskIds) {
      addReference(riskId, `${annotation.filePath}::file annotation`)
    }
  }

  if (unknownRiskRefs.size === 0) return

  const lines = ['以下测试引用了未知风险 ID：']
  for (const riskId of Array.from(unknownRiskRefs.keys()).sort()) {
    lines.push(`- ${riskId}: ${unknownRiskRefs.get(riskId)?.join(', ')}`)
  }

  throw new Error(lines.join('\n'))
}

function buildRiskCoverage(input: {
  testCases: TestCaseRef[]
  fileAnnotations: FileRiskAnnotation[]
}): Map<string, RiskCoverage> {
  const byRisk = new Map<string, RiskCoverage>()

  for (const testCase of input.testCases) {
    if (testCase.riskIds.length === 0) continue
    for (const riskId of testCase.riskIds) {
      const coverage = getRiskCoverage(byRisk, riskId)
      if (testCase.layer === 'contract') coverage.contract.add(testCase.filePath)
      if (testCase.layer === 'flow') coverage.flow.add(testCase.filePath)
    }
  }

  for (const annotation of input.fileAnnotations) {
    for (const riskId of annotation.riskIds) {
      const coverage = getRiskCoverage(byRisk, riskId)
      if (annotation.layer === 'contract') coverage.contract.add(annotation.filePath)
      if (annotation.layer === 'flow') coverage.flow.add(annotation.filePath)
    }
  }

  return byRisk
}

function validateRiskCoverage(input: {
  matrix: RiskRule[]
  testFiles: Set<string>
  testCases: TestCaseRef[]
  fileAnnotations: FileRiskAnnotation[]
}): void {
  const problems: string[] = []
  const untaggedFlowTests = validateFlowTestsHaveRiskIds(input.testCases)
  if (untaggedFlowTests.length > 0) {
    problems.push(
      ['以下 [flow] 测试缺少风险 ID：', ...untaggedFlowTests.map((item) => `- ${item}`)].join('\n'),
    )
  }

  const byRisk = buildRiskCoverage({
    testCases: input.testCases,
    fileAnnotations: input.fileAnnotations,
  })

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
    fileAnnotations: metadata.fileAnnotations,
  })

  validateRiskCoverage({
    matrix,
    testFiles: metadata.testFiles,
    testCases: metadata.testCases,
    fileAnnotations: metadata.fileAnnotations,
  })

  return matrix
}
