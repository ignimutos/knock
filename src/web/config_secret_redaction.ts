const SECRET_SENTINEL = '__KNOCK_SECRET_UNCHANGED__'

const SECRET_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /api_?key/i,
  /auth/i,
  /sig/i,
  /signature/i,
  /access_?token/i,
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isEnvPlaceholder(value: string): boolean {
  return /^\$\{[A-Z0-9_]+\}$/.test(value.trim())
}

function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

function hasUrlSecrets(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username !== '' || url.password !== '') {
      return true
    }

    return Array.from(url.searchParams.keys()).some((key) => isSecretLikeKey(key))
  } catch {
    return false
  }
}

function redactValue(value: unknown, keyPath: string[]): unknown {
  if (typeof value === 'string') {
    if (isEnvPlaceholder(value)) return value

    const key = keyPath[keyPath.length - 1] ?? ''
    if (isSecretLikeKey(key)) {
      return SECRET_SENTINEL
    }

    if ((key === 'url' || key === 'proxy') && hasUrlSecrets(value)) {
      return SECRET_SENTINEL
    }

    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, keyPath))
  }

  if (!isPlainObject(value)) {
    return value
  }

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    next[key] = redactValue(child, [...keyPath, key])
  }
  return next
}

function isProtectedPath(keyPath: string[], current: unknown): boolean {
  const key = keyPath[keyPath.length - 1] ?? ''
  if (isSecretLikeKey(key)) {
    return true
  }
  return (key === 'url' || key === 'proxy') && typeof current === 'string' && hasUrlSecrets(current)
}

function restoreValue(redacted: unknown, current: unknown, keyPath: string[]): unknown {
  if (redacted === SECRET_SENTINEL && isProtectedPath(keyPath, current)) {
    return current
  }

  if (Array.isArray(redacted)) {
    const currentArray = Array.isArray(current) ? current : []
    return redacted.map((item, index) => restoreValue(item, currentArray[index], keyPath))
  }

  if (!isPlainObject(redacted)) {
    return redacted
  }

  const currentRecord = isPlainObject(current) ? current : {}
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(redacted)) {
    next[key] = restoreValue(child, currentRecord[key], [...keyPath, key])
  }
  return next
}

export function getConfigSecretSentinel(): string {
  return SECRET_SENTINEL
}

export function redactConfigSecrets<T>(value: T): T {
  return redactValue(value, []) as T
}

export function restoreConfigSecrets<T>(redacted: T, current: unknown): T {
  return restoreValue(redacted, current, []) as T
}
