export interface StartDaemonDeps {
  runDueSourcesUseCase: {
    execute(): Promise<unknown>
  }
  recoverInterruptedAttempts?: () => Promise<void>
}

export interface StartDaemonResult {
  mode: 'daemon'
}

export async function startDaemon(input: StartDaemonDeps): Promise<StartDaemonResult> {
  await input.recoverInterruptedAttempts?.()
  await input.runDueSourcesUseCase.execute()
  return { mode: 'daemon' }
}
