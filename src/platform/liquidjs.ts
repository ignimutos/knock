type LiquidContext = Record<string, unknown>

interface LiquidInstance {
  parse(template: string): unknown
  parseAndRender(template: string, context: LiquidContext): Promise<string>
  parseAndRenderSync(template: string, context: LiquidContext): string
  registerFilter(name: string, filter: unknown): void
}

interface LiquidConstructor {
  new (): LiquidInstance
}

interface TokenKindValue {
  Filter: number
  Quoted: number
  Number: number
}

interface LiquidjsModule {
  Liquid: LiquidConstructor
  TokenKind: TokenKindValue
}

const specifier =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'liquidjs' : 'npm:liquidjs'
const mod = (await import(specifier)) as LiquidjsModule
const LiquidBase = mod.Liquid

export class Liquid extends LiquidBase {}
export const TokenKind = mod.TokenKind
