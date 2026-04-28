type RenderToString = (vnode: unknown, context?: unknown, isStaticMarkup?: boolean) => string

interface PreactRenderToStringModule {
  default: RenderToString
}

const specifier =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
    ? 'preact-render-to-string'
    : 'npm:preact-render-to-string'
const mod = (await import(specifier)) as PreactRenderToStringModule

export default mod.default
