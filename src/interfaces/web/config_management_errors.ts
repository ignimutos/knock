export class ConfigManagementError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | 'config_request_invalid'
      | 'config_not_found'
      | 'config_action_conflict'
      | 'config_action_failed',
    readonly category: 'validation' | 'not_found' | 'conflict' | 'internal',
  ) {
    super(message)
    this.name = 'ConfigManagementError'
  }
}

export function throwValidation(message: string): never {
  throw new ConfigManagementError(message, 400, 'config_request_invalid', 'validation')
}

export function throwNotFound(message: string): never {
  throw new ConfigManagementError(message, 404, 'config_not_found', 'not_found')
}

export function throwConflict(message: string): never {
  throw new ConfigManagementError(message, 409, 'config_action_conflict', 'conflict')
}

export function classifyConfigManagementError(error: unknown): ConfigManagementError {
  if (error instanceof ConfigManagementError) {
    return error
  }

  if (error instanceof Error) {
    return new ConfigManagementError(error.message, 500, 'config_action_failed', 'internal')
  }

  return new ConfigManagementError(String(error), 500, 'config_action_failed', 'internal')
}
