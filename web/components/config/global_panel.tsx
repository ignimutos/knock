import type { GlobalFormState } from './form_state.ts'

function placeholder(value: string, fallback: string): string {
  return value.trim() === '' ? fallback : ''
}

export function GlobalPanel(props: {
  state: GlobalFormState
  saving: boolean
  message: string
  error: string
  onChange: (patch: Partial<GlobalFormState>) => void
  onSave: () => void
}) {
  const state = props.state

  return (
    <section
      id="config-global-panel"
      class="panel reader-manager-panel"
    >
      <div class="reader-manager-head">
        <div>
          <p class="reader-kicker">global</p>
          <h2 class="reader-manager-title">全局配置</h2>
        </div>
      </div>

      <p class="reader-empty">
        结构化字段优先；Advanced JSON 仅用于保留低频键。保存会重写 YAML 文本布局与注释。
      </p>

      <div class="reader-manager-grid">
        <div class="field">
          <label htmlFor="config-global-language">language</label>
          <input
            id="config-global-language"
            class="input"
            value={state.language}
            onInput={(event) => props.onChange({ language: event.currentTarget.value })}
          />
        </div>
        <div class="field">
          <label htmlFor="config-global-timezone">timezone</label>
          <input
            id="config-global-timezone"
            class="input"
            value={state.timezone}
            onInput={(event) => props.onChange({ timezone: event.currentTarget.value })}
          />
        </div>
        <div class="field reader-manager-wide">
          <label htmlFor="config-global-timestamp-format">timestampFormat</label>
          <input
            id="config-global-timestamp-format"
            class="input"
            value={state.timestampFormat}
            onInput={(event) => props.onChange({ timestampFormat: event.currentTarget.value })}
          />
        </div>
      </div>

      <details
        class="xq-section"
        open
      >
        <summary>
          <h2>sqlite</h2>
          <div class="segment-control">
            <label>
              <input
                type="radio"
                name="config-global-sqlite-mode"
                checked={state.sqliteMode === 'structured'}
                onChange={() => props.onChange({ sqliteMode: 'structured' })}
              />
              <span>结构化</span>
            </label>
            <label>
              <input
                type="radio"
                name="config-global-sqlite-mode"
                checked={state.sqliteMode === 'json'}
                onChange={() => props.onChange({ sqliteMode: 'json' })}
              />
              <span>JSON</span>
            </label>
          </div>
        </summary>
        <div
          class="panel"
          style={{ border: '0', borderTop: '1px solid var(--line)', borderRadius: '0 0 16px 16px' }}
        >
          {state.sqliteMode === 'structured' ? (
            <div class="reader-manager-grid">
              <div class="field">
                <label htmlFor="config-global-sqlite-path">sqlite.path</label>
                <input
                  id="config-global-sqlite-path"
                  class="input"
                  value={state.sqlitePath}
                  placeholder={placeholder(state.sqlitePath, 'db/knock.db')}
                  onInput={(event) => props.onChange({ sqlitePath: event.currentTarget.value })}
                />
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-busy-timeout">sqlite.busyTimeout</label>
                <input
                  id="config-global-sqlite-busy-timeout"
                  class="input"
                  value={state.sqliteBusyTimeout}
                  placeholder={placeholder(state.sqliteBusyTimeout, '5s')}
                  onInput={(event) =>
                    props.onChange({ sqliteBusyTimeout: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-journal-mode">sqlite.journalMode</label>
                <select
                  id="config-global-sqlite-journal-mode"
                  class="input"
                  value={state.sqliteJournalMode}
                  onChange={(event) =>
                    props.onChange({
                      sqliteJournalMode: event.currentTarget
                        .value as GlobalFormState['sqliteJournalMode'],
                    })
                  }
                >
                  <option value="WAL">WAL</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-retention-max-age">
                  sqlite.retention.maxAge
                </label>
                <input
                  id="config-global-sqlite-retention-max-age"
                  class="input"
                  value={state.sqliteRetentionMaxAge}
                  placeholder={placeholder(state.sqliteRetentionMaxAge, '180d')}
                  onInput={(event) =>
                    props.onChange({ sqliteRetentionMaxAge: event.currentTarget.value })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-retention-max-entries">
                  sqlite.retention.maxEntriesPerSource
                </label>
                <input
                  id="config-global-sqlite-retention-max-entries"
                  class="input"
                  value={state.sqliteRetentionMaxEntriesPerSource}
                  placeholder={placeholder(state.sqliteRetentionMaxEntriesPerSource, '1000')}
                  onInput={(event) =>
                    props.onChange({
                      sqliteRetentionMaxEntriesPerSource: event.currentTarget.value,
                    })
                  }
                />
              </div>
              <div class="field">
                <label htmlFor="config-global-sqlite-retention-vacuum">
                  sqlite.retention.vacuum
                </label>
                <select
                  id="config-global-sqlite-retention-vacuum"
                  class="input"
                  value={state.sqliteRetentionVacuum}
                  onChange={(event) =>
                    props.onChange({
                      sqliteRetentionVacuum: event.currentTarget
                        .value as GlobalFormState['sqliteRetentionVacuum'],
                    })
                  }
                >
                  <option value="off">off</option>
                  <option value="afterPrune">afterPrune</option>
                </select>
              </div>
            </div>
          ) : (
            <div class="field reader-manager-wide">
              <label htmlFor="config-global-sqlite-json">sqlite (JSON)</label>
              <textarea
                id="config-global-sqlite-json"
                class="textarea"
                value={state.sqliteJson}
                onInput={(event) => props.onChange({ sqliteJson: event.currentTarget.value })}
              />
            </div>
          )}
        </div>
      </details>

      <details
        class="xq-section"
        open
      >
        <summary>
          <h2>logging</h2>
          <div class="segment-control">
            <label>
              <input
                type="radio"
                name="config-global-logging-mode"
                checked={state.loggingMode === 'structured'}
                onChange={() => props.onChange({ loggingMode: 'structured' })}
              />
              <span>结构化</span>
            </label>
            <label>
              <input
                type="radio"
                name="config-global-logging-mode"
                checked={state.loggingMode === 'json'}
                onChange={() => props.onChange({ loggingMode: 'json' })}
              />
              <span>JSON</span>
            </label>
          </div>
        </summary>
        <div
          class="panel"
          style={{ border: '0', borderTop: '1px solid var(--line)', borderRadius: '0 0 16px 16px' }}
        >
          {state.loggingMode === 'structured' ? (
            <div class="reader-manager-grid">
              <div class="field">
                <label htmlFor="config-global-logging-level">logging.level</label>
                <select
                  id="config-global-logging-level"
                  class="input"
                  value={state.loggingLevel}
                  onChange={(event) =>
                    props.onChange({
                      loggingLevel: event.currentTarget.value as GlobalFormState['loggingLevel'],
                    })
                  }
                >
                  <option value="trace">trace</option>
                  <option value="debug">debug</option>
                  <option value="info">info</option>
                  <option value="warn">warn</option>
                  <option value="error">error</option>
                  <option value="fatal">fatal</option>
                </select>
              </div>
              <label
                class={`reader-check reader-manager-enabled${state.loggingConsoleEnabled ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  class="reader-check-input"
                  checked={state.loggingConsoleEnabled}
                  onChange={(event) =>
                    props.onChange({ loggingConsoleEnabled: event.currentTarget.checked })
                  }
                />
                <span class="reader-check-ui" />
                <span class="reader-check-copy">
                  <span class="reader-check-label">启用 console sink</span>
                </span>
              </label>
              <div class="field">
                <label htmlFor="config-global-logging-console-format">console.format</label>
                <select
                  id="config-global-logging-console-format"
                  class="input"
                  value={state.loggingConsoleFormat}
                  onChange={(event) =>
                    props.onChange({
                      loggingConsoleFormat: event.currentTarget
                        .value as GlobalFormState['loggingConsoleFormat'],
                    })
                  }
                >
                  <option value="pretty">pretty</option>
                  <option value="jsonl">jsonl</option>
                </select>
              </div>
              <label
                class={`reader-check reader-manager-enabled${state.loggingFileEnabled ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  class="reader-check-input"
                  checked={state.loggingFileEnabled}
                  onChange={(event) =>
                    props.onChange({ loggingFileEnabled: event.currentTarget.checked })
                  }
                />
                <span class="reader-check-ui" />
                <span class="reader-check-copy">
                  <span class="reader-check-label">启用 file sink</span>
                </span>
              </label>
              {state.loggingFileEnabled ? (
                <>
                  <div class="field">
                    <label htmlFor="config-global-logging-file-path">file.path</label>
                    <input
                      id="config-global-logging-file-path"
                      class="input"
                      value={state.loggingFilePath}
                      placeholder={placeholder(state.loggingFilePath, 'logs/app.jsonl')}
                      onInput={(event) =>
                        props.onChange({ loggingFilePath: event.currentTarget.value })
                      }
                    />
                  </div>
                  <div class="field">
                    <label htmlFor="config-global-logging-file-rotation-type">
                      file.rotation.type
                    </label>
                    <select
                      id="config-global-logging-file-rotation-type"
                      class="input"
                      value={state.loggingFileRotationType}
                      onChange={(event) =>
                        props.onChange({
                          loggingFileRotationType: event.currentTarget
                            .value as GlobalFormState['loggingFileRotationType'],
                        })
                      }
                    >
                      <option value="">none</option>
                      <option value="size">size</option>
                      <option value="time">time</option>
                    </select>
                  </div>
                  {state.loggingFileRotationType === 'size' ? (
                    <>
                      <div class="field">
                        <label htmlFor="config-global-logging-file-rotation-max-size">
                          file.rotation.maxSize
                        </label>
                        <input
                          id="config-global-logging-file-rotation-max-size"
                          class="input"
                          value={state.loggingFileRotationMaxSize}
                          onInput={(event) =>
                            props.onChange({
                              loggingFileRotationMaxSize: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <div class="field">
                        <label htmlFor="config-global-logging-file-rotation-max-files">
                          file.rotation.maxFiles
                        </label>
                        <input
                          id="config-global-logging-file-rotation-max-files"
                          class="input"
                          value={state.loggingFileRotationMaxFiles}
                          onInput={(event) =>
                            props.onChange({
                              loggingFileRotationMaxFiles: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                    </>
                  ) : null}
                  {state.loggingFileRotationType === 'time' ? (
                    <>
                      <div class="field">
                        <label htmlFor="config-global-logging-file-rotation-interval">
                          file.rotation.interval
                        </label>
                        <select
                          id="config-global-logging-file-rotation-interval"
                          class="input"
                          value={state.loggingFileRotationInterval}
                          onChange={(event) =>
                            props.onChange({
                              loggingFileRotationInterval: event.currentTarget
                                .value as GlobalFormState['loggingFileRotationInterval'],
                            })
                          }
                        >
                          <option value="">select</option>
                          <option value="hourly">hourly</option>
                          <option value="daily">daily</option>
                          <option value="weekly">weekly</option>
                        </select>
                      </div>
                      <div class="field">
                        <label htmlFor="config-global-logging-file-rotation-max-age">
                          file.rotation.maxAge
                        </label>
                        <input
                          id="config-global-logging-file-rotation-max-age"
                          class="input"
                          value={state.loggingFileRotationMaxAge}
                          onInput={(event) =>
                            props.onChange({ loggingFileRotationMaxAge: event.currentTarget.value })
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <div class="field reader-manager-wide">
              <label htmlFor="config-global-logging-json">logging (JSON)</label>
              <textarea
                id="config-global-logging-json"
                class="textarea"
                value={state.loggingJson}
                onInput={(event) => props.onChange({ loggingJson: event.currentTarget.value })}
              />
            </div>
          )}
        </div>
      </details>

      <details class="xq-section">
        <summary>
          <h2>ai</h2>
          <div class="segment-control">
            <label>
              <input
                type="radio"
                name="config-global-ai-mode"
                checked={state.aiMode === 'structured'}
                onChange={() => props.onChange({ aiMode: 'structured' })}
              />
              <span>结构化</span>
            </label>
            <label>
              <input
                type="radio"
                name="config-global-ai-mode"
                checked={state.aiMode === 'json'}
                onChange={() => props.onChange({ aiMode: 'json' })}
              />
              <span>JSON</span>
            </label>
          </div>
        </summary>
        <div
          class="panel"
          style={{ border: '0', borderTop: '1px solid var(--line)', borderRadius: '0 0 16px 16px' }}
        >
          {state.aiMode === 'structured' ? (
            <div class="reader-manager-grid">
              <div class="field reader-manager-wide">
                <label htmlFor="config-global-ai-default-model">ai.defaultModel</label>
                <input
                  id="config-global-ai-default-model"
                  class="input"
                  value={state.aiDefaultModel}
                  onInput={(event) => props.onChange({ aiDefaultModel: event.currentTarget.value })}
                />
              </div>
              <div class="field reader-manager-wide">
                <label htmlFor="config-global-ai-providers-json">ai.providers (JSON)</label>
                <textarea
                  id="config-global-ai-providers-json"
                  class="textarea"
                  value={state.aiProvidersJson}
                  onInput={(event) =>
                    props.onChange({ aiProvidersJson: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          ) : (
            <div class="field reader-manager-wide">
              <label htmlFor="config-global-ai-json">ai (JSON)</label>
              <textarea
                id="config-global-ai-json"
                class="textarea"
                value={state.aiJson}
                onInput={(event) => props.onChange({ aiJson: event.currentTarget.value })}
              />
            </div>
          )}
        </div>
      </details>

      <div class="toolbar reader-manager-actions">
        <button
          type="button"
          class="btn btn-primary"
          id="config-global-save"
          disabled={props.saving}
          onClick={props.onSave}
        >
          {props.saving ? '保存中…' : '保存 Global'}
        </button>
      </div>

      {props.message ? (
        <p
          id="config-global-message"
          class="reader-manager-message is-success"
        >
          {props.message}
        </p>
      ) : null}
      {props.error ? (
        <p
          id="config-global-error"
          class="reader-manager-message is-error"
        >
          {props.error}
        </p>
      ) : null}
    </section>
  )
}
