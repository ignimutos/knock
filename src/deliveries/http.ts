import { z } from 'zod'
import type { Logger } from '../core/logger.ts'
import { renderLiquid } from '../core/liquid_runtime.ts'
import type { HttpClient } from '../core/http_client.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import type {
  HttpPayload,
  HttpRequestType,
  PushHttpConfig,
  PushRequestConfig,
  PushResponseConfig,
} from '../config/schema.ts'

export interface HttpDeliveryRequest {
  deliveryId: string
  http: PushHttpConfig
  request: PushRequestConfig
  response?: PushResponseConfig
}

export interface HttpDeliveryFactoryOptions {
  logger?: Logger
  httpClient: HttpClient
}

export interface HttpDelivery {
  push(req: HttpDeliveryRequest): Promise<void>
}

const queryPayloadSchema = z.union([z.string(), z.record(z.string(), z.unknown())])
const formPayloadSchema = z.record(z.string(), z.unknown())

function buildQueryString(payload: HttpPayload | undefined): string {
  if (payload === undefined) return ''

  const parsed = parseWithFirstIssue(
    queryPayloadSchema,
    payload,
    'HTTP query payload 必须是对象或字符串',
  )
  if (typeof parsed === 'string') return parsed

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(parsed)) {
    params.append(key, value === null ? '' : String(value))
  }
  return params.toString()
}

function stringifyFormValue(value: unknown): string {
  if (value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function buildBody(type: HttpRequestType, payload: HttpPayload | undefined): BodyInit | undefined {
  if (payload === undefined) return undefined
  if (type === 'query') return undefined
  if (type === 'form') {
    const parsed = parseWithFirstIssue(formPayloadSchema, payload, 'HTTP form payload 必须是对象')
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(parsed)) {
      params.append(key, stringifyFormValue(value))
    }
    return params.toString()
  }
  if (typeof payload === 'string') return payload
  return JSON.stringify(payload)
}

function buildRequestInit(req: HttpDeliveryRequest): { url: string; init: RequestInit } {
  const headers = new Headers(req.http.headers ?? {})

  let url = req.http.url
  if (req.request.type === 'query') {
    const query = buildQueryString(req.request.payload)
    if (query) {
      url = `${url}${url.includes('?') ? '&' : '?'}${query}`
    }
  }

  const body = buildBody(req.request.type, req.request.payload)
  if (req.request.type === 'form' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
  }
  if (req.request.type === 'body' && body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return {
    url,
    init: {
      method: req.http.method,
      headers,
      body,
    },
  }
}

async function normalizeResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('Content-Type') ?? ''
  const bodyText = await response.text()
  let body: unknown = bodyText
  if (contentType.includes('application/json') && bodyText) {
    body = JSON.parse(bodyText)
  }

  return {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}

export function createHttpDelivery(options: HttpDeliveryFactoryOptions): HttpDelivery {
  return {
    async push(req: HttpDeliveryRequest): Promise<void> {
      const { url, init } = buildRequestInit(req)

      options.logger?.info('HTTP 推送开始', {
        operation: 'push',
        outcome: 'start',
        delivery_id: req.deliveryId,
      })

      const response = await options.httpClient.request({
        transport: req.http,
        request: url,
        init,
      })
      const normalized = await normalizeResponse(response)
      const responseContext = normalized as Record<string, unknown>
      const predicate = req.response?.predicate
      const messageTemplate = req.response?.message
      const passed = predicate
        ? (await renderLiquid(predicate, responseContext)).trim() === 'true'
        : response.ok
      const message = messageTemplate
        ? await renderLiquid(messageTemplate, responseContext)
        : `HTTP 推送失败: status=${response.status}`

      if (!passed) {
        options.logger?.error('HTTP 推送失败', {
          operation: 'push',
          outcome: 'failure',
          delivery_id: req.deliveryId,
          http_status: response.status,
          response_body:
            typeof normalized.body === 'string' ? normalized.body : JSON.stringify(normalized.body),
          error_name: 'HttpDeliveryError',
          error_message: message,
        })
        throw new Error(message)
      }

      options.logger?.info('HTTP 推送成功', {
        operation: 'push',
        outcome: 'success',
        delivery_id: req.deliveryId,
        http_status: response.status,
      })
    },
  }
}
