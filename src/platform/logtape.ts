import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('@logtape/logtape') as typeof import('@logtape/logtape')

export const configure = mod.configure
export const dispose = mod.dispose
export const getConsoleSink = mod.getConsoleSink
export const getLogger = mod.getLogger

export type LogRecord = import('@logtape/logtape').LogRecord
export type Logger = import('@logtape/logtape').Logger
export type Sink = import('@logtape/logtape').Sink
export type TextFormatter = import('@logtape/logtape').TextFormatter
