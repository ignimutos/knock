export type ConfigFieldCapability = {
  path: string
  allowEnv: boolean
  allowLiquid: boolean
  postRenderValidator?: 'email-address' | 'non-empty'
}

export const CONFIG_FIELD_CAPABILITIES: ConfigFieldCapability[] = [
  {
    path: 'deliveries.*.file.path',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'deliveries.*.file.content',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'deliveries.*.push.http.url',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'deliveries.*.push.http.headers.*',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'deliveries.*.push.request.payload.**',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'deliveries.*.push.response.predicate',
    allowEnv: false,
    allowLiquid: true,
  },
  {
    path: 'deliveries.*.push.response.message',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'deliveries.*.email.smtp.host',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'deliveries.*.email.smtp.auth.username',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'deliveries.*.email.smtp.auth.password',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'deliveries.*.email.message.from',
    allowEnv: true,
    allowLiquid: true,
    postRenderValidator: 'email-address',
  },
  {
    path: 'deliveries.*.email.message.to[]',
    allowEnv: true,
    allowLiquid: true,
    postRenderValidator: 'email-address',
  },
  {
    path: 'deliveries.*.email.message.cc[]',
    allowEnv: true,
    allowLiquid: true,
    postRenderValidator: 'email-address',
  },
  {
    path: 'deliveries.*.email.message.bcc[]',
    allowEnv: true,
    allowLiquid: true,
    postRenderValidator: 'email-address',
  },
  {
    path: 'deliveries.*.email.message.replyTo[]',
    allowEnv: true,
    allowLiquid: true,
    postRenderValidator: 'email-address',
  },
  {
    path: 'deliveries.*.email.message.subject',
    allowEnv: true,
    allowLiquid: true,
    postRenderValidator: 'non-empty',
  },
  {
    path: 'deliveries.*.email.message.text',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'deliveries.*.email.message.html',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'deliveries.*.email.message.headers.*',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'sources.*.http.url',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'sources.*.http.headers.*',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'sources.*.byparr.url',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'sources.*.filter',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'sources.*.syndication.feed.*',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'sources.*.syndication.entry.*',
    allowEnv: true,
    allowLiquid: true,
  },
  {
    path: 'ai.defaultModel',
    allowEnv: false,
    allowLiquid: false,
  },
  {
    path: 'ai.providers.*.apiKey',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'ai.providers.*.baseURL',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'ai.providers.*.headers.*',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'ai.providers.*.models.*.model',
    allowEnv: false,
    allowLiquid: false,
  },
  {
    path: 'ai.providers.*.options.organization',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'ai.providers.*.options.project',
    allowEnv: true,
    allowLiquid: false,
  },
  {
    path: 'ai.providers.*.options.authToken',
    allowEnv: true,
    allowLiquid: false,
  },
]

function matchesPath(pattern: string, path: string): boolean {
  const patternParts = pattern.split('.')
  const pathParts = path.split('.')

  let patternIndex = 0
  let pathIndex = 0

  while (patternIndex < patternParts.length && pathIndex < pathParts.length) {
    const patternPart = patternParts[patternIndex]
    const pathPart = pathParts[pathIndex]

    if (patternPart === '**') return true
    if (patternPart === '*') {
      patternIndex += 1
      pathIndex += 1
      continue
    }
    if (patternPart.endsWith('[]')) {
      if (pathPart !== patternPart.slice(0, -2)) return false
      patternIndex += 1
      pathIndex += 1
      continue
    }
    if (patternPart === '*[]') {
      patternIndex += 1
      pathIndex += 1
      continue
    }
    if (patternPart !== pathPart) return false

    patternIndex += 1
    pathIndex += 1
  }

  return patternIndex === patternParts.length && pathIndex === pathParts.length
}

export function getConfigFieldCapability(path: string): ConfigFieldCapability | undefined {
  return CONFIG_FIELD_CAPABILITIES.find((capability) => matchesPath(capability.path, path))
}

export function isEnvExpansionAllowed(path: string): boolean {
  return getConfigFieldCapability(path)?.allowEnv ?? true
}

export function getPostRenderValidator(path: string): ConfigFieldCapability['postRenderValidator'] {
  return getConfigFieldCapability(path)?.postRenderValidator
}
