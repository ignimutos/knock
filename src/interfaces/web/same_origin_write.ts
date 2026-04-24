function parseOrigin(value: string | null): string | undefined {
  if (!value) return undefined

  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

export function isSameOriginWriteRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin
  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase()

  if (secFetchSite && secFetchSite !== 'same-origin') {
    return false
  }

  const origin = parseOrigin(request.headers.get('origin'))
  if (origin) {
    return origin === requestOrigin
  }

  const referer = parseOrigin(request.headers.get('referer'))
  if (referer) {
    return referer === requestOrigin
  }

  return secFetchSite === 'same-origin'
}
