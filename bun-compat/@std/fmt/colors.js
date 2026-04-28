const ANSI_PATTERN = /(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

export function stripAnsiCode(value) {
  return String(value).replace(ANSI_PATTERN, '')
}
