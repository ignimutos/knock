import { z } from 'zod'
import type { HttpPayload } from '../config/schema.ts'
import type {
  ResolvedSourceConfig,
  UnifiedEntryFields,
  UnifiedFeedFields,
} from '../config/types.ts'
import { parseWithFirstIssue } from '../zod_utils.ts'
import { renderLiquid } from './liquid_runtime.ts'

export type ContentContext = Record<string, unknown>

const filterResultSchema = z.enum(['true', 'false'])
const contentTemplateSchema = z.string()

export function buildContext(
  entry: UnifiedEntryFields | Record<string, string>,
  feed: UnifiedFeedFields | Record<string, string>,
  source: ResolvedSourceConfig,
): ContentContext {
  return {
    ...entry,
    entry,
    feed,
    source,
  }
}

export async function shouldPassFilter(
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
}

export async function renderContent(template: string, context: ContentContext): Promise<string> {
  const validatedTemplate = parseWithFirstIssue(
    contentTemplateSchema,
    template,
    `模板内容非法: ${String(template)}`,
  )
  return await renderLiquid(validatedTemplate, context)
}

export async function renderPayload(
  payload: HttpPayload | undefined,
  context: ContentContext,
): Promise<HttpPayload | undefined> {
  if (typeof payload === 'string') {
    return await renderLiquid(payload, context)
  }
  if (Array.isArray(payload)) {
    return await Promise.all(
      payload.map((item) => renderPayload(item as HttpPayload | undefined, context)),
    )
  }
  if (payload && typeof payload === 'object') {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(payload).map(async ([key, value]) => [
          key,
          await renderPayload(value as HttpPayload | undefined, context),
        ]),
      ),
    )
  }
  return payload
}
