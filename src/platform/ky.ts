import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('ky') as typeof import('ky')

export default mod.default
export type KyInput = import('ky').Input
export type KyOptions = import('ky').Options
