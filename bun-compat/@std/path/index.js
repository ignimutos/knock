import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

function fromFileUrl(url) {
  return fileURLToPath(url)
}

export { basename, dirname, extname, fromFileUrl, isAbsolute, join, normalize, relative, resolve }
