import { assert, assertEquals, assertStringIncludes } from '../../testing/assert.ts'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '../../testing/test_api.ts'

type ScriptContract = {
  name: string
  relativePath: string
}

const contracts: ScriptContract[] = [
  {
    name: 'smoke image script',
    relativePath: '../../../scripts/release/smoke_image.sh',
  },
  {
    name: 'measure cold start script',
    relativePath: '../../../scripts/release/measure_cold_start.sh',
  },
]

test('[contract] release scripts: source-friendly entrypoint', () => {
  for (const contract of contracts) {
    const text = readFileSync(new URL(contract.relativePath, import.meta.url), 'utf8')

    assert(text.includes('main() {'), `${contract.name} must define main() wrapper`)
    assert(
      text.includes('if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then'),
      `${contract.name} must include direct-execution guard`,
    )
  }
})

test('[contract] smoke image script: prepare_runtime_permissions normalizes runtime dir and config.yml modes', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-perm-'))
  const configPath = join(runtimeDir, 'config.yml')
  writeFileSync(configPath, 'sources: {}\n')
  chmodSync(runtimeDir, 0o755)
  chmodSync(configPath, 0o644)

  try {
    const scriptPath = new URL('../../../scripts/release/smoke_image.sh', import.meta.url).pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; prepare_runtime_permissions ${JSON.stringify(runtimeDir)}; echo "$(stat -c '%a' ${JSON.stringify(runtimeDir)}) $(stat -c '%a' ${JSON.stringify(configPath)})"`,
      ],
      { encoding: 'utf8' },
    )

    assertEquals(result.status, 0)
    assertEquals(result.stdout.trim(), '777 666')
    assertEquals(result.stderr, '')
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] smoke image script: assert_runtime_permissions fails fast on runtime permission drift', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-perm-'))
  const configPath = join(runtimeDir, 'config.yml')
  writeFileSync(configPath, 'sources: {}\n')
  chmodSync(runtimeDir, 0o755)
  chmodSync(configPath, 0o666)

  try {
    const scriptPath = new URL('../../../scripts/release/smoke_image.sh', import.meta.url).pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; assert_runtime_permissions ${JSON.stringify(runtimeDir)}`,
      ],
      { encoding: 'utf8' },
    )

    assert(result.status !== 0, 'assert_runtime_permissions must fail on permission drift')
    assertStringIncludes(
      result.stderr,
      'runtime permission check failed: expected runtime_dir mode 777, got 755',
    )
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] smoke image script: assert_runtime_permissions fails when runtime dir is missing', () => {
  const runtimeDir = join(tmpdir(), `knock-runtime-perm-missing-${Date.now()}-${Math.random()}`)

  const scriptPath = new URL('../../../scripts/release/smoke_image.sh', import.meta.url).pathname
  const result = spawnSync(
    'bash',
    [
      '-lc',
      `source ${JSON.stringify(scriptPath)}; assert_runtime_permissions ${JSON.stringify(runtimeDir)}`,
    ],
    { encoding: 'utf8' },
  )

  assert(result.status !== 0, 'assert_runtime_permissions must fail when runtime_dir is missing')
  assertEquals(
    result.stderr,
    'runtime permission check failed: runtime_dir must exist and be a directory\n',
  )
})

test('[contract] smoke image script: assert_runtime_permissions fails when config.yml is missing', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-perm-'))

  try {
    const scriptPath = new URL('../../../scripts/release/smoke_image.sh', import.meta.url).pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; assert_runtime_permissions ${JSON.stringify(runtimeDir)}`,
      ],
      { encoding: 'utf8' },
    )

    assert(result.status !== 0, 'assert_runtime_permissions must fail when config.yml is missing')
    assertEquals(
      result.stderr,
      'runtime permission check failed: config.yml must exist and be a regular file\n',
    )
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] measure cold start script: prepare_runtime_permissions normalizes runtime dir and config.yml modes', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-perm-'))
  const configPath = join(runtimeDir, 'config.yml')
  writeFileSync(configPath, 'sources: {}\n')
  chmodSync(runtimeDir, 0o755)
  chmodSync(configPath, 0o644)

  try {
    const scriptPath = new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)
      .pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; prepare_runtime_permissions ${JSON.stringify(runtimeDir)}; echo "$(stat -c '%a' ${JSON.stringify(runtimeDir)}) $(stat -c '%a' ${JSON.stringify(configPath)})"`,
      ],
      { encoding: 'utf8' },
    )

    assertEquals(result.status, 0)
    assertEquals(result.stdout.trim(), '777 666')
    assertEquals(result.stderr, '')
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] measure cold start script: assert_runtime_permissions fails fast on runtime permission drift', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-perm-'))
  const configPath = join(runtimeDir, 'config.yml')
  writeFileSync(configPath, 'sources: {}\n')
  chmodSync(runtimeDir, 0o755)
  chmodSync(configPath, 0o666)

  try {
    const scriptPath = new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)
      .pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; assert_runtime_permissions ${JSON.stringify(runtimeDir)}`,
      ],
      { encoding: 'utf8' },
    )

    assert(result.status !== 0, 'assert_runtime_permissions must fail on permission drift')
    assertEquals(
      result.stderr,
      'runtime permission check failed: expected runtime_dir mode 777, got 755\n',
    )
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] measure cold start script: assert_runtime_permissions fails when runtime dir is missing', () => {
  const runtimeDir = join(tmpdir(), `knock-runtime-perm-missing-${Date.now()}-${Math.random()}`)

  const scriptPath = new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)
    .pathname
  const result = spawnSync(
    'bash',
    [
      '-lc',
      `source ${JSON.stringify(scriptPath)}; assert_runtime_permissions ${JSON.stringify(runtimeDir)}`,
    ],
    { encoding: 'utf8' },
  )

  assert(result.status !== 0, 'assert_runtime_permissions must fail when runtime_dir is missing')
  assertEquals(
    result.stderr,
    'runtime permission check failed: runtime_dir must exist and be a directory\n',
  )
})

test('[contract] measure cold start script: assert_runtime_permissions fails when config.yml is missing', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-perm-'))

  try {
    const scriptPath = new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)
      .pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; assert_runtime_permissions ${JSON.stringify(runtimeDir)}`,
      ],
      { encoding: 'utf8' },
    )

    assert(result.status !== 0, 'assert_runtime_permissions must fail when config.yml is missing')
    assertEquals(
      result.stderr,
      'runtime permission check failed: config.yml must exist and be a regular file\n',
    )
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] measure cold start script: does not fail when improvement is below the historical threshold gate', () => {
  const scriptPath = new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)
    .pathname
  const result = spawnSync(
    'bash',
    [
      '-lc',
      `source ${JSON.stringify(scriptPath)}
measure_series() {
  local image="$1"
  if [ "$image" = 'baseline-image' ]; then
    printf '100\n100\n100\n'
    return 0
  fi
  printf '90\n90\n90\n'
}
median_ms() {
  printf '%s\n' "$1"
}
BASE_IMAGE='baseline-image' CANDIDATE_IMAGE='candidate-image' THRESHOLD_PCT='30' main`,
    ],
    { encoding: 'utf8' },
  )

  assertEquals(result.status, 0)
  assertStringIncludes(result.stdout, 'baseline_median_ms=100')
  assertStringIncludes(result.stdout, 'candidate_median_ms=90')
  assertStringIncludes(result.stdout, 'improvement_pct=10')
  assertEquals(result.stderr, '')
})
