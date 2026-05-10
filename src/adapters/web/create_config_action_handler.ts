import type { ConfigWorkbenchOverview } from '../../contracts/workbench.ts'
import type { ConfigManagementError } from '../../contracts/errors.ts'
import { executeWebAction } from './web_action_executor.ts'

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
    return executeWebAction(request, {
      requireSameOrigin: true,
      run: deps.runAction ?? options.runAction,
      classifyError: (error) => {
        const classified = options.classifyError(error)
        return {
          ...classified,
          message:
            classified.category === 'internal'
              ? '配置操作失败，请查看服务端日志。'
              : classified.message,
        }
      },
      forbidden: {
        message: 'config 写请求必须来自同源页面',
        code: 'config_action_forbidden',
        category: 'forbidden',
      },
      invalidJson: {
        message: 'config 请求非法',
        code: 'config_request_invalid',
        category: 'validation',
      },
    })
  }
}
