import type { ReaderDeliveryCatalogItem, ReaderOverview } from '../../../src/contracts/workbench.ts'
import type { SourceFormState } from './form_state.ts'

function deliveryOverrideLabel(kind: ReaderDeliveryCatalogItem['kind']): string {
  switch (kind) {
    case 'file':
      return 'content override'
    case 'push':
      return 'payload override (JSON)'
    default:
      return 'message override (JSON)'
  }
}

function defaultSourceFileOverride(): string {
  return '{{ entry.title }}'
}

function placeholder(value: string, fallback: string): string {
  return value.trim() === '' ? fallback : ''
}

export function SourceManager(props: {
  source: SourceFormState | undefined
  allDeliveries: ReaderOverview['deliveries']
  saving: boolean
  message: string
  error: string
  onChange: (patch: Partial<SourceFormState>) => void
  onToggleDelivery: (deliveryId: string, checked: boolean) => void
  onOverrideChange: (deliveryId: string, value: string) => void
  onSave: () => void
}) {
  if (!props.source) {
    return (
      <section
        id="config-manager"
        class="panel reader-manager-panel"
      >
        <p class="reader-empty">还没有可管理的 source。</p>
      </section>
    )
  }

  const source = props.source
  const summary = source.transport === 'summary' || source.parser === 'summary'
  const showXqueryFields = !summary && source.parser === 'xquery'

  return (
    <section
      id="config-manager"
      class="panel reader-manager-panel"
    >
      <div class="reader-manager-head">
        <div>
          <p class="reader-kicker">sources</p>
          <h2
            id="config-manager-title"
            class="reader-manager-title"
          >
            {source.id}
          </h2>
        </div>
        <span
          id="config-manager-enabled-badge"
          class={`reader-state-badge is-${source.enabled ? 'enabled' : 'disabled'}`}
        >
          {source.enabled ? '启用' : '停用'}
        </span>
      </div>

      <p class="reader-empty">
        保存会直接重写 runtime/config.yml 的 YAML 文本布局与注释，请确认这符合当前工作方式。
      </p>

      <div class="reader-manager-grid">
        <div class="field">
          <label htmlFor="config-manager-name">显示名称</label>
          <input
            id="config-manager-name"
            class="input"
            value={source.name}
            onInput={(event) => props.onChange({ name: event.currentTarget.value })}
          />
        </div>
        <div class="field">
          <label htmlFor="config-manager-schedule">schedule</label>
          <input
            id="config-manager-schedule"
            class="input"
            value={source.schedule}
            onInput={(event) => props.onChange({ schedule: event.currentTarget.value })}
          />
        </div>
        <div class="field">
          <label htmlFor="config-manager-transport">transport</label>
          <select
            id="config-manager-transport"
            class="input"
            disabled={summary}
            value={source.transport}
            onChange={(event) =>
              props.onChange({
                transport: event.currentTarget.value as SourceFormState['transport'],
              })
            }
          >
            <option value="http">http</option>
            <option value="byparr">byparr</option>
            <option
              value="summary"
              disabled={!summary}
            >
              summary
            </option>
          </select>
        </div>
        <div class="field">
          <label htmlFor="config-manager-parser">parser</label>
          <select
            id="config-manager-parser"
            class="input"
            disabled={summary}
            value={source.parser}
            onChange={(event) =>
              props.onChange({ parser: event.currentTarget.value as SourceFormState['parser'] })
            }
          >
            <option value="syndication">syndication</option>
            <option value="xquery">xquery</option>
            <option
              value="summary"
              disabled={!summary}
            >
              summary
            </option>
          </select>
        </div>
        <div class="field reader-manager-wide">
          <label htmlFor="config-manager-target-url">目标 URL</label>
          <input
            id="config-manager-target-url"
            class="input"
            value={source.targetUrl}
            placeholder={placeholder(source.targetUrl, 'https://example.com/feed.xml')}
            disabled={summary}
            onInput={(event) => props.onChange({ targetUrl: event.currentTarget.value })}
          />
        </div>
        <div class="field reader-manager-wide">
          <label htmlFor="config-manager-filter">filter</label>
          <textarea
            id="config-manager-filter"
            class="textarea"
            value={source.filter}
            onInput={(event) => props.onChange({ filter: event.currentTarget.value })}
          />
        </div>
        {showXqueryFields ? (
          <div
            id="config-manager-xquery-fields"
            class="reader-manager-xquery-fields reader-manager-wide"
          >
            <div class="reader-manager-grid">
              <div class="field reader-manager-wide">
                <label htmlFor="config-manager-xquery-locate">xquery.locate</label>
                <input
                  id="config-manager-xquery-locate"
                  class="input"
                  value={source.xqueryLocate}
                  onInput={(event) => props.onChange({ xqueryLocate: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-manager-xquery-entry-id">xquery.entry.id</label>
                <input
                  id="config-manager-xquery-entry-id"
                  class="input"
                  value={source.xqueryEntryId}
                  onInput={(event) => props.onChange({ xqueryEntryId: event.currentTarget.value })}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <label class={`reader-check reader-manager-enabled${source.enabled ? ' is-checked' : ''}`}>
        <input
          id="config-manager-enabled"
          type="checkbox"
          class="reader-check-input"
          checked={source.enabled}
          onChange={(event) => props.onChange({ enabled: event.currentTarget.checked })}
        />
        <span class="reader-check-ui" />
        <span class="reader-check-copy">
          <span class="reader-check-label">启用该 source</span>
        </span>
      </label>

      <div class="reader-manager-deliveries">
        <p class="reader-kicker">source delivery overrides</p>
        <div class="reader-manager-delivery-list">
          {props.allDeliveries.length === 0 ? (
            <p class="reader-empty">当前没有可绑定 delivery。</p>
          ) : (
            props.allDeliveries.map((delivery) => {
              const checked = source.deliveryIds.includes(delivery.id)
              return (
                <div
                  class="reader-delivery-block"
                  key={delivery.id}
                >
                  <label
                    class={`reader-check reader-delivery-toggle${checked ? ' is-checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      class="reader-check-input"
                      checked={checked}
                      onChange={(event) =>
                        props.onToggleDelivery(delivery.id, event.currentTarget.checked)
                      }
                    />
                    <span class="reader-check-ui" />
                    <span class="reader-check-copy">
                      <span class="reader-check-label">{delivery.id}</span>
                      <span class="reader-check-meta">{delivery.kind}</span>
                    </span>
                  </label>
                  {checked ? (
                    <div class="reader-delivery-editor">
                      <label class="field reader-manager-wide">
                        <span>{deliveryOverrideLabel(delivery.kind)}</span>
                        <textarea
                          class="textarea reader-delivery-textarea"
                          value={source.deliveryOverrides[delivery.id] ?? ''}
                          placeholder={
                            delivery.kind === 'file'
                              ? defaultSourceFileOverride()
                              : delivery.kind === 'push'
                                ? '{\n  "text": "{{ entry.title }}"\n}'
                                : '{\n  "subject": "{{ entry.title }}"\n}'
                          }
                          onInput={(event) =>
                            props.onOverrideChange(delivery.id, event.currentTarget.value)
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div class="toolbar reader-manager-actions">
        <button
          type="button"
          class="btn btn-primary"
          id="config-manager-save"
          disabled={props.saving}
          onClick={props.onSave}
        >
          {props.saving ? '保存中…' : '保存 Source'}
        </button>
      </div>

      {props.message ? (
        <p
          id="config-manager-message"
          class="reader-manager-message is-success"
        >
          {props.message}
        </p>
      ) : null}
      {props.error ? (
        <p
          id="config-manager-error"
          class="reader-manager-message is-error"
        >
          {props.error}
        </p>
      ) : null}
    </section>
  )
}
