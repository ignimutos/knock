import type { RunDueSourcesCommand } from '../../application/run_due_sources_use_case.ts'

export interface StartDaemonDeps {
  runDueSourcesUseCase: {
    execute(command: RunDueSourcesCommand): Promise<unknown>
  }
  recoverInterruptedAttempts?: () => Promise<void>
}

export interface StartDaemonResult {
  mode: 'daemon'
}

export async function startDaemon(input: StartDaemonDeps): Promise<StartDaemonResult> {
  await input.recoverInterruptedAttempts?.()
  await input.runDueSourcesUseCase.execute({ trigger: 'scheduled' })
  return { mode: 'daemon' }
}
