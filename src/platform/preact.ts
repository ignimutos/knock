interface PreactModule {
  hydrate: (vnode: unknown, parent: Element | Document | ShadowRoot | DocumentFragment) => unknown
}

const specifier =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'preact' : 'npm:preact'
const mod = (await import(specifier)) as PreactModule

export const hydrate = mod.hydrate
