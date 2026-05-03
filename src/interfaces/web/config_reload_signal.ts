export type ConfigReloadTrigger = 'watcher' | 'web_save'

let reloadRequester: ((trigger: ConfigReloadTrigger) => Promise<void>) | undefined

export function setConfigReloadRequester(
  next: ((trigger: ConfigReloadTrigger) => Promise<void>) | undefined,
): void {
  reloadRequester = next
}

export async function requestConfigReload(trigger: ConfigReloadTrigger): Promise<void> {
  await reloadRequester?.(trigger)
}
