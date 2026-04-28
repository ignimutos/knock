interface LuxonDateTime {
  isValid: boolean
  setZone(zone: string): LuxonDateTime
  toFormat(format: string): string
}

interface LuxonDateTimeStatic {
  fromJSDate(input: Date, options: { zone: string }): LuxonDateTime
  fromISO(input: string, options: { zone: string }): LuxonDateTime
  fromRFC2822(input: string, options: { zone: string }): LuxonDateTime
  fromHTTP(input: string, options: { zone: string }): LuxonDateTime
}

interface LuxonModule {
  DateTime: LuxonDateTimeStatic
}

const specifier =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'luxon' : 'npm:luxon'
const mod = (await import(specifier)) as LuxonModule

export const DateTime = mod.DateTime
