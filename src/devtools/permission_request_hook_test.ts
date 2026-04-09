import { assert, assertEquals, assertMatch } from '@std/assert'

const workspaceRoot = new URL('../../', import.meta.url).pathname
const hookPath = new URL('../../.claude/hooks/permission-request-allow.sh', import.meta.url)

async function runHook(payload: string) {
  const command = new Deno.Command('bash', {
    args: [hookPath.pathname],
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
    cwd: workspaceRoot,
  })
  const child = command.spawn()
  const writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(payload))
  await writer.close()

  const output = await child.output()
  const stdout = new TextDecoder().decode(output.stdout)
  const stderr = new TextDecoder().decode(output.stderr)

  assertEquals(output.code, 0, `hook exited with stderr: ${stderr}`)

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`hook stdout is not valid JSON: ${stdout}\n${error}`)
  }

  return { stdout, stderr, parsed: parsed as Record<string, unknown> }
}

function assertAllowBehavior(parsed: Record<string, unknown>) {
  const hookSpecificOutput = parsed.hookSpecificOutput as {
    hookEventName?: string
    decision?: { behavior?: string }
  }

  assertEquals(hookSpecificOutput.hookEventName, 'PermissionRequest')
  assertEquals(hookSpecificOutput.decision?.behavior, 'allow')
}

function getSystemMessage(parsed: Record<string, unknown>): string {
  const systemMessage = parsed.systemMessage
  assertEquals(typeof systemMessage, 'string')
  return systemMessage as string
}

Deno.test(
  'permission-request hook: invalid payload 时仍返回 allow JSON 并标记 invalid-json',
  async () => {
    const { parsed } = await runHook('not-json')

    assertAllowBehavior(parsed)

    const message = getSystemMessage(parsed)
    const [firstLine, secondLine] = message.split('\n')
    assertEquals(firstLine, 'PermissionRequest')
    assertEquals(secondLine, 'invalid-json')
  },
)

Deno.test('permission-request hook: Bash 缺少 command 时首行保守摘要并给出字段级诊断', async () => {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: {},
  })

  const { parsed } = await runHook(payload)

  assertAllowBehavior(parsed)

  const message = getSystemMessage(parsed)
  const [firstLine, secondLine] = message.split('\n')
  assertEquals(firstLine, 'Bash')
  assertEquals(secondLine, 'missing:tool_input.command')
})

Deno.test('permission-request hook: Edit 首行应输出工具名与 file_path', async () => {
  const payload = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/tmp/demo.txt',
    },
  })

  const { parsed } = await runHook(payload)

  assertAllowBehavior(parsed)
  assertEquals(getSystemMessage(parsed), 'Edit: /tmp/demo.txt')
})

Deno.test('permission-request hook: 长 Bash 命令应截断并附带长度标记', async () => {
  const longCommand = `python -c \"${'x'.repeat(160)}\"`
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: {
      command: longCommand,
    },
  })

  const { parsed } = await runHook(payload)

  assertAllowBehavior(parsed)

  const message = getSystemMessage(parsed)
  const [firstLine, secondLine] = message.split('\n')
  assert(secondLine === undefined)
  assertMatch(firstLine, /^Bash: python \[args=2\]… \[len=\d+\]$/)
})

Deno.test('permission-request hook: 非字符串 tool_name 应降级为 parse-failed', async () => {
  const payload = JSON.stringify({
    tool_name: { bad: true },
    tool_input: {
      command: 'git status',
    },
  })

  const { parsed } = await runHook(payload)

  assertAllowBehavior(parsed)

  const message = getSystemMessage(parsed)
  const [firstLine, secondLine] = message.split('\n')
  assertEquals(firstLine, 'PermissionRequest')
  assertEquals(secondLine, 'parse-failed')
})

Deno.test(
  'permission-request hook: 非对象 tool_input 或非字符串 command 应降级为 parse-failed',
  async () => {
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: 'oops',
    })

    const { parsed } = await runHook(payload)

    assertAllowBehavior(parsed)

    const message = getSystemMessage(parsed)
    const [firstLine, secondLine] = message.split('\n')
    assertEquals(firstLine, 'Bash')
    assertEquals(secondLine, 'parse-failed')
  },
)
