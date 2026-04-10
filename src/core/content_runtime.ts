import { z } from 'zod'
import type { HttpPayload } from '../config/schema.ts'
import type {
  ResolvedSourceConfig,
  UnifiedEntryFields,
  UnifiedFeedFields,
} from '../config/types.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import type { AiEntryRuntime, AiRuntime } from './ai_runtime.ts'
import { attachAiEntryRuntime } from './ai_runtime.ts'
import { createLiquidRuntime } from './liquid_runtime.ts'

export type ContentContext = Record<string, unknown>

export interface ContentRuntime {
  buildContext(
    entry: UnifiedEntryFields | Record<string, string>,
    feed: UnifiedFeedFields | Record<string, string>,
    source: ResolvedSourceConfig,
    aiEntryRuntime?: AiEntryRuntime,
  ): ContentContext
  shouldPassFilter(filterTemplate: string | undefined, context: ContentContext): Promise<boolean>
  renderContent(template: string, context: ContentContext): Promise<string>
  renderPayload(
    payload: HttpPayload | undefined,
    context: ContentContext,
  ): Promise<HttpPayload | undefined>
}

interface CreateContentRuntimeOptions {
  aiRuntime?: AiRuntime
}

const filterResultSchema = z.enum(['true', 'false'])
const contentTemplateSchema = z.string()

function buildTemplateContext(
  entry: UnifiedEntryFields | Record<string, string>,
  feed: UnifiedFeedFields | Record<string, string>,
  source: ResolvedSourceConfig,
  aiEntryRuntime?: AiEntryRuntime,
): ContentContext {
  return attachAiEntryRuntime(
    {
      ...entry,
      entry,
      feed,
      source,
    },
    aiEntryRuntime,
  )
}

async function renderPayloadWithLiquid(
  payload: HttpPayload | undefined,
  context: ContentContext,
  renderLiquid: (template: string, context: ContentContext) => Promise<string>,
): Promise<HttpPayload | undefined> {
  if (typeof payload === 'string') {
    return await renderLiquid(payload, context)
  }
  if (Array.isArray(payload)) {
    return await Promise.all(
      payload.map((item) =>
        renderPayloadWithLiquid(item as HttpPayload | undefined, context, renderLiquid),
      ),
    )
  }
  if (payload && typeof payload === 'object') {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(payload).map(async ([key, value]) => [
          key,
          await renderPayloadWithLiquid(value as HttpPayload | undefined, context, renderLiquid),
        ]),
      ),
    )
  }
  return payload
}

export function createContentRuntime(options: CreateContentRuntimeOptions = {}): ContentRuntime {
  const liquidRuntime = createLiquidRuntime({ aiRuntime: options.aiRuntime })
  const renderLiquid = (template: string, context: ContentContext): Promise<string> => {
    return liquidRuntime.render(template, context)
  }

  return {
    buildContext: buildTemplateContext,

    async shouldPassFilter(
      filterTemplate: string | undefined,
      context: ContentContext,
    ): Promise<boolean> {
      if (!filterTemplate || filterTemplate.trim() === '') return true

      const rendered = await renderLiquid(filterTemplate, context)
      const normalized = parseWithFirstIssue(
        filterResultSchema,
        rendered.trim().toLowerCase(),
        'filter 模板必须返回布尔值 true/false',
      )

      return normalized === 'true'
    },

    async renderContent(template: string, context: ContentContext): Promise<string> {
      const validatedTemplate = parseWithFirstIssue(
        contentTemplateSchema,
        template,
        `模板内容非法: ${String(template)}`,
      )
      return await renderLiquid(validatedTemplate, context)
    },

    async renderPayload(
      payload: HttpPayload | undefined,
      context: ContentContext,
    ): Promise<HttpPayload | undefined> {
      return await renderPayloadWithLiquid(payload, context, renderLiquid)
    },
  }
}

const sharedContentRuntime = createContentRuntime()

export function buildContext(
  entry: UnifiedEntryFields | Record<string, string>,
  feed: UnifiedFeedFields | Record<string, string>,
  source: ResolvedSourceConfig,
  aiEntryRuntime?: AiEntryRuntime,
): ContentContext {
  return sharedContentRuntime.buildContext(entry, feed, source, aiEntryRuntime)
}

export async function shouldPassFilter(
  filterTemplate: string | undefined,
  context: ContentContext,
): Promise<boolean> {
  return await sharedContentRuntime.shouldPassFilter(filterTemplate, context)
}

export async function renderContent(template: string, context: ContentContext): Promise<string> {
  return await sharedContentRuntime.renderContent(template, context)
}

export async function renderPayload(
  payload: HttpPayload | undefined,
  context: ContentContext,
): Promise<HttpPayload | undefined> {
  return await sharedContentRuntime.renderPayload(payload, context)
}
