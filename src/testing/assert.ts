import {
  AssertionError,
  deepStrictEqual,
  match,
  notDeepStrictEqual,
  notStrictEqual,
  ok,
} from 'node:assert/strict'

function normalizeExpectation(
  errorClassOrMessage: string | (new (...args: any[]) => Error) | undefined,
  message: string | undefined,
) {
  if (typeof errorClassOrMessage === 'string') {
    return { ErrorClass: Error, messageIncludes: errorClassOrMessage }
  }
  return {
    ErrorClass: errorClassOrMessage ?? Error,
    messageIncludes: message,
  }
}

function assertErrorMatch(
  error: unknown,
  ErrorClass: new (...args: any[]) => Error,
  messageIncludes: string | undefined,
  assertMessage?: string,
): asserts error is Error {
  if (!(error instanceof ErrorClass)) {
    throw new AssertionError({
      message: assertMessage ?? `Expected error to be instance of ${ErrorClass.name}`,
      actual: error,
      expected: ErrorClass,
    })
  }
  if (messageIncludes && !String(error.message).includes(messageIncludes)) {
    throw new AssertionError({
      message:
        assertMessage ?? `Expected error message to include ${JSON.stringify(messageIncludes)}`,
      actual: error.message,
      expected: messageIncludes,
    })
  }
}

export function assert(expr: unknown, msg?: string): asserts expr {
  ok(expr, msg)
}

function normalizeComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparable(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      normalizeComparable(child),
    ]),
  )
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  deepStrictEqual(normalizeComparable(actual), normalizeComparable(expected), msg)
}

export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  notDeepStrictEqual(normalizeComparable(actual), normalizeComparable(expected), msg)
}

export function assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  notStrictEqual(actual, expected, msg)
}

export function assertExists<T>(value: T, msg?: string): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new AssertionError({ message: msg ?? 'Expected value to be neither null nor undefined' })
  }
}

export function assertMatch(actual: string, expected: RegExp, msg?: string): void {
  match(actual, expected, msg)
}

export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
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

export function assertThrows<T extends Error = Error>(
  fn: () => unknown,
  errorClassOrMessage?: string | (new (...args: any[]) => T),
  message?: string,
  assertMessage?: string,
): T {
  const { ErrorClass, messageIncludes } = normalizeExpectation(errorClassOrMessage, message)
  try {
    fn()
  } catch (error) {
    assertErrorMatch(error, ErrorClass, messageIncludes, assertMessage)
    return error as T
  }
  throw new AssertionError({ message: assertMessage ?? 'Expected function to throw' })
}

export async function assertRejects<T extends Error = Error>(
  fn: () => Promise<unknown>,
  errorClassOrMessage?: string | (new (...args: any[]) => T),
  message?: string,
  assertMessage?: string,
): Promise<T> {
  const { ErrorClass, messageIncludes } = normalizeExpectation(errorClassOrMessage, message)
  try {
    await fn()
  } catch (error) {
    assertErrorMatch(error, ErrorClass, messageIncludes, assertMessage)
    return error as T
  }
  throw new AssertionError({ message: assertMessage ?? 'Expected function to reject' })
}
