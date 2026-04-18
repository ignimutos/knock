import {
  createProductionRuntime,
  type CreateProductionRuntimeOptions,
  type ProductionRuntime,
} from '../../composition/create_production_runtime.ts'

export type CreateDaemonRuntimeOptions = CreateProductionRuntimeOptions

export type DaemonRuntime = ProductionRuntime

export function createDaemonRuntime(options: CreateDaemonRuntimeOptions): DaemonRuntime {
  return createProductionRuntime(options)
}
