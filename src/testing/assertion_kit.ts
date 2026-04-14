import { assertEquals, assertStringIncludes } from '@std/assert'

export interface ErrorShapeExpectation {
  name?: string
  messageIncludes?: string
}

export function assertErrorShape(
  error: unknown,
  expected: ErrorShapeExpectation,
): asserts error is Error {
  if (!(error instanceof Error)) {
    throw new Error('期望 error 为 Error 实例')
  }

  if (expected.name) {
    assertEquals(error.name, expected.name)
  }

  if (expected.messageIncludes) {
    assertStringIncludes(error.message, expected.messageIncludes)
  }
}
