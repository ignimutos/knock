import type { AppConfigResolved } from './types.ts'

export interface HotReloadTransition {
  kind: 'hot_reload'
}

export interface RestartRequiredTransition {
  kind: 'requires_restart'
  reason: 'sqlite'
}

export type ConfigReloadTransition = HotReloadTransition | RestartRequiredTransition

function sqliteConfigMatches(
  left: AppConfigResolved['sqlite'],
  right: AppConfigResolved['sqlite'],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function classifyReloadTransition(
  previous: Pick<AppConfigResolved, 'sqlite'>,
  next: Pick<AppConfigResolved, 'sqlite'>,
): ConfigReloadTransition {
  return sqliteConfigMatches(previous.sqlite, next.sqlite)
    ? { kind: 'hot_reload' }
    : { kind: 'requires_restart', reason: 'sqlite' }
}
