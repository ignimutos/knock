import { z } from 'zod'

function isZodDefaultMessage(message: string): boolean {
  return /^Invalid input/i.test(message) || /^Unrecognized key/i.test(message)
}

export function parseWithFirstIssue<T>(schema: z.ZodType<T>, value: unknown, fallback: string): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  const issue = result.error.issues[0]
  const message = issue?.message
  throw new Error(!message || isZodDefaultMessage(message) ? fallback : message)
}
