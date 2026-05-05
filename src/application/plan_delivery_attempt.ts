import { attachAiEntryRuntime } from '../core/ai_runtime.ts'
import type { UnifiedFeedFields } from '../config/types.ts'
import type { ContentContext } from '../core/content_runtime.ts'
import {
  isEmailDeliveryDefinition,
  isFileDeliveryDefinition,
  isPushDeliveryDefinition,
} from '../domain/delivery_definition.ts'
import type { PipelineItem } from '../domain/pipeline_item.ts'
import type { DeliveryBinding } from '../domain/run_plan.ts'
import type { DeliveryAttemptPlan } from './ports/delivery_executor.ts'

function createAttemptPlanBase(input: {
  now: () => string
  createAttemptId: (input: { itemId: string; deliveryId: string; sourceRunId: string }) => string
  item: PipelineItem
  binding: DeliveryBinding
}) {
  return {
    attemptId: input.createAttemptId({
      itemId: input.item.itemId,
      deliveryId: input.binding.deliveryId,
      sourceRunId: input.item.sourceRunId,
    }),
    sourceRunId: input.item.sourceRunId,
    itemId: input.item.itemId,
    deliveryId: input.binding.deliveryId,
    effectDomain: input.item.effectDomain,
    plannedAt: input.now(),
  }
}

export function createDeliveryAttemptContext(input: {
  item: PipelineItem
  feed: UnifiedFeedFields
}): ContentContext {
  return attachAiEntryRuntime(
    {
      ...input.item.normalized,
      entry: input.item.normalized,
      feed: input.feed,
      item: input.item,
      source: {
        id: input.item.sourceId,
        title: input.feed.title,
        runtime: {
          window: {
            scheduledAt: input.feed.published,
          },
        },
      },
    },
    {
      sourceId: input.item.sourceId,
      entryId: input.item.normalized.id || input.item.itemId,
      sourceRunId: input.item.sourceRunId,
      cache: new Map(),
    },
  )
}

export async function planDeliveryAttempt(input: {
  now: () => string
  createAttemptId: (input: { itemId: string; deliveryId: string; sourceRunId: string }) => string
  item: PipelineItem
  binding: DeliveryBinding
  context: ContentContext
  renderContent: (template: string, context: ContentContext) => Promise<string>
  renderPayload: (payload: unknown, context: ContentContext) => Promise<unknown>
}): Promise<DeliveryAttemptPlan> {
  const context = input.context

  const base = createAttemptPlanBase(input)

  if (isFileDeliveryDefinition(input.binding.definition)) {
    return {
      ...base,
      channel: 'file',
      renderedSnapshot: {
        channel: 'file',
        payload: {
          path: input.binding.definition.path,
          content: await input.renderContent(input.binding.definition.contentTemplate, context),
          rotation: input.binding.definition.rotation
            ? structuredClone(input.binding.definition.rotation)
            : undefined,
        },
      },
    }
  }

  if (isPushDeliveryDefinition(input.binding.definition)) {
    const pushDefinition = input.binding.definition
    const pushPayload = await input.renderPayload(pushDefinition.payloadTemplate, context)

    return {
      ...base,
      channel: 'push',
      renderedSnapshot: {
        channel: 'push',
        payload: {
          http: structuredClone(pushDefinition.http),
          requestType: pushDefinition.requestType,
          payload: pushPayload,
          response: pushDefinition.response ? structuredClone(pushDefinition.response) : undefined,
        },
      },
    }
  }

  if (isEmailDeliveryDefinition(input.binding.definition)) {
    const messageTemplate = input.binding.definition.messageTemplate
    const renderStringArray = async (
      values: string[] | undefined,
    ): Promise<string[] | undefined> => {
      if (!values) return undefined
      return await Promise.all(values.map((value) => input.renderContent(value, context)))
    }
    const renderStringRecord = async (
      values: Record<string, string> | undefined,
    ): Promise<Record<string, string> | undefined> => {
      if (!values) return undefined
      return Object.fromEntries(
        await Promise.all(
          Object.entries(values).map(async ([key, value]) => [
            key,
            await input.renderContent(value, context),
          ]),
        ),
      )
    }
    const renderedMessage = {
      from: await input.renderContent(messageTemplate.from, context),
      to: (await renderStringArray(messageTemplate.to)) ?? [],
      cc: await renderStringArray(messageTemplate.cc),
      bcc: await renderStringArray(messageTemplate.bcc),
      replyTo: await renderStringArray(messageTemplate.replyTo),
      subject: await input.renderContent(messageTemplate.subject, context),
      ...(messageTemplate.text
        ? { text: await input.renderContent(messageTemplate.text, context) }
        : {}),
      ...(messageTemplate.html
        ? { html: await input.renderContent(messageTemplate.html, context) }
        : {}),
      headers: await renderStringRecord(messageTemplate.headers),
    }

    return {
      ...base,
      channel: 'email',
      renderedSnapshot: {
        channel: 'email',
        payload: {
          smtp: structuredClone(input.binding.definition.smtp),
          message: renderedMessage,
        },
      },
    }
  }

  throw new Error(`不支持的 delivery kind: ${JSON.stringify(input.binding.definition)}`)
}
