import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('croner') as typeof import('croner')

export const Cron = mod.Cron
export const CronPattern = mod.CronPattern
