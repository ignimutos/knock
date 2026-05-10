import { DateTime } from 'luxon'

export interface FeedParseOptions {
  timezone?: string
  timestampFormat?: string
}

export function isTemplateValue(value: string): boolean {
  return value.includes('{{') || value.includes('{%')
}

export function normalizeDefaultText(value: string): string {
  return value.trim()
}

export function normalizeDefaultDate(value: string, options: FeedParseOptions = {}): string {
  const text = value.trim()
  if (!text) return ''

  const timezone = options.timezone ?? 'UTC'
  const timestampFormat = options.timestampFormat ?? 'yyyy-MM-dd HH:mm:ss'
  const candidates = [
    DateTime.fromISO(text, { zone: timezone }),
    DateTime.fromRFC2822(text, { zone: timezone }),
    DateTime.fromHTTP(text, { zone: timezone }),
  ]
  const parsed = candidates.find((item) => item.isValid)
  if (!parsed) return text
  return parsed.setZone(timezone).toFormat(timestampFormat)
}
