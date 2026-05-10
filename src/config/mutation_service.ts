import { writeConfigRuntimeContext, type ConfigRuntimeContext } from './runtime_config_context.ts'
import { ConfigDocumentUpdateError } from './update_config_document.ts'
import {
  applyGlobalDocumentMutation,
  deleteCanonicalDeliveryDocumentMutation,
  upsertCanonicalDeliveryDocumentMutation,
} from './document_mutator.ts'
import {
  parseDeliveryConfigDelete,
  parseDeliveryConfigUpdate,
  parseGlobalConfigUpdate,
  ConfigManagementContractError,
} from './mutation_contract.ts'
import type {
  ConfigWorkbenchOverview,
  DeliveryConfigDeleteInput,
  DeliveryConfigUpdateInput,
  GlobalConfigUpdateInput,
} from '../contracts/workbench.ts'
import {
  classifyConfigManagementError,
  throwConflict,
  throwNotFound,
  throwValidation,
} from '../contracts/errors.ts'
import { deliverySchema, loggingSchema, sqliteSchema, aiSchema } from './schema.ts'
import { restoreConfigSecrets } from '../web/config_secret_redaction.ts'
import { buildWorkbenchOverviewFromSession, loadRuntimeSession } from './runtime_session.ts'
import { requestConfigReload } from './config_reload_signal.ts'

export { classifyConfigManagementError, ConfigManagementError } from '../contracts/errors.ts'

function parseOptionalJsonObject(
  input: string,
  fieldName: string,
): Record<string, unknown> | undefined {
  if (input.trim() === '') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throwValidation(`${fieldName} 必须是合法 JSON: ${reason}`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throwValidation(`${fieldName} 必须是对象`)
  }

  return parsed as Record<string, unknown>
}

