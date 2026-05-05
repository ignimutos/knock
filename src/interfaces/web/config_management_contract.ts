import type { ZodError } from 'zod'

import {
  deliveryConfigDeleteSchema,
  deliveryConfigUpdateSchema,
  globalConfigUpdateSchema,
  type DeliveryConfigDeleteInput,
  type DeliveryConfigUpdateInput,
  type GlobalConfigUpdateInput,
} from '../../application/config_workbench/workbench_contract.ts'

export class ConfigManagementContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigManagementContractError'
  }
}

function throwContractValidation(message: string): never {
  throw new ConfigManagementContractError(message)
}

function classifyValidationError(error: ZodError): never {
  const issue = error.issues[0]
  throwContractValidation(issue?.message || 'config 请求非法')
}

export function parseGlobalConfigUpdate(input: unknown): GlobalConfigUpdateInput {
  const parsed = globalConfigUpdateSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}

export function parseDeliveryConfigUpdate(input: unknown): DeliveryConfigUpdateInput {
  const parsed = deliveryConfigUpdateSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}

export function parseDeliveryConfigDelete(input: unknown): DeliveryConfigDeleteInput {
  const parsed = deliveryConfigDeleteSchema.safeParse(input)
  if (!parsed.success) {
    classifyValidationError(parsed.error)
  }
  return parsed.data
}
