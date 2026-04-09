import { renderLiquidSync } from '../core/liquid_runtime.ts'
import { getConfigFieldCapability } from './capabilities.ts'

function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, '')
}

function usesLiquidTemplate(value: string): boolean {
  return value.includes('{{') || value.includes('{%')
}

export function assertLiquidCapability(path: string, value: string): void {
  const capability = getConfigFieldCapability(normalizePath(path))
  if (!capability || capability.allowLiquid) return
  if (!usesLiquidTemplate(value)) return

  renderLiquidSync(value, {})
  throw new Error(`${path} 不支持 Liquid 模板`)
}