function assertWithSchema(
  schema: {
    safeParse: (
      input: unknown,
    ) => { success: true } | { success: false; error: { issues: Array<{ message: string }> } }
  },
  value: unknown,
  messagePrefix: string,
): void {
  const parsed = schema.safeParse(value)
  if (parsed.success) return
  throwValidation(`${messagePrefix}: ${parsed.error.issues[0]?.message || '配置非法'}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? structuredClone(value) : {}
}

function trimOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function splitLines(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const next = value.map((item) => item.trim()).filter((item) => item !== '')
  return next.length > 0 ? next : undefined
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      next[key] = child
    }
  }
  return next as T
}

function buildStructuredSqlite(
  request: GlobalConfigUpdateInput,
  current: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const next = cloneRecord(current)
  const hasStructuredFields = [
    request.sqlitePath,
    request.sqliteBusyTimeout,
    request.sqliteJournalMode,
    request.sqliteRetentionMaxAge,
    request.sqliteRetentionMaxEntriesPerSource,
    request.sqliteRetentionVacuum,
  ].some((value) => value !== undefined)

  if (!hasStructuredFields) return undefined

  if (request.sqlitePath !== undefined) next.path = request.sqlitePath.trim()
  if (request.sqliteBusyTimeout !== undefined) next.busyTimeout = request.sqliteBusyTimeout.trim()
  if (request.sqliteJournalMode !== undefined) next.journalMode = request.sqliteJournalMode

  const retention = cloneRecord(next.retention)
  if (request.sqliteRetentionMaxAge !== undefined)
    retention.maxAge = request.sqliteRetentionMaxAge.trim()
  if (request.sqliteRetentionMaxEntriesPerSource !== undefined) {
    retention.maxEntriesPerSource = request.sqliteRetentionMaxEntriesPerSource
  }
  if (request.sqliteRetentionVacuum !== undefined) retention.vacuum = request.sqliteRetentionVacuum
  if (Object.keys(retention).length > 0) next.retention = retention

  return next
}

function buildStructuredLogging(
  request: GlobalConfigUpdateInput,
  current: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const next = cloneRecord(current)
  const hasStructuredFields = [
    request.loggingLevel,
    request.loggingConsoleEnabled,
    request.loggingConsoleFormat,
    request.loggingFileEnabled,
    request.loggingFilePath,
    request.loggingFileRotationType,
    request.loggingFileRotationMaxSize,
    request.loggingFileRotationMaxFiles,
    request.loggingFileRotationInterval,
    request.loggingFileRotationMaxAge,
  ].some((value) => value !== undefined)

  if (!hasStructuredFields) return undefined

  if (request.loggingLevel !== undefined) next.level = request.loggingLevel

  const sinks = cloneRecord(next.sinks)
  if (request.loggingConsoleEnabled !== undefined || request.loggingConsoleFormat !== undefined) {
    if (request.loggingConsoleEnabled === false) {
      delete sinks.console
    } else {
      const consoleSink = pruneUndefined({
        ...cloneRecord(sinks.console),
        type: 'console',
        format: request.loggingConsoleFormat ?? cloneRecord(sinks.console).format,
      })
      sinks.console = consoleSink
    }
  }

  if (
    request.loggingFileEnabled !== undefined ||
    request.loggingFilePath !== undefined ||
    request.loggingFileRotationType !== undefined ||
    request.loggingFileRotationMaxSize !== undefined ||
    request.loggingFileRotationMaxFiles !== undefined ||
    request.loggingFileRotationInterval !== undefined ||
    request.loggingFileRotationMaxAge !== undefined
  ) {
    if (request.loggingFileEnabled === false) {
      delete sinks.file
    } else {
      const currentFile = cloneRecord(sinks.file)
      const rotation = cloneRecord(currentFile.rotation)
      if (request.loggingFileRotationType !== undefined)
        rotation.type = request.loggingFileRotationType
      if (request.loggingFileRotationMaxSize !== undefined) {
        rotation.maxSize = request.loggingFileRotationMaxSize.trim()
      }
      if (request.loggingFileRotationMaxFiles !== undefined) {
        rotation.maxFiles = request.loggingFileRotationMaxFiles
      }
      if (request.loggingFileRotationInterval !== undefined) {
        rotation.interval = request.loggingFileRotationInterval
      }
      if (request.loggingFileRotationMaxAge !== undefined) {
        rotation.maxAge = request.loggingFileRotationMaxAge.trim()
      }
      if (request.loggingFileRotationType === undefined && Object.keys(rotation).length === 0) {
        delete currentFile.rotation
      } else if (Object.keys(rotation).length > 0) {
        currentFile.rotation = rotation
      }

      const nextFile = pruneUndefined({
        ...currentFile,
        type: 'file',
        format: 'jsonl',
        path: request.loggingFilePath?.trim() ?? currentFile.path,
      })
      sinks.file = nextFile
    }
  }

  if (Object.keys(sinks).length > 0) next.sinks = sinks
  else delete next.sinks

  return next
}

function buildStructuredAi(
  request: GlobalConfigUpdateInput,
  current: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const hasStructuredFields =
    request.aiDefaultModel !== undefined || request.aiProviders !== undefined
  if (!hasStructuredFields) return undefined

  return pruneUndefined({
    ...cloneRecord(current),
    defaultModel: trimOptionalString(request.aiDefaultModel),
    providers: request.aiProviders
      ? structuredClone(request.aiProviders)
      : cloneRecord(current).providers,
  })
}

function mergeGlobalObject(
  jsonValue: Record<string, unknown> | undefined,
  structuredValue: Record<string, unknown> | undefined,
  currentValue: Record<string, unknown> | undefined,
  fieldName: string,
  schema: typeof sqliteSchema | typeof loggingSchema | typeof aiSchema,
): Record<string, unknown> | undefined {
  const merged = jsonValue ?? structuredValue
  if (merged === undefined) return undefined
  const restored = restoreConfigSecrets(merged, currentValue)
  assertWithSchema(schema, restored, fieldName)
  return restored
}

async function buildWorkbenchFromUpdatedContext(
  context: ConfigRuntimeContext,
): Promise<ConfigWorkbenchOverview> {
  return await buildWorkbenchOverviewFromSession({ context })
}

function deliveryIsReferenced(rawDocument: Record<string, unknown>, deliveryId: string): string[] {
  const sources = rawDocument.sources
  if (!isPlainObject(sources)) return []

  return Object.entries(sources).flatMap(([sourceId, value]) => {
    if (!isPlainObject(value)) return []
    const deliveries = value.deliveries
    if (!isPlainObject(deliveries)) return []
    return deliveryId in deliveries ? [sourceId] : []
  })
}

function buildStructuredDeliveryConfig(
  request: DeliveryConfigUpdateInput,
  current: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const next = cloneRecord(current)

  switch (request.kind) {
    case 'file': {
      const hasStructuredFields = [
        request.filePath,
        request.fileContent,
        request.fileRotationEnabled,
        request.fileRotationSize,
        request.fileRotationAge,
        request.fileRotationBackups,
      ].some((value) => value !== undefined)
      if (!hasStructuredFields) return undefined

      if (request.filePath !== undefined) next.path = request.filePath.trim()
      if (request.fileContent !== undefined) next.content = request.fileContent
      const rotation = cloneRecord(next.rotation)
      if (request.fileRotationEnabled !== undefined) rotation.enabled = request.fileRotationEnabled
      if (request.fileRotationSize !== undefined)
        rotation.size = trimOptionalString(request.fileRotationSize)
      if (request.fileRotationAge !== undefined)
        rotation.age = trimOptionalString(request.fileRotationAge)
      if (request.fileRotationBackups !== undefined) rotation.backups = request.fileRotationBackups
      const prunedRotation = pruneUndefined(rotation)
      if (Object.keys(prunedRotation).length > 0) next.rotation = prunedRotation
      else delete next.rotation
      return pruneUndefined(next)
    }
    case 'push': {
      const hasStructuredFields = [
        request.pushUrl,
        request.pushMethod,
        request.pushHeaders,
        request.pushTimeout,
        request.pushProxy,
        request.pushRetryLimit,
        request.pushRetryStatusCodes,
        request.pushRetryOnTimeout,
        request.pushRetryBackoffLimit,
        request.pushRequestType,
        request.pushRequestPayload,
        request.pushResponsePredicate,
        request.pushResponseMessage,
      ].some((value) => value !== undefined)
      if (!hasStructuredFields) return undefined

      const http = cloneRecord(next.http)
      if (request.pushUrl !== undefined) http.url = request.pushUrl.trim()
      if (request.pushMethod !== undefined) http.method = request.pushMethod
      if (request.pushHeaders !== undefined) http.headers = structuredClone(request.pushHeaders)
      if (request.pushTimeout !== undefined) http.timeout = trimOptionalString(request.pushTimeout)
      if (request.pushProxy !== undefined) http.proxy = trimOptionalString(request.pushProxy)
      const retry = cloneRecord(http.retry)
      if (request.pushRetryLimit !== undefined) retry.limit = request.pushRetryLimit
      if (request.pushRetryStatusCodes !== undefined)
        retry.statusCodes = request.pushRetryStatusCodes
      if (request.pushRetryOnTimeout !== undefined)
        retry.retryOnTimeout = request.pushRetryOnTimeout
      if (request.pushRetryBackoffLimit !== undefined) {
        retry.backoffLimit = trimOptionalString(request.pushRetryBackoffLimit)
      }
      const prunedRetry = pruneUndefined(retry)
      if (Object.keys(prunedRetry).length > 0) http.retry = prunedRetry
      else delete http.retry
      next.http = pruneUndefined(http)

      const requestConfig = cloneRecord(next.request)
      if (request.pushRequestType !== undefined) requestConfig.type = request.pushRequestType
      if (request.pushRequestPayload !== undefined)
        requestConfig.payload = request.pushRequestPayload
      const prunedRequest = pruneUndefined(requestConfig)
      if (Object.keys(prunedRequest).length > 0) next.request = prunedRequest
      else delete next.request

      const responseConfig = cloneRecord(next.response)
      if (request.pushResponsePredicate !== undefined) {
        responseConfig.predicate = trimOptionalString(request.pushResponsePredicate)
      }
      if (request.pushResponseMessage !== undefined) {
        responseConfig.message = trimOptionalString(request.pushResponseMessage)
      }
      const prunedResponse = pruneUndefined(responseConfig)
      if (Object.keys(prunedResponse).length > 0) next.response = prunedResponse
      else delete next.response

      return pruneUndefined(next)
    }
    case 'email': {
      const hasStructuredFields = [
        request.emailSmtpHost,
        request.emailSmtpPort,
        request.emailSmtpSecurity,
        request.emailSmtpAuthUsername,
        request.emailSmtpAuthPassword,
        request.emailMessageFrom,
        request.emailMessageTo,
        request.emailMessageCc,
        request.emailMessageBcc,
        request.emailMessageReplyTo,
        request.emailMessageSubject,
        request.emailMessageText,
        request.emailMessageHtml,
        request.emailMessageHeaders,
      ].some((value) => value !== undefined)
      if (!hasStructuredFields) return undefined

      const smtp = cloneRecord(next.smtp)
      if (request.emailSmtpHost !== undefined) smtp.host = request.emailSmtpHost.trim()
      if (request.emailSmtpPort !== undefined) smtp.port = request.emailSmtpPort
      if (request.emailSmtpSecurity !== undefined) smtp.security = request.emailSmtpSecurity
      const auth = cloneRecord(smtp.auth)
      if (request.emailSmtpAuthUsername !== undefined) {
        auth.username = trimOptionalString(request.emailSmtpAuthUsername)
      }
      if (request.emailSmtpAuthPassword !== undefined) {
        auth.password = trimOptionalString(request.emailSmtpAuthPassword)
      }
      const prunedAuth = pruneUndefined(auth)
      if (Object.keys(prunedAuth).length > 0) smtp.auth = prunedAuth
      else delete smtp.auth
      next.smtp = pruneUndefined(smtp)

      const message = cloneRecord(next.message)
      if (request.emailMessageFrom !== undefined)
        message.from = trimOptionalString(request.emailMessageFrom)
      if (request.emailMessageTo !== undefined) message.to = splitLines(request.emailMessageTo)
      if (request.emailMessageCc !== undefined) message.cc = splitLines(request.emailMessageCc)
      if (request.emailMessageBcc !== undefined) message.bcc = splitLines(request.emailMessageBcc)
      if (request.emailMessageReplyTo !== undefined) {
        message.replyTo = splitLines(request.emailMessageReplyTo)
      }
      if (request.emailMessageSubject !== undefined) {
        message.subject = trimOptionalString(request.emailMessageSubject)
      }
      if (request.emailMessageText !== undefined)
        message.text = trimOptionalString(request.emailMessageText)
      if (request.emailMessageHtml !== undefined)
        message.html = trimOptionalString(request.emailMessageHtml)
      if (request.emailMessageHeaders !== undefined) {
        message.headers = structuredClone(request.emailMessageHeaders)
      }
      const prunedMessage = pruneUndefined(message)
      if (Object.keys(prunedMessage).length > 0) next.message = prunedMessage
      else delete next.message
      return pruneUndefined(next)
    }
  }
}

export async function saveGlobalConfig(input: unknown): Promise<{
  message: string
  workbench: ConfigWorkbenchOverview
}> {
  let request: GlobalConfigUpdateInput
  try {
    request = parseGlobalConfigUpdate(input)
  } catch (error) {
    if (error instanceof ConfigManagementContractError) {
      throwValidation(error.message)
    }
    throw error
  }

  const session = await loadRuntimeSession()
  const sqliteJson =
    request.sqliteMode === 'json'
      ? parseOptionalJsonObject(request.sqliteJson, 'sqliteJson')
      : undefined
  const loggingJson =
    request.loggingMode === 'json'
      ? parseOptionalJsonObject(request.loggingJson, 'loggingJson')
      : undefined
  const aiJson =
    request.aiMode === 'json' ? parseOptionalJsonObject(request.aiJson, 'aiJson') : undefined

  const currentSqlite = cloneRecord(session.context.rawDocument.document.sqlite)
  const currentLogging = cloneRecord(session.context.rawDocument.document.logging)
  const currentAi = cloneRecord(session.context.rawDocument.document.ai)

  const sqlite = mergeGlobalObject(
    sqliteJson,
    request.sqliteMode === 'json' ? undefined : buildStructuredSqlite(request, currentSqlite),
    currentSqlite,
    'sqlite',
    sqliteSchema,
  )
  const logging = mergeGlobalObject(
    loggingJson,
    request.loggingMode === 'json' ? undefined : buildStructuredLogging(request, currentLogging),
    currentLogging,
    'logging',
    loggingSchema,
  )
  const ai = mergeGlobalObject(
    aiJson,
    request.aiMode === 'json' ? undefined : buildStructuredAi(request, currentAi),
    currentAi,
    'ai',
    aiSchema,
  )

  try {
    applyGlobalDocumentMutation(session.context.rawDocument.document, {
      language: request.language,
      timezone: request.timezone,
      timestampFormat: request.timestampFormat,
      sqlite,
      logging,
      ai,
    })
  } catch (error) {
    if (error instanceof ConfigDocumentUpdateError) {
      throwValidation(error.message)
    }
    throw error
  }

  let updatedContext
  try {
    updatedContext = await writeConfigRuntimeContext(session.context.rawDocument)
  } catch (error) {
    throw classifyConfigManagementError(error)
  }

  void requestConfigReload('web_save').catch(() => {})

  return {
    message: 'global 配置已保存',
    workbench: await buildWorkbenchFromUpdatedContext(updatedContext),
  }
}

export async function saveCanonicalDelivery(input: unknown): Promise<{
  message: string
  workbench: ConfigWorkbenchOverview
}> {
  let request: DeliveryConfigUpdateInput
  try {
    request = parseDeliveryConfigUpdate(input)
  } catch (error) {
    if (error instanceof ConfigManagementContractError) {
      throwValidation(error.message)
    }
    throw error
  }

  const session = await loadRuntimeSession()
  const currentDeliveryValue = cloneRecord(
    cloneRecord(session.context.rawDocument.document.deliveries)[request.deliveryId],
  )
  const currentConfig = cloneRecord(currentDeliveryValue[request.kind])
  const configJson =
    request.configMode === 'json'
      ? parseOptionalJsonObject(request.configJson, 'delivery.configJson')
      : undefined
  const mergedConfig =
    configJson ??
    (request.configMode === 'json'
      ? undefined
      : buildStructuredDeliveryConfig(request, currentConfig))
  if (!mergedConfig) {
    throwValidation('delivery.configJson 必须是对象')
  }

  const config = restoreConfigSecrets(mergedConfig, currentConfig)

  assertWithSchema(
    deliverySchema,
    {
      enabled: request.enabled,
      [request.kind]: config,
    },
    'delivery.configJson',
  )

  try {
    upsertCanonicalDeliveryDocumentMutation(session.context.rawDocument.document, {
      deliveryId: request.deliveryId,
      enabled: request.enabled,
      kind: request.kind,
      config,
    })
  } catch (error) {
    if (error instanceof ConfigDocumentUpdateError) {
      throwValidation(error.message)
    }
    throw error
  }

  let updatedContext
  try {
    updatedContext = await writeConfigRuntimeContext(session.context.rawDocument)
  } catch (error) {
    throw classifyConfigManagementError(error)
  }

  void requestConfigReload('web_save').catch(() => {})

  return {
    message: `delivery ${request.deliveryId} 配置已保存`,
    workbench: await buildWorkbenchFromUpdatedContext(updatedContext),
  }
}

export async function deleteCanonicalDelivery(input: unknown): Promise<{
  message: string
  workbench: ConfigWorkbenchOverview
}> {
  let request: DeliveryConfigDeleteInput
  try {
    request = parseDeliveryConfigDelete(input)
  } catch (error) {
    if (error instanceof ConfigManagementContractError) {
      throwValidation(error.message)
    }
    throw error
  }

  const session = await loadRuntimeSession()
  const referencedBy = deliveryIsReferenced(
    session.context.rawDocument.document,
    request.deliveryId,
  )
  if (referencedBy.length > 0) {
    throwConflict(`delivery ${request.deliveryId} 仍被 source 引用: ${referencedBy.join(', ')}`)
  }

  try {
    deleteCanonicalDeliveryDocumentMutation(session.context.rawDocument.document, request)
  } catch (error) {
    if (error instanceof ConfigDocumentUpdateError) {
      if (error.kind === 'not_found') {
        throwNotFound(error.message)
      }
      throwValidation(error.message)
    }
    throw error
  }

  let updatedContext
  try {
    updatedContext = await writeConfigRuntimeContext(session.context.rawDocument)
  } catch (error) {
    throw classifyConfigManagementError(error)
  }

  void requestConfigReload('web_save').catch(() => {})

  return {
    message: `delivery ${request.deliveryId} 已删除`,
    workbench: await buildWorkbenchFromUpdatedContext(updatedContext),
  }
}
