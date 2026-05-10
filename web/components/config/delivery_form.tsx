import type { HttpMethod, HttpRequestType } from '../../../src/config/schema.ts'
import type { DeliveryFormState, DeliveryKind } from './form_state.ts'

function placeholder(value: string, fallback: string): string {
  return value.trim() === '' ? fallback : ''
}

export function DeliveryForm(props: {
  state: DeliveryFormState
  saving: boolean
  deleting: boolean
  message: string
  error: string
  canDelete: boolean
  onChange: (patch: Partial<DeliveryFormState>) => void
  onSave: () => void
  onDelete: () => void
}) {
  const state = props.state

  return (
    <section
      id="config-delivery-manager"
      class="panel reader-manager-panel"
    >
      <div class="reader-manager-head">
        <div>
          <p class="reader-kicker">deliveries</p>
          <h2
            id="config-delivery-title"
            class="reader-manager-title"
          >
            {state.id || '新建 delivery'}
          </h2>
        </div>
        <span
          id="config-delivery-enabled-badge"
          class={`reader-state-badge is-${state.enabled ? 'enabled' : 'disabled'}`}
        >
          {state.enabled ? '启用' : '停用'}
        </span>
      </div>

      <p class="reader-empty">结构化字段优先；Advanced JSON 仅用于保留低频键。</p>

      <div class="reader-manager-grid">
        <div class="field">
          <label htmlFor="config-delivery-id">delivery id</label>
          <input
            id="config-delivery-id"
            class="input"
            value={state.id}
            readOnly={props.canDelete}
            onInput={(event) => props.onChange({ id: event.currentTarget.value })}
          />
        </div>
        <div class="field">
          <label htmlFor="config-delivery-kind">kind</label>
          <select
            id="config-delivery-kind"
            class="input"
            value={state.kind}
            onChange={(event) =>
              props.onChange({ kind: event.currentTarget.value as DeliveryKind })
            }
          >
            <option value="file">file</option>
            <option value="push">push</option>
            <option value="email">email</option>
          </select>
        </div>
        <label class={`reader-check reader-manager-enabled${state.enabled ? ' is-checked' : ''}`}>
          <input
            id="config-delivery-enabled"
            type="checkbox"
            class="reader-check-input"
            checked={state.enabled}
            onChange={(event) => props.onChange({ enabled: event.currentTarget.checked })}
          />
          <span class="reader-check-ui" />
          <span class="reader-check-copy">
            <span class="reader-check-label">启用该 delivery</span>
          </span>
        </label>
      </div>

      <details
        class="xq-section"
        open
      >
        <summary>
          <h2>{state.kind}</h2>
          <div class="segment-control">
            <label>
              <input
                type="radio"
                name="config-delivery-mode"
                checked={state.mode === 'structured'}
                onChange={() => props.onChange({ mode: 'structured' })}
              />
              <span>结构化</span>
            </label>
            <label>
              <input
                type="radio"
                name="config-delivery-mode"
                checked={state.mode === 'json'}
                onChange={() => props.onChange({ mode: 'json' })}
              />
              <span>JSON</span>
            </label>
          </div>
        </summary>
        <div
          class="panel"
          style={{ border: '0', borderTop: '1px solid var(--line)', borderRadius: '0 0 16px 16px' }}
        >
          {state.mode === 'json' ? (
            <div class="field reader-manager-wide">
              <label htmlFor="config-delivery-config-json">delivery config (JSON)</label>
              <textarea
                id="config-delivery-config-json"
                class="textarea"
                value={state.configJson}
                onInput={(event) => props.onChange({ configJson: event.currentTarget.value })}
              />
            </div>
          ) : null}

          {state.mode === 'structured' && state.kind === 'file' ? (
            <div class="reader-manager-grid">
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-file-path">file.path</label>
                <input
                  id="config-delivery-file-path"
                  class="input"
                  value={state.filePath}
                  placeholder={placeholder(state.filePath, 'outputs/example.txt')}
                  onInput={(event) => props.onChange({ filePath: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-file-content">file.content</label>
                <textarea
                  id="config-delivery-file-content"
                  class="textarea"
                  value={state.fileContent}
                  placeholder={placeholder(state.fileContent, '{{ entry.title }}')}
                  onInput={(event) => props.onChange({ fileContent: event.currentTarget.value })}
                />
              </div>
              <label
                class={`reader-check reader-manager-enabled${state.fileRotationEnabled ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  class="reader-check-input"
                  checked={state.fileRotationEnabled}
                  onChange={(event) =>
                    props.onChange({ fileRotationEnabled: event.currentTarget.checked })
                  }
                />
                <span class="reader-check-ui" />
                <span class="reader-check-copy">
                  <span class="reader-check-label">启用 file.rotation</span>
                </span>
              </label>
              <div class="field">
                <label htmlFor="config-delivery-file-rotation-size">file.rotation.size</label>
                <input
                  id="config-delivery-file-rotation-size"
                  class="input"
                  value={state.fileRotationSize}
                  onInput={(event) =>
                    props.onChange({ fileRotationSize: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-file-rotation-age">file.rotation.age</label>
                <input
                  id="config-delivery-file-rotation-age"
                  class="input"
                  value={state.fileRotationAge}
                  onInput={(event) =>
                    props.onChange({ fileRotationAge: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-file-rotation-backups">file.rotation.backups</label>
                <input
                  id="config-delivery-file-rotation-backups"
                  class="input"
                  value={state.fileRotationBackups}
                  onInput={(event) =>
                    props.onChange({ fileRotationBackups: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          ) : null}

          {state.mode === 'structured' && state.kind === 'push' ? (
            <div class="reader-manager-grid">
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-url">push.http.url</label>
                <input
                  id="config-delivery-push-url"
                  class="input"
                  value={state.pushUrl}
                  placeholder={placeholder(state.pushUrl, 'https://example.com')}
                  onInput={(event) => props.onChange({ pushUrl: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-method">push.http.method</label>
                <select
                  id="config-delivery-push-method"
                  class="input"
                  value={state.pushMethod}
                  onChange={(event) =>
                    props.onChange({ pushMethod: event.currentTarget.value as HttpMethod })
                  }
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                  <option value="HEAD">HEAD</option>
                </select>
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-timeout">push.http.timeout</label>
                <input
                  id="config-delivery-push-timeout"
                  class="input"
                  value={state.pushTimeout}
                  onInput={(event) => props.onChange({ pushTimeout: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-proxy">push.http.proxy</label>
                <input
                  id="config-delivery-push-proxy"
                  class="input"
                  value={state.pushProxy}
                  onInput={(event) => props.onChange({ pushProxy: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-headers-json">push.http.headers (JSON)</label>
                <textarea
                  id="config-delivery-push-headers-json"
                  class="textarea"
                  value={state.pushHeadersJson}
                  onInput={(event) =>
                    props.onChange({ pushHeadersJson: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-retry-limit">push.http.retry.limit</label>
                <input
                  id="config-delivery-push-retry-limit"
                  class="input"
                  value={state.pushRetryLimit}
                  onInput={(event) => props.onChange({ pushRetryLimit: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-retry-status-codes">
                  push.http.retry.statusCodes
                </label>
                <input
                  id="config-delivery-push-retry-status-codes"
                  class="input"
                  value={state.pushRetryStatusCodes}
                  onInput={(event) =>
                    props.onChange({ pushRetryStatusCodes: event.currentTarget.value })
                  }
                />
              </div>
              <label
                class={`reader-check reader-manager-enabled${state.pushRetryOnTimeout ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  class="reader-check-input"
                  checked={state.pushRetryOnTimeout}
                  onChange={(event) =>
                    props.onChange({ pushRetryOnTimeout: event.currentTarget.checked })
                  }
                />
                <span class="reader-check-ui" />
                <span class="reader-check-copy">
                  <span class="reader-check-label">push.http.retry.retryOnTimeout</span>
                </span>
              </label>
              <div class="field">
                <label htmlFor="config-delivery-push-retry-backoff-limit">
                  push.http.retry.backoffLimit
                </label>
                <input
                  id="config-delivery-push-retry-backoff-limit"
                  class="input"
                  value={state.pushRetryBackoffLimit}
                  onInput={(event) =>
                    props.onChange({ pushRetryBackoffLimit: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-push-request-type">push.request.type</label>
                <select
                  id="config-delivery-push-request-type"
                  class="input"
                  value={state.pushRequestType}
                  onChange={(event) =>
                    props.onChange({
                      pushRequestType: event.currentTarget.value as HttpRequestType,
                    })
                  }
                >
                  <option value="query">query</option>
                  <option value="form">form</option>
                  <option value="body">body</option>
                </select>
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-request-payload-json">
                  push.request.payload (JSON)
                </label>
                <textarea
                  id="config-delivery-push-request-payload-json"
                  class="textarea"
                  value={state.pushRequestPayloadJson}
                  onInput={(event) =>
                    props.onChange({ pushRequestPayloadJson: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-response-predicate">
                  push.response.predicate
                </label>
                <input
                  id="config-delivery-push-response-predicate"
                  class="input"
                  value={state.pushResponsePredicate}
                  onInput={(event) =>
                    props.onChange({ pushResponsePredicate: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-push-response-message">push.response.message</label>
                <input
                  id="config-delivery-push-response-message"
                  class="input"
                  value={state.pushResponseMessage}
                  onInput={(event) =>
                    props.onChange({ pushResponseMessage: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          ) : null}

          {state.mode === 'structured' && state.kind === 'email' ? (
            <div class="reader-manager-grid">
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-host">email.smtp.host</label>
                <input
                  id="config-delivery-email-smtp-host"
                  class="input"
                  value={state.emailSmtpHost}
                  placeholder={placeholder(state.emailSmtpHost, 'smtp.example.com')}
                  onInput={(event) => props.onChange({ emailSmtpHost: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-port">email.smtp.port</label>
                <input
                  id="config-delivery-email-smtp-port"
                  class="input"
                  value={state.emailSmtpPort}
                  onInput={(event) => props.onChange({ emailSmtpPort: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-security">email.smtp.security</label>
                <select
                  id="config-delivery-email-smtp-security"
                  class="input"
                  value={state.emailSmtpSecurity}
                  onChange={(event) =>
                    props.onChange({
                      emailSmtpSecurity: event.currentTarget
                        .value as DeliveryFormState['emailSmtpSecurity'],
                    })
                  }
                >
                  <option value="implicit">implicit</option>
                  <option value="starttls">starttls</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-auth-username">
                  email.smtp.auth.username
                </label>
                <input
                  id="config-delivery-email-smtp-auth-username"
                  class="input"
                  value={state.emailSmtpAuthUsername}
                  onInput={(event) =>
                    props.onChange({ emailSmtpAuthUsername: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-delivery-email-smtp-auth-password">
                  email.smtp.auth.password
                </label>
                <input
                  id="config-delivery-email-smtp-auth-password"
                  type="password"
                  class="input"
                  value={state.emailSmtpAuthPassword}
                  onInput={(event) =>
                    props.onChange({ emailSmtpAuthPassword: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-from">email.message.from</label>
                <input
                  id="config-delivery-email-message-from"
                  class="input"
                  value={state.emailMessageFrom}
                  placeholder={placeholder(state.emailMessageFrom, 'noreply@example.com')}
                  onInput={(event) =>
                    props.onChange({ emailMessageFrom: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-to">email.message.to</label>
                <textarea
                  id="config-delivery-email-message-to"
                  class="textarea"
                  value={state.emailMessageTo}
                  onInput={(event) => props.onChange({ emailMessageTo: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-cc">email.message.cc</label>
                <textarea
                  id="config-delivery-email-message-cc"
                  class="textarea"
                  value={state.emailMessageCc}
                  onInput={(event) => props.onChange({ emailMessageCc: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-bcc">email.message.bcc</label>
                <textarea
                  id="config-delivery-email-message-bcc"
                  class="textarea"
                  value={state.emailMessageBcc}
                  onInput={(event) =>
                    props.onChange({ emailMessageBcc: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-reply-to">
                  email.message.replyTo
                </label>
                <textarea
                  id="config-delivery-email-message-reply-to"
                  class="textarea"
                  value={state.emailMessageReplyTo}
                  onInput={(event) =>
                    props.onChange({ emailMessageReplyTo: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-subject">email.message.subject</label>
                <input
                  id="config-delivery-email-message-subject"
                  class="input"
                  value={state.emailMessageSubject}
                  onInput={(event) =>
                    props.onChange({ emailMessageSubject: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-text">email.message.text</label>
                <textarea
                  id="config-delivery-email-message-text"
                  class="textarea"
                  value={state.emailMessageText}
                  onInput={(event) =>
                    props.onChange({ emailMessageText: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-html">email.message.html</label>
                <textarea
                  id="config-delivery-email-message-html"
                  class="textarea"
                  value={state.emailMessageHtml}
                  onInput={(event) =>
                    props.onChange({ emailMessageHtml: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-delivery-email-message-headers-json">
                  email.message.headers (JSON)
                </label>
                <textarea
                  id="config-delivery-email-message-headers-json"
                  class="textarea"
                  value={state.emailMessageHeadersJson}
                  onInput={(event) =>
                    props.onChange({ emailMessageHeadersJson: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          ) : null}
        </div>
      </details>

      <div class="toolbar reader-manager-actions">
        <button
          type="button"
          class="btn btn-primary"
          id="config-delivery-save"
          disabled={props.saving}
          onClick={props.onSave}
        >
          {props.saving ? '保存中…' : '保存 Delivery'}
        </button>
        {props.canDelete ? (
          <button
            type="button"
            class="btn btn-secondary"
            id="config-delivery-delete"
            disabled={props.deleting}
            onClick={props.onDelete}
          >
            {props.deleting ? '删除中…' : '删除 Delivery'}
          </button>
        ) : null}
      </div>

      {props.message ? (
        <p
          id="config-delivery-message"
          class="reader-manager-message is-success"
        >
          {props.message}
        </p>
      ) : null}
      {props.error ? (
        <p
          id="config-delivery-error"
          class="reader-manager-message is-error"
        >
          {props.error}
        </p>
      ) : null}
    </section>
  )
}
