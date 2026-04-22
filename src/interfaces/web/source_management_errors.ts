export class SourceManagementError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | 'source_request_invalid'
      | 'source_not_found'
      | 'source_action_conflict'
      | 'source_action_failed',
    readonly category: 'validation' | 'not_found' | 'conflict' | 'internal',
  ) {
    super(message)
    this.name = 'SourceManagementError'
  }
}

export function throwValidation(message: string): never {
  throw new SourceManagementError(message, 400, 'source_request_invalid', 'validation')
}

export function throwNotFound(message: string): never {
  throw new SourceManagementError(message, 404, 'source_not_found', 'not_found')
}

export function throwConflict(message: string): never {
  throw new SourceManagementError(message, 409, 'source_action_conflict', 'conflict')
}

export function classifySourceManagementError(error: unknown): SourceManagementError {
  if (error instanceof SourceManagementError) {
    return error
  }

  if (error instanceof Error) {
    return new SourceManagementError(error.message, 500, 'source_action_failed', 'internal')
  }

  return new SourceManagementError(String(error), 500, 'source_action_failed', 'internal')
}
