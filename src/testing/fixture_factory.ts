export interface SourceFixture {
  id: string
  type: 'syndication'
  url: string
  enabled: boolean
  deliveries: string[]
  http: {
    method: 'GET' | 'POST'
    headers: Record<string, string>
  }
}

export function createSourceFixture(overrides: Partial<SourceFixture> = {}): SourceFixture {
  const { http: httpOverrides, ...restOverrides } = overrides

  return {
    id: 'source-default',
    type: 'syndication',
    url: 'https://example.com/feed.xml',
    enabled: true,
    deliveries: [],
    http: {
      method: 'GET',
      headers: {},
      ...(httpOverrides ?? {}),
    },
    ...restOverrides,
  }
}
