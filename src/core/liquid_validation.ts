import { Liquid } from 'liquidjs'

const validationEngine = new Liquid()

function usesLiquidTemplate(value: string): boolean {
  return value.includes('{{') || value.includes('{%')
}

export function assertLiquidTemplateSyntax(template: string) {
  return validationEngine.parse(template)
}

export function validateLiquidTemplateIfUsed(value: string): void {
  if (!usesLiquidTemplate(value)) return
  validationEngine.parseAndRenderSync(value, {})
}
