import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('@logtape/redaction') as typeof import('@logtape/redaction')

export const redactByField = mod.redactByField
export const redactByPattern = mod.redactByPattern
