import { Cron } from 'croner'
import { z } from 'zod'
import { loadConfig } from '../config/load_config.ts'
import { createDbClient } from '../db/client.ts'
import { createSourceStateStore } from '../db/source_state_store.ts'
import { createDeliveryRuntime } from '../deliveries/delivery_runtime.ts'
import { createEmailDelivery } from '../deliveries/email.ts'
import { createFileDelivery } from '../deliveries/file.ts'
import { createHttpDelivery } from '../deliveries/http.ts'
import { fetchAndParseSource } from '../sources/source_runtime.ts'
import { createAiRuntime } from './ai_runtime.ts'
import { createContentRuntime } from './content_runtime.ts'
import { createHttpClient } from './http_client.ts'
import { createLogger } from './logger.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import { createScheduler } from './scheduler.ts'
import { createSourceProcessor } from './source_processor.ts'
import nodemailer from 'nodemailer'

export interface StartAppOptions {
  runtimeDir?: string
  configPath?: string
  httpFetcher?: typeof fetch
  httpProxyClientFactory?: typeof Deno.createHttpClient
  emailTransportFactory?: typeof nodemailer.createTransport
  keepAlive?: boolean
  keepAliveSignal?: Promise<void>
  immediate?: boolean
}

interface StartAppInput {
  runtimeDir?: string
  configPath?: string
  httpFetcher: typeof fetch
  httpProxyClientFactory: typeof Deno.createHttpClient
  emailTransportFactory?: typeof nodemailer.createTransport
  keepAlive: boolean
  keepAliveSignal?: Promise<void>
  immediate: boolean
}

interface StartAppResult {
  mode: 'daemon'
}

const startAppOptionsSchema = z.object({
  runtimeDir: z.string({ message: 'runtimeDir 必须是字符串' }).optional(),
  configPath: z.string({ message: 'configPath 必须是字符串' }).optional(),
  httpFetcher: z.custom<typeof fetch>(
    (value) => value === undefined || typeof value === 'function',
    {
      message: 'httpFetcher 必须是函数',
    },
  ),
  httpProxyClientFactory: z.custom<typeof Deno.createHttpClient>(
    (value) => value === undefined || typeof value === 'function',
    { message: 'httpProxyClientFactory 必须是函数' },
  ),
  emailTransportFactory: z.custom<typeof nodemailer.createTransport>(
    (value) => value === undefined || typeof value === 'function',
    { message: 'emailTransportFactory 必须是函数' },
  ),
  keepAlive: z.boolean({ message: 'keepAlive 必须是布尔值' }).optional(),
  keepAliveSignal: z.custom<Promise<void>>(
    (value) => value === undefined || value instanceof Promise,
    { message: 'keepAliveSignal 必须是 Promise' },
  ),
  immediate: z.boolean({ message: 'immediate 必须是布尔值' }).optional(),
})

function normalizeStartAppInput(options: StartAppOptions = {}): StartAppInput {
  const parsed = parseWithFirstIssue(startAppOptionsSchema, options, 'startApp 参数非法')

  return {
    runtimeDir: parsed.runtimeDir,
    configPath: parsed.configPath,
    httpFetcher: parsed.httpFetcher ?? fetch,
    httpProxyClientFactory: parsed.httpProxyClientFactory ?? Deno.createHttpClient,
    emailTransportFactory: parsed.emailTransportFactory,
    keepAlive: parsed.keepAlive ?? true,
    keepAliveSignal: parsed.keepAliveSignal,
    immediate: parsed.immediate ?? false,
  }
}

/**
 * 启动应用并返回 daemon 模式结果。
 * `schedule` 是 source 唯一调度事实源；当 `keepAlive=true` 时会保持进程常驻。
 */
