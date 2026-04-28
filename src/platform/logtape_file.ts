import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('@logtape/file') as typeof import('@logtape/file')

export const getFileSink = mod.getFileSink
export const getRotatingFileSink = mod.getRotatingFileSink
export const getTimeRotatingFileSink = mod.getTimeRotatingFileSink
