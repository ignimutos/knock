import { toPushRequestType } from './delivery_semantics.ts'

void toPushRequestType(undefined)
void toPushRequestType('body')
void toPushRequestType('query')
void toPushRequestType('form')

// @ts-expect-error 非 canonical request.type 不应通过类型检查
void toPushRequestType('unexpected')
