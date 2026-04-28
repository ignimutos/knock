import {
  AssertionError,
  deepStrictEqual,
  match,
  notDeepStrictEqual,
  notStrictEqual,
  ok,
} from 'node:assert/strict'

function normalizeExpectation(errorClassOrMessage, message) {
  if (typeof errorClassOrMessage === 'string') {
    return { ErrorClass: Error, messageIncludes: errorClassOrMessage }
  }
  return {
    ErrorClass: errorClassOrMessage ?? Error,
    messageIncludes: message,
  }
}

function assertErrorMatch(error, ErrorClass, messageIncludes) {
  if (!(error instanceof ErrorClass)) {
    throw new AssertionError({
      message: `Expected error to be instance of ${ErrorClass.name}`,
      actual: error,
      expected: ErrorClass,
    })
  }
  if (messageIncludes && !String(error.message).includes(messageIncludes)) {
    throw new AssertionError({
      message: `Expected error message to include ${JSON.stringify(messageIncludes)}`,
      actual: error.message,
      expected: messageIncludes,
    })
  }
}

export function assert(expr, msg) {
  ok(expr, msg)
}

export function assertEquals(actual, expected, msg) {
  deepStrictEqual(actual, expected, msg)
}

export function assertNotEquals(actual, expected, msg) {
  notDeepStrictEqual(actual, expected, msg)
}

export function assertNotStrictEquals(actual, expected, msg) {
  notStrictEqual(actual, expected, msg)
}

export function assertExists(value, msg) {
  if (value === undefined || value === null) {
    throw new AssertionError({ message: msg ?? 'Expected value to be neither null nor undefined' })
  }
}

export function assertMatch(actual, expected, msg) {
  match(actual, expected, msg)
}

export function assertStringIncludes(actual, expected, msg) {
  if (!String(actual).includes(String(expected))) {
    throw new AssertionError({
      message:
        msg ??
        `Expected actual: ${JSON.stringify(actual)} to contain: ${JSON.stringify(expected)}.`,
      actual,
      expected,
    })
  }
}

export function assertThrows(fn, errorClassOrMessage, message) {
  const { ErrorClass, messageIncludes } = normalizeExpectation(errorClassOrMessage, message)
  try {
    fn()
  } catch (error) {
    assertErrorMatch(error, ErrorClass, messageIncludes)
    return error
  }
  throw new AssertionError({ message: 'Expected function to throw' })
}

export async function assertRejects(fn, errorClassOrMessage, message) {
  const { ErrorClass, messageIncludes } = normalizeExpectation(errorClassOrMessage, message)
  try {
    await fn()
  } catch (error) {
    assertErrorMatch(error, ErrorClass, messageIncludes)
    return error
  }
  throw new AssertionError({ message: 'Expected function to reject' })
}
