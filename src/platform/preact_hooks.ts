type SetStateAction<S> = S | ((previousState: S) => S)

type StateUpdater<S> = (value: SetStateAction<S>) => void

type UseState = <S>(initialState: S | (() => S)) => [S, StateUpdater<S>]
type UseMemo = <T>(factory: () => T, dependencies: readonly unknown[]) => T

interface PreactHooksModule {
  useState: UseState
  useMemo: UseMemo
}

const specifier =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'preact/hooks' : 'npm:preact/hooks'
const mod = (await import(specifier)) as PreactHooksModule

export const useMemo = mod.useMemo
export const useState = mod.useState
