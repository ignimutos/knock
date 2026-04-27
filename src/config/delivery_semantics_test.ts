import { assertEquals } from '@std/assert'
import type { PushConfig } from './schema.ts'
import { toPushRequestType } from './delivery_semantics.ts'
import { test } from '../testing/test_api.ts'

test('[unit] deliverySemantics: push request type 应接受 canonical request.type 联合并默认 body', () => {
  const bodyType: PushConfig['request']['type'] = 'body'
  const queryType: PushConfig['request']['type'] = 'query'
  const formType: PushConfig['request']['type'] = 'form'

  assertEquals(toPushRequestType(undefined), 'body')
  assertEquals(toPushRequestType(bodyType), 'body')
  assertEquals(toPushRequestType(queryType), 'query')
  assertEquals(toPushRequestType(formType), 'form')
})
