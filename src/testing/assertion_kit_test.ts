import { assertThrows } from '@std/assert'
import { assertErrorShape } from './assertion_kit.ts'

Deno.test('assertion-kit: 应断言错误类别与关键字段', () => {
  assertErrorShape(new Error('boom'), {
    name: 'Error',
    messageIncludes: 'boom',
  })
})

Deno.test('assertion-kit: messageIncludes 不匹配应抛错', () => {
  assertThrows(
    () =>
      assertErrorShape(new Error('boom'), {
        messageIncludes: 'nope',
      }),
    Error,
  )
})
