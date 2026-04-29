import {
  applyCurrentWebLoggingRuntime,
  assertWebRuntimeReady,
  loadStartWebLoggingRuntime,
  waitForWebReady,
} from '../../src/interfaces/web/start_web.ts'
import {
  runReadyCheckedWebServer,
  type StartWebOptions,
} from '../../src/interfaces/web/web_startup_runtime.ts'
import { handleCompiledWebRequest } from './compiled_web_main.tsx'

export async function startCompiledWeb(options: StartWebOptions): Promise<void> {
  const loggingRuntime = await loadStartWebLoggingRuntime()
  await runReadyCheckedWebServer(options, loggingRuntime, handleCompiledWebRequest, {
    applyRuntime: applyCurrentWebLoggingRuntime,
    assertReady: assertWebRuntimeReady,
    waitForReady: waitForWebReady,
  })
}
