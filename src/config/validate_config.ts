import { z } from 'zod'
import {
  ISSUE_BODY_PAYLOAD_FORBIDDEN,
  ISSUE_BOOLEAN,
  ISSUE_ILLEGAL,
  ISSUE_INTEGER,
  ISSUE_OBJECT,
  ISSUE_REQUIRED,
  ISSUE_SOURCE_PARSER_CONFLICT,
  ISSUE_SOURCE_PUSH_FORBIDDEN,
  ISSUE_SOURCE_TRANSPORT_CONFLICT,
  ISSUE_SOURCE_TRANSPORT_REQUIRED,
  ISSUE_STRING_ARRAY,
  ISSUE_EMAIL_MESSAGE_CONTENT_REQUIRED,
  ISSUE_ENV_EXPANSION_FORBIDDEN,
  parseInvalidIssueMessage,
} from './issue_codes.ts'
import { appConfigValidatedSchema } from './schema.ts'
import type { AppConfigValidated } from './schema.ts'

function mapExternalPath(path: ReadonlyArray<PropertyKey>): PropertyKey[] {
  if (path[0] === 'deliveries' && typeof path[1] === 'string') {
    return ['delivery', path[1], ...path.slice(2)]
  }
  if (path[0] === 'sources' && typeof path[1] === 'string') {
    return ['source', path[1], ...path.slice(2)]
  }
  return [...path]
}

function joinPath(path: ReadonlyArray<PropertyKey>): string {
  let resolved = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      resolved += `[${segment}]`
      continue
    }
    const key = typeof segment === 'symbol' ? String(segment) : segment
    resolved = resolved ? `${resolved}.${key}` : key
  }
  return resolved
}

function formatIssuePath(issue: z.ZodIssue): string {
  const path = mapExternalPath(issue.path)
  const issueWithKeys = issue as z.ZodIssue & { keys?: unknown }
  if (Array.isArray(issueWithKeys.keys) && issueWithKeys.keys.length > 0) {
    return joinPath([...path, issueWithKeys.keys[0] as string])
  }

  return joinPath(path)
}

function isZodDefaultMessage(message: string): boolean {
  return /^Invalid input/i.test(message) || /^Unrecognized key/i.test(message)
}

function formatCustomIssue(issue: z.ZodIssue): string | undefined {
  const path = formatIssuePath(issue)
  const message = issue.message

  if (message === ISSUE_REQUIRED && path) return `${path} 必填`
  if (message === ISSUE_BOOLEAN && path) return `${path} 必须是布尔值`
  if (message === ISSUE_INTEGER && path) return `${path} 必须是整数`
  if (message === ISSUE_STRING_ARRAY && path) return `${path} 必须是字符串数组`
  if (message === ISSUE_OBJECT && path) return `${path} 必须是对象`
  if (message === ISSUE_ILLEGAL && path) return `${path} 非法`
  const invalidMessage = parseInvalidIssueMessage(message)
  if (invalidMessage !== undefined && path) {
    return `${path} 配置非法: ${invalidMessage}`
  }
  if (message === ISSUE_BODY_PAYLOAD_FORBIDDEN && path) {
    return `${path} 配置非法: GET/HEAD 请求不允许 body payload`
  }
  if (message === ISSUE_SOURCE_PUSH_FORBIDDEN && path) {
    return `${path} 不允许配置 push`
  }
  if (message === ISSUE_SOURCE_PARSER_CONFLICT && path) {
    return `${path} 不能同时配置 syndication 与 xquery`
  }
  if (message === ISSUE_SOURCE_TRANSPORT_CONFLICT && path) {
    return `${path} 不能同时配置 http 与 byparr`
  }
  if (message === ISSUE_SOURCE_TRANSPORT_REQUIRED && path) {
    return `${path} 必须配置 http 或 byparr`
  }
  if (message === ISSUE_EMAIL_MESSAGE_CONTENT_REQUIRED && path) {
    return `${path} 必须至少配置 text 或 html`
  }
  if (message === ISSUE_ENV_EXPANSION_FORBIDDEN && path) {
    return `${path} 不支持环境变量展开`
  }

  return undefined
}

function parseWithMessage<T>(schema: z.ZodType<T>, value: unknown, fallback: string): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  const issue = result.error.issues[0]
  if (!issue) throw new Error(fallback)

  const customMessage = formatCustomIssue(issue)
  if (customMessage) throw new Error(customMessage)

  const message = issue.message || fallback
  if (!isZodDefaultMessage(message)) {
    throw new Error(message)
  }

  const issuePath = formatIssuePath(issue)
  if (issuePath) {
    throw new Error(`${issuePath} 配置非法: ${message}`)
  }

  throw new Error(`${fallback}: ${message}`)
}

export function validateConfig(input: unknown): AppConfigValidated {
  return parseWithMessage(appConfigValidatedSchema, input, '配置非法')
}
