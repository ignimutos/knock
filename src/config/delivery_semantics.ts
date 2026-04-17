import type { PushConfig } from './schema.ts'

export function toPushRequestType(
  requestType: PushConfig['request']['type'] | undefined,
): 'body' | 'query' | 'form' {
  if (requestType === 'query' || requestType === 'form') {
    return requestType
  }

  return 'body'
}