export async function startApp(options: StartAppOptions = {}): Promise<StartAppResult> {
  const input = normalizeStartAppInput(options)
  const httpFetcher = input.httpFetcher
  const httpProxyClientFactory = input.httpProxyClientFactory
  const emailTransportFactory = input.emailTransportFactory
  const httpClient = createHttpClient({
    fetcher: httpFetcher,
    proxyClientFactory: httpProxyClientFactory,
  })
  const shouldKeepAlive = input.keepAlive
  const keepAliveSignal = input.keepAliveSignal
  const shouldRunImmediate = input.immediate
  const config = await loadConfig({
    runtimeDir: input.runtimeDir,
    configPath: input.configPath,
  })

  const logger = createLogger({
    enabled: config.logging.sinks.console?.type === 'console',
    level: config.logging.level,
    format: config.logging.format,
    module: 'app.startup',
    component: 'daemon',
    timezone: config.timezone,
    timestampFormat: config.timestampFormat,
    baseFields: {
      runtime_dir: config.runtimeDir,
    },
  })

  const aiRuntime = createAiRuntime({
    ai: config.ai,
    defaultLanguage: config.language,
    logger: logger.child({ module: 'core.ai.runtime' }),
  })
  const contentRuntime = createContentRuntime({
    aiRuntime,
    logger: logger.child({ module: 'content.render' }),
  })
  const db = createDbClient({
    sqlite: config.sqlite,
    logger: logger.child({ module: 'db.sqlite' }),
  })
  const sourceStateStore = createSourceStateStore({
    db,
    sqlite: config.sqlite,
    logger: logger.child({ module: 'db.sqlite' }),
  })
  const scheduler = createScheduler(logger.child({ module: 'scheduler.source' }))
  const fileDelivery = createFileDelivery({
    runtimeDir: config.runtimeDir,
    logger: logger.child({ module: 'delivery.file' }),
  })
  const httpDelivery = createHttpDelivery({
    logger: logger.child({ module: 'delivery.http' }),
    httpClient,
    renderContent: (template, context) => contentRuntime.renderContent(template, context),
  })
  const emailDelivery = createEmailDelivery({
    logger: logger.child({ module: 'delivery.email' }),
    createTransport: emailTransportFactory,
  })
  const deliveryRuntime = createDeliveryRuntime({
    contentRuntime,
    fileDelivery,
    httpDelivery,
    emailDelivery,
  })
  const sourceProcessor = createSourceProcessor({
    logger,
    scheduler,
    sourceRuntime: {
      fetchAndParse: (source) =>
        fetchAndParseSource({
          source,
          httpClient,
          timeOptions: {
            timezone: config.timezone,
            timestampFormat: config.timestampFormat,
          },
          aiRuntime,
        }),
    },
    contentRuntime,
    deliveryRuntime,
    sourceStateStore,
    aiRuntime,
  })

  const enabledSources = config.sources.filter((source) => source.enabled)
  const scheduledSources = enabledSources.filter((source) => !!source.schedule)

  logger.info('启动完成', {
    module: 'app.startup',
    operation: 'startup',
    outcome: 'success',
    source_count: config.sources.length,
    enabled_source_count: enabledSources.length,
    disabled_source_count: config.sources.length - enabledSources.length,
    delivery_count: config.deliveries.length,
    scheduled_source_count: scheduledSources.length,
  })

  if (shouldRunImmediate) {
    for (const source of enabledSources) {
      await sourceProcessor.runOnce(source)
    }
    return { mode: 'daemon' }
  }

  const scheduledJobs: Cron[] = []

  for (const source of config.sources) {
    if (!source.enabled) {
      logger.info('source 已禁用，跳过执行', {
        module: 'scheduler.source',
        operation: 'run_source',
        outcome: 'skipped',
        'source.id': source.id,
        reason: 'source_disabled',
      })
      continue
    }

    if (!source.schedule) continue

    logger.info('注册调度任务', {
      module: 'scheduler.source',
      operation: 'register_schedule',
      outcome: 'success',
      'source.id': source.id,
      schedule: source.schedule,
    })

    scheduledJobs.push(
      new Cron(source.schedule, { protect: true }, () => {
        void sourceProcessor.runOnce(source).catch(() => {})
      }),
    )
  }

  const hasScheduledSources = scheduledSources.length > 0

  logger.info('进入长期运行模式', {
    module: 'app.startup',
    operation: 'enter_daemon',
    outcome: 'success',
    has_schedule: hasScheduledSources,
  })

  if (shouldKeepAlive) {
    if (!hasScheduledSources && keepAliveSignal === undefined) {
      setInterval(() => {}, 2_147_483_647)
      logger.info('无调度任务，启用空闲保活定时器', {
        module: 'app.startup',
        operation: 'keepalive_idle_timer',
        outcome: 'enabled',
      })
    }
    await (keepAliveSignal ?? new Promise(() => {}))
  }

  if (!shouldKeepAlive || keepAliveSignal !== undefined) {
    for (const job of scheduledJobs) {
      job.stop()
    }
  }

  return { mode: 'daemon' }
}
