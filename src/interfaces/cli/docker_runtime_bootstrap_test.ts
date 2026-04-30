import { spawnSync } from 'node:child_process'
import { chownSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { assertEquals, assertStringIncludes } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'

const scriptUrl = new URL('../../../docker/entrypoint.sh', import.meta.url)
const scriptPath = fileURLToPath(scriptUrl)

function sourceEntrypointAndRun(command: string, args: string[] = []) {
  return spawnSync('sh', ['-c', '. "$1"; shift; "$@"', 'sh', scriptPath, command, ...args], {
    encoding: 'utf8',
  })
}

test('[contract] docker entrypoint: source-friendly main guard', () => {
  const text = readFileSync(scriptUrl, 'utf8')
  assertStringIncludes(text, 'main() {')
  assertStringIncludes(
    text,
    'if [ "${0##*/}" = "entrypoint.sh" ] || [ "${0##*/}" = "docker-entrypoint.sh" ]; then',
  )
})

test('[contract] docker entrypoint: runtime owner should become target uid/gid', () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'knock-docker-entrypoint-'))

  try {
    const currentUid = process.getuid?.() ?? 0
    const currentGid = process.getgid?.() ?? 0
    let expectedOwner: string

    if (currentUid === 0 && currentGid === 0) {
      chownSync(runtimeDir, 10001, 10001)
      expectedOwner = '10001:10001'
    } else {
      expectedOwner = `${currentUid}:${currentGid}`
    }

    const owner = sourceEntrypointAndRun('read_runtime_owner', [runtimeDir])
    assertEquals(owner.status, 0)
    assertEquals(owner.stdout.trim(), expectedOwner)

    const [runtimeUid, runtimeGid] = expectedOwner.split(':')
    const resolved = sourceEntrypointAndRun('resolve_target_identity', [
      '10001',
      '10001',
      runtimeUid,
      runtimeGid,
    ])
    assertEquals(resolved.status, 0)
    assertEquals(resolved.stdout.trim(), `${expectedOwner} keep-root=0`)
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true })
  }
})

test('[contract] docker entrypoint: root-owned runtime should keep root', () => {
  const result = sourceEntrypointAndRun('resolve_target_identity', ['10001', '10001', '0', '0'])
  assertEquals(result.status, 0)
  assertEquals(result.stdout.trim(), '0:0 keep-root=1')
})
