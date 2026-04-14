export interface ScenarioHooks<TArrange, TResult> {
  arrange?: () => Promise<TArrange> | TArrange
  act: (ctx: { arranged: TArrange }) => Promise<TResult> | TResult
  assert?: (ctx: { arranged: TArrange; result: TResult }) => Promise<void> | void
  cleanup?: (ctx: { arranged: TArrange; result?: TResult }) => Promise<void> | void
}

export async function runScenario<TArrange = void, TResult = void>(
  hooks: ScenarioHooks<TArrange, TResult>,
): Promise<TResult> {
  const arranged = (hooks.arrange ? await hooks.arrange() : (undefined as TArrange)) as TArrange

  let result: TResult | undefined
  try {
    result = await hooks.act({ arranged })
    if (hooks.assert) {
      await hooks.assert({ arranged, result })
    }
    return result
  } finally {
    if (hooks.cleanup) {
      await hooks.cleanup({ arranged, result })
    }
  }
}
