import { assertEquals, assertThrows } from '../../testing/assert.ts'
import { parseCliCommand } from './parse_cli_command.ts'
import { test } from '../../testing/test_api.ts'

test('[contract] parseCliCommand: 应把 flags 解析成显式 daemon 命令对象', () => {
  assertEquals(
    parseCliCommand([
      '--mode',
      'daemon',
      '--config',
      '/tmp/config.yml',
      '--runtime_dir',
      '/tmp/runtime',
    ]),
    {
      kind: 'daemon',
      configPath: '/tmp/config.yml',
      runtimeDir: '/tmp/runtime',
      immediate: false,
    },
  )
})

test('[contract] parseCliCommand: 应把 web 参数解析成显式 web 命令对象', () => {
  assertEquals(
    parseCliCommand(['--mode', 'web', '--web_host', '127.0.0.1', '--web_port', '8080']),
    {
      kind: 'web',
      host: '127.0.0.1',
      port: 8080,
    },
  )
})

test('[contract] parseCliCommand: --mode 非法值时应报错', () => {
  assertThrows(() => parseCliCommand(['--mode', 'oops']), Error, '--mode 非法: oops')
})
