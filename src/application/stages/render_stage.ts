import { attachAiEntryRuntime } from '../../core/ai_runtime.ts'
import type { UnifiedFeedFields } from '../../config/types.ts'
import {
  isEmailDeliveryDefinition,
  isFileDeliveryDefinition,
  isPushDeliveryDefinition,
} from '../../domain/delivery_definition.ts'
import type { PipelineItem } from '../../domain/pipeline_item.ts'
import type { DeliveryBinding } from '../../domain/run_plan.ts'
import type { DeliveryAttemptPlan } from '../ports/delivery_executor.ts'

export interface RenderStageInput {
  item: PipelineItem
  binding: DeliveryBinding
  feed: UnifiedFeedFields
}

export interface RenderStageDeps {
  now: () => string
  createAttemptId: (input: { itemId: string; deliveryId: string; sourceRunId: string }) => string
  renderContent: (template: string, context: Record<string, unknown>) => Promise<string>
  renderPayload: (payload: unknown, context: Record<string, unknown>) => Promise<unknown>
}

export class RenderStage {
  constructor(private readonly deps: RenderStageDeps) {}

  async run(input: RenderStageInput): Promise<DeliveryAttemptPlan> {
    const context = attachAiEntryRuntime(
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

    if (isFileDeliveryDefinition(input.binding.definition)) {
      return {
        attemptId: this.deps.createAttemptId({
          itemId: input.item.itemId,
          deliveryId: input.binding.deliveryId,
          sourceRunId: input.item.sourceRunId,
        }),
        sourceRunId: input.item.sourceRunId,
        itemId: input.item.itemId,
        deliveryId: input.binding.deliveryId,
        effectDomain: input.item.effectDomain,
        channel: 'file',
        plannedAt: this.deps.now(),
        renderedSnapshot: {
          channel: 'file',
          payload: {
            path: input.binding.definition.path,
            content: await this.deps.renderContent(
              input.binding.definition.contentTemplate,
              context,
            ),
            rotation: input.binding.definition.rotation
              ? structuredClone(input.binding.definition.rotation)
              : undefined,
          },
        },
      }
    }

    if (isPushDeliveryDefinition(input.binding.definition)) {
      const pushDefinition = input.binding.definition
      const pushPayload = await this.deps.renderPayload(pushDefinition.payloadTemplate, context)

      return {
        attemptId: this.deps.createAttemptId({
          itemId: input.item.itemId,
          deliveryId: input.binding.deliveryId,
          sourceRunId: input.item.sourceRunId,
        }),
        sourceRunId: input.item.sourceRunId,
        itemId: input.item.itemId,
        deliveryId: input.binding.deliveryId,
        effectDomain: input.item.effectDomain,
        channel: 'push',
        plannedAt: this.deps.now(),
        renderedSnapshot: {
          channel: 'push',
          payload: {
            http: structuredClone(pushDefinition.http),
            requestType: pushDefinition.requestType,
            payload: pushPayload,
            response: pushDefinition.response
              ? structuredClone(pushDefinition.response)
              : undefined,
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
        return await Promise.all(values.map((value) => this.deps.renderContent(value, context)))
      }
      const renderStringRecord = async (
        values: Record<string, string> | undefined,
      ): Promise<Record<string, string> | undefined> => {
        if (!values) return undefined
        return Object.fromEntries(
          await Promise.all(
            Object.entries(values).map(async ([key, value]) => [
              key,
              await this.deps.renderContent(value, context),
            ]),
          ),
        )
      }
      const renderedMessage = {
        from: await this.deps.renderContent(messageTemplate.from, context),
        to: (await renderStringArray(messageTemplate.to)) ?? [],
        cc: await renderStringArray(messageTemplate.cc),
        bcc: await renderStringArray(messageTemplate.bcc),
        replyTo: await renderStringArray(messageTemplate.replyTo),
        subject: await this.deps.renderContent(messageTemplate.subject, context),
        ...(messageTemplate.text
          ? { text: await this.deps.renderContent(messageTemplate.text, context) }
          : {}),
        ...(messageTemplate.html
          ? { html: await this.deps.renderContent(messageTemplate.html, context) }
          : {}),
        headers: await renderStringRecord(messageTemplate.headers),
      }

      return {
        attemptId: this.deps.createAttemptId({
          itemId: input.item.itemId,
          deliveryId: input.binding.deliveryId,
          sourceRunId: input.item.sourceRunId,
        }),
        sourceRunId: input.item.sourceRunId,
        itemId: input.item.itemId,
        deliveryId: input.binding.deliveryId,
        effectDomain: input.item.effectDomain,
        channel: 'email',
        plannedAt: this.deps.now(),
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
}
