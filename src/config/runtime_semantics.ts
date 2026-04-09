import { isAbsolute, join } from '@std/path'
import { z } from 'zod'
import { parseWithFirstIssue } from '../zod_utils.ts'

export function resolveRuntimePath(runtimeDir: string, path: string): string {
  return isAbsolute(path) ? path : join(runtimeDir, path)
}

function createRuntimeDurationSchema(field: string, options: { allowDays?: boolean } = {}) {
  const suffix = options.allowDays ? 'ms|s|m|h|d' : 'ms|s|m|h'
  const pattern = new RegExp(`^(\\d+)(${suffix})$`)

  return z
    .string()
    .superRefine((value, ctx) => {
      if (!pattern.test(value.trim())) {
        ctx.addIssue({
          code: 'custom',
          message: `${field} 配置非法: ${value}`,
        })
      }
    })
    .transform((value) => value.trim())
}

export function parseDurationMs(value: string, field: string): number {
  const normalized = parseWithFirstIssue(
    createRuntimeDurationSchema(field, { allowDays: true }),
    value,
    `${field} 配置非法: ${value}`,
  )
  const [, amountText, unit] = normalized.match(/^(\d+)(ms|s|m|h|d)$/) ?? []
  const amount = Number(amountText)
  if (unit === 'ms') return amount
  if (unit === 's') return amount * 1000
  if (unit === 'm') return amount * 60_000
  if (unit === 'h') return amount * 3_600_000
  return amount * 86_400_000
}

export function isRuntimeDuration(value: string, options: { allowDays?: boolean } = {}): boolean {
  return createRuntimeDurationSchema('duration', options).safeParse(value).success
}
