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

const entrypointUrl = new URL('../../../docker/entrypoint.sh', import.meta.url)

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

test('[contract] smoke image script: docker image entrypoint points to shell entrypoint', () => {
  const text = readFileSync(
    new URL('../../../scripts/release/smoke_image.sh', import.meta.url),
    'utf8',
  )

  assertStringIncludes(text, 'expected [\\"/app/docker-entrypoint.sh\\"]')
  assertStringIncludes(text, 'unexpected image entrypoint:')
})

test('[contract] smoke binary script: daemon startup probe must use one-shot mode', () => {
  const text = readFileSync(
    new URL('../../../scripts/release/smoke_binary.sh', import.meta.url),
    'utf8',
  )

  assertStringIncludes(text, '"$binary" --mode daemon --runtime_dir "$workdir" --once')
})

test('[contract] release scripts: ready marker matching uses fixed-string grep', () => {
  for (const contract of contracts) {
    const text = readFileSync(new URL(contract.relativePath, import.meta.url), 'utf8')
    assertStringIncludes(
      text,
      'grep -Fq --',
      `${contract.name} must use fixed-string ready marker matching`,
    )
  }
})

test('[contract] smoke image script: prepare_runtime_fixture normalizes runtime dir and config.yml modes', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-fixture-'))
  const configPath = join(runtimeDir, 'config.yml')
  writeFileSync(configPath, 'sources: {}\n')
  chmodSync(runtimeDir, 0o755)
  chmodSync(configPath, 0o600)

  try {
    const scriptPath = new URL('../../../scripts/release/smoke_image.sh', import.meta.url).pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; prepare_runtime_fixture ${JSON.stringify(runtimeDir)}; echo "$(stat -c '%a' ${JSON.stringify(runtimeDir)}) $(stat -c '%a' ${JSON.stringify(configPath)})"`,
      ],
      { encoding: 'utf8' },
    )

    assertEquals(result.status, 0)
    assertEquals(result.stdout.trim(), '700 644')
    assertEquals(result.stderr, '')
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] smoke image script: assert_runtime_fixture fails fast on runtime fixture drift', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-fixture-'))
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
        `source ${JSON.stringify(scriptPath)}; assert_runtime_fixture ${JSON.stringify(runtimeDir)}`,
      ],
      { encoding: 'utf8' },
    )

    assert(result.status !== 0, 'assert_runtime_fixture must fail on permission drift')
    assertStringIncludes(
      result.stderr,
      'runtime fixture check failed: expected runtime_dir mode 700, got 755',
    )
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] smoke image script: assert_runtime_fixture fails when runtime dir is missing', () => {
  const runtimeDir = join(tmpdir(), `knock-runtime-fixture-missing-${Date.now()}-${Math.random()}`)

  const scriptPath = new URL('../../../scripts/release/smoke_image.sh', import.meta.url).pathname
  const result = spawnSync(
    'bash',
    [
      '-lc',
      `source ${JSON.stringify(scriptPath)}; assert_runtime_fixture ${JSON.stringify(runtimeDir)}`,
    ],
    { encoding: 'utf8' },
  )

  assert(result.status !== 0, 'assert_runtime_fixture must fail when runtime_dir is missing')
  assertEquals(
    result.stderr,
    'runtime fixture check failed: runtime_dir must exist and be a directory\n',
  )
})

test('[contract] smoke image script: assert_runtime_fixture fails when config.yml is missing', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-fixture-'))

  try {
    const scriptPath = new URL('../../../scripts/release/smoke_image.sh', import.meta.url).pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; assert_runtime_fixture ${JSON.stringify(runtimeDir)}`,
      ],
      { encoding: 'utf8' },
    )

    assert(result.status !== 0, 'assert_runtime_fixture must fail when config.yml is missing')
    assertEquals(
      result.stderr,
      'runtime fixture check failed: config.yml must exist and be a regular file\n',
    )
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] measure cold start script: prepare_runtime_fixture normalizes runtime dir and config.yml modes', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-fixture-'))
  const configPath = join(runtimeDir, 'config.yml')
  writeFileSync(configPath, 'sources: {}\n')
  chmodSync(runtimeDir, 0o755)
  chmodSync(configPath, 0o600)

  try {
    const scriptPath = new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)
      .pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; prepare_runtime_fixture ${JSON.stringify(runtimeDir)}; echo "$(stat -c '%a' ${JSON.stringify(runtimeDir)}) $(stat -c '%a' ${JSON.stringify(configPath)})"`,
      ],
      { encoding: 'utf8' },
    )

    assertEquals(result.status, 0)
    assertEquals(result.stdout.trim(), '700 644')
    assertEquals(result.stderr, '')
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] measure cold start script: assert_runtime_fixture fails fast on runtime fixture drift', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-fixture-'))
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
        `source ${JSON.stringify(scriptPath)}; assert_runtime_fixture ${JSON.stringify(runtimeDir)}`,
      ],
      { encoding: 'utf8' },
    )

    assert(result.status !== 0, 'assert_runtime_fixture must fail on permission drift')
    assertEquals(
      result.stderr,
      'runtime fixture check failed: expected runtime_dir mode 700, got 755\n',
    )
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] measure cold start script: assert_runtime_fixture fails when runtime dir is missing', () => {
  const runtimeDir = join(tmpdir(), `knock-runtime-fixture-missing-${Date.now()}-${Math.random()}`)

  const scriptPath = new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)
    .pathname
  const result = spawnSync(
    'bash',
    [
      '-lc',
      `source ${JSON.stringify(scriptPath)}; assert_runtime_fixture ${JSON.stringify(runtimeDir)}`,
    ],
    { encoding: 'utf8' },
  )

  assert(result.status !== 0, 'assert_runtime_fixture must fail when runtime_dir is missing')
  assertEquals(
    result.stderr,
    'runtime fixture check failed: runtime_dir must exist and be a directory\n',
  )
})

test('[contract] measure cold start script: assert_runtime_fixture fails when config.yml is missing', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-runtime-fixture-'))

  try {
    const scriptPath = new URL('../../../scripts/release/measure_cold_start.sh', import.meta.url)
      .pathname
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source ${JSON.stringify(scriptPath)}; assert_runtime_fixture ${JSON.stringify(runtimeDir)}`,
      ],
      { encoding: 'utf8' },
    )

    assert(result.status !== 0, 'assert_runtime_fixture must fail when config.yml is missing')
    assertEquals(
      result.stderr,
      'runtime fixture check failed: config.yml must exist and be a regular file\n',
    )
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true })
  }
})

