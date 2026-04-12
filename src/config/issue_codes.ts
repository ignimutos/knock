export const ISSUE_REQUIRED = '__required__'
export const ISSUE_BOOLEAN = '__boolean__'
export const ISSUE_INTEGER = '__integer__'
export const ISSUE_INVALID = '__invalid__'
export const ISSUE_STRING_ARRAY = '__string_array__'
export const ISSUE_OBJECT = '__object__'
export const ISSUE_ILLEGAL = '__illegal__'
export const ISSUE_BODY_PAYLOAD_FORBIDDEN = '__body_payload_forbidden__'
export const ISSUE_DEPRECATED_DELIVERY_HTTP = '__deprecated_delivery_http__'
export const ISSUE_SOURCE_PUSH_FORBIDDEN = '__source_push_forbidden__'
export const ISSUE_SOURCE_PARSER_CONFLICT = '__source_parser_conflict__'
export const ISSUE_SOURCE_TRANSPORT_CONFLICT = '__source_transport_conflict__'
export const ISSUE_SOURCE_TRANSPORT_REQUIRED = '__source_transport_required__'
export const ISSUE_EMAIL_MESSAGE_CONTENT_REQUIRED = '__email_message_content_required__'
export const ISSUE_ENV_EXPANSION_FORBIDDEN = '__env_expansion_forbidden__'

export function createInvalidIssueMessage(value: unknown): string {
  return `${ISSUE_INVALID}:${String(value)}`
}

export function parseInvalidIssueMessage(message: string): string | undefined {
  if (!message.startsWith(`${ISSUE_INVALID}:`)) return undefined
  return message.slice(ISSUE_INVALID.length + 1)
}
