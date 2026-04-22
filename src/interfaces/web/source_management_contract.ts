import { z } from 'zod'
import { httpPayloadSchema } from '../../config/schema.ts'
import type { SourceDeliveryOverride } from '../../config/types.ts'

const requiredStringSchema = z.string().trim().min(1)

const sourceDeliveryOverrideSchema: z.ZodType<SourceDeliveryOverride> = z.lazy(() =>
  z.union([
    z.object({ content: z.string().optional() }).strict(),
    z.object({ payload: httpPayloadSchema.optional() }).strict(),
    z.object({ message: z.record(z.string(), z.unknown()).optional() }).strict(),
  ]),
)

const sourceConfigUpdateSchema = z
  .object({
    sourceId: requiredStringSchema,
    name: z.string().default(''),
    enabled: z.boolean(),
    schedule: z.string().default(''),
    filter: z.string().default(''),
    deliveryIds: z.array(z.string()).default([]),
    deliveryOverrides: z.record(z.string(), sourceDeliveryOverrideSchema).default({}),
    transport: z.enum(['http', 'byparr', 'summary']),
    parser: z.enum(['syndication', 'xquery', 'summary']),
    targetUrl: z.string().default(''),
    xqueryLocate: z.string().default(''),
    xqueryEntryId: z.string().default(''),
  })
  .strict()

const sourceActionSchema = z
  .object({
    sourceId: requiredStringSchema,
  })
  .strict()

export class SourceManagementContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceManagementContractError'
  }
}

function throwContractValidation(message: string): never {
  throw new SourceManagementContractError(message)
}

function classifyValidationError(error: z.ZodError): never {
  const issue = error.issues[0]
  throwContractValidation(issue?.message || 'source 请求非法')
}

export function parseSourceConfigUpdate(input: unknown) {
  const parsed = sourceConfigUpdateSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}

export function parseSourceAction(input: unknown) {
  const parsed = sourceActionSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}
