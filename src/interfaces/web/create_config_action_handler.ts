import type { ConfigWorkbenchOverview } from '../../web/config_workbench_overview.ts'
import type { ConfigManagementError } from './config_management_errors.ts'
import { isSameOriginWriteRequest } from './same_origin_write.ts'

export interface ConfigActionSuccessResult {
  message: string
  workbench: ConfigWorkbenchOverview
}

export interface ConfigActionHandlerDeps {
  runAction?: (payload: unknown) => Promise<ConfigActionSuccessResult>
}

interface CreateConfigActionHandlerOptions {
  runAction: (payload: unknown) => Promise<ConfigActionSuccessResult>
  classifyError: (error: unknown) => ConfigManagementError
}

export function createConfigActionHandler(options: CreateConfigActionHandlerOptions) {
  return async function handler(
    request: Request,
    deps: ConfigActionHandlerDeps = {},
  ): Promise<Response> {
    const runAction = deps.runAction ?? options.runAction

    if (!isSameOriginWriteRequest(request)) {
      return Response.json(
        {
          message: 'config 写请求必须来自同源页面',
          code: 'config_action_forbidden',
          category: 'forbidden',
        },
        { status: 403 },
      )
    }

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return Response.json(
        {
          message: 'config 请求非法',
          code: 'config_request_invalid',
          category: 'validation',
        },
        { status: 400 },
      )
    }

    try {
      return Response.json(await runAction(payload))
    } catch (error) {
      const classified = options.classifyError(error)
      const message =
        classified.category === 'internal' ? '配置操作失败，请查看服务端日志。' : classified.message
      return Response.json(
        {
          message,
          code: classified.code,
          category: classified.category,
        },
        { status: classified.status },
      )
    }
  }
}
