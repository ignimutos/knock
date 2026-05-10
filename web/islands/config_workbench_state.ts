import type { EmailConfig, FileDeliveryConfig, PushConfig } from '../../src/config/schema.ts'
import type {
  ConfigWorkbenchDeliveryConfig,
  ConfigWorkbenchOverview,
} from '../../src/contracts/workbench.ts'

export type DeliveryKind = ConfigWorkbenchOverview['deliveries'][number]['kind']

export type DeliveryDraft = {
  id: string
  enabled: boolean
  kind: DeliveryKind
  config: ConfigWorkbenchDeliveryConfig
  configJson: string
  isDraft?: boolean
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export {
  buildDeliveryPayload,
  buildGlobalPayload,
  buildSourcePayload,
  createDeliveryFormState,
  createGlobalFormState,
  createSourceFormState,
  type DeliveryFormState,
  type GlobalFormState,
  type SourceFormState,
} from '../components/config/form_state.ts'

export function createDefaultDeliveryConfig(kind: DeliveryKind): ConfigWorkbenchDeliveryConfig {
  if (kind === 'push') {
    return {
      http: {
        url: 'https://example.com',
        method: 'POST',
      },
      request: {
        type: 'body',
      },
    } as PushConfig
  }

  if (kind === 'email') {
    return {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
      },
      message: {
        from: 'noreply@example.com',
        to: ['ops@example.com'],
        subject: '{{ entry.title }}',
        text: '{{ entry.link }}',
      },
    } as EmailConfig
  }

  return {
    path: 'outputs/example.txt',
    content: '{{ entry.title }}',
  } as FileDeliveryConfig
}

export function createDraftDelivery(kind: DeliveryKind = 'file'): DeliveryDraft {
  const config = createDefaultDeliveryConfig(kind)

  return {
    id: '',
    enabled: true,
    kind,
    config,
    configJson: stringifyJson(config),
    isDraft: true,
  }
}