test('[contract] measure cold start script: main fails with script-level error when measure_series exits non-zero after partial output', () => {
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
    printf '100\n'
    return 7
  fi
  printf '90\n'
}
median_ms() {
  printf '%s\n' "$1"
}
BASE_IMAGE='baseline-image' CANDIDATE_IMAGE='candidate-image' main`,
    ],
    { encoding: 'utf8' },
  )

  assert(result.status !== 0, 'main must fail when measure_series fails after partial output')
  assertStringIncludes(result.stderr, 'baseline series failed before collecting 3 samples')
})

test('[contract] measure cold start script: main fails when collected sample count is below SAMPLES', () => {
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
    printf '100\n'
    return 0
  fi
  printf '90\n90\n90\n'
}
median_ms() {
  printf '%s\n' "$1"
}
BASE_IMAGE='baseline-image' CANDIDATE_IMAGE='candidate-image' SAMPLES='3' main`,
    ],
    { encoding: 'utf8' },
  )

  assert(result.status !== 0, 'main must fail when sample count is below SAMPLES')
  assertStringIncludes(result.stderr, 'expected 3 baseline samples, got 1')
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

test('[contract] Dockerfile: final image uses copy-time ownership instead of post-copy /app chown', () => {
  const text = readFileSync(new URL('../../../Dockerfile', import.meta.url), 'utf8')

  assertStringIncludes(
    text,
    'COPY --from=build --chown=knock:knock /app/dist/knock-linux-x64 /app/knock-linux-x64',
  )
  assertStringIncludes(
    text,
    'COPY --chown=knock:knock docker/entrypoint.sh /app/docker-entrypoint.sh',
  )
  assert(
    !text.includes('chown -R knock:knock /app'),
    'Dockerfile should stop doing a post-copy recursive /app chown',
  )
})

test('[contract] docker entrypoint: fix_runtime_permissions must repair runtime dir tree directly', () => {
  const text = readFileSync(entrypointUrl, 'utf8')

  assertStringIncludes(text, 'if [ -d "$runtime_dir" ]; then')
  assertStringIncludes(text, 'chown -R "${target_uid}:${target_gid}" "$runtime_dir"')
  assertStringIncludes(text, 'chmod -R u+rwX "$runtime_dir"')
  assertStringIncludes(text, 'chmod -R g+rwX "$runtime_dir"')
  assert(!text.includes('for path in'), 'fix_runtime_permissions must not use whitelist path loop')
  assert(
    !text.includes('"$runtime_dir/config.yml"'),
    'fix_runtime_permissions must not hardcode runtime subpaths',
  )
})

test('[contract] docker entrypoint: non-root startup must gate permission repair by root and runtime dir existence', () => {
  const text = readFileSync(entrypointUrl, 'utf8')

  assertStringIncludes(text, 'runtime_dir="$RUNTIME_DIR"')
  assertStringIncludes(text, 'if [ "$(id -u)" -eq 0 ] && [ -d "$runtime_dir" ]; then')
  assertStringIncludes(text, 'fix_runtime_permissions "$runtime_dir" "$target_uid" "$target_gid"')
})
