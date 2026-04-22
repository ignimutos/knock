import type { LoggingConfigResolved } from './types.ts'
import type { LoggingConfigInput } from './schema.ts'
import { resolveRuntimePath } from './runtime_semantics.ts'

export function resolveLoggingConfig(
  runtimeDir: string,
  input: LoggingConfigInput,
): LoggingConfigResolved {
  return {
    level: input.level,
    sinks: {
      ...(input.sinks.console ? { console: { ...input.sinks.console } } : {}),
      ...(input.sinks.file
        ? {
            file: {
              ...input.sinks.file,
              path: resolveRuntimePath(runtimeDir, input.sinks.file.path),
              ...(input.sinks.file.rotation ? { rotation: { ...input.sinks.file.rotation } } : {}),
            },
          }
        : {}),
    },
  }
}
