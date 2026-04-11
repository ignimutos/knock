import { ResultPanel } from '../components/xquery/result_panel.tsx'

const FEED_FIELDS = ['title', 'link', 'description', 'generator', 'language', 'published'] as const
const ENTRY_FIELDS = [
  'id',
  'title',
  'link',
  'description',
  'content',
  'published',
  'updated',
] as const

function SectionModeSwitch(props: { prefix: 'feed' | 'entry' }) {
  return (
    <div class="segment-control">
      <label>
        <input
          type="radio"
          name={`${props.prefix}-mode`}
          value="structured"
          checked
        />
        <span>结构化</span>
      </label>
      <label>
        <input
          type="radio"
          name={`${props.prefix}-mode`}
          value="script"
        />
        <span>脚本</span>
      </label>
    </div>
  )
}

function StructuredFields(props: {
  prefix: 'feed' | 'entry'
  fields: readonly string[]
  requiredKey?: string
}) {
  return (
    <div data-mode-group={`${props.prefix}-structured`}>
      {props.fields.map((field) => (
        <div
          class="field"
          style={{ marginTop: '10px' }}
        >
          <label htmlFor={`${props.prefix}-${field}`}>
            {props.prefix}.{field}
            {props.requiredKey === field ? '（必填）' : ''}
          </label>
          <input
            id={`${props.prefix}-${field}`}
            name={`${props.prefix}-field-${field}`}
            class="input"
            placeholder={`string(${field})`}
          />
        </div>
      ))}
    </div>
  )
}

function ScriptField(props: { prefix: 'feed' | 'entry' }) {
  return (
    <div
      data-mode-group={`${props.prefix}-script`}
      hidden
    >
      <div
        class="field"
        style={{ marginTop: '10px' }}
      >
        <label htmlFor={`${props.prefix}-script`}>{props.prefix} 脚本</label>
        <textarea
          id={`${props.prefix}-script`}
          name={`${props.prefix}-script`}
          class="textarea"
          placeholder="map {\n  'id': string(@data-id)\n}"
        />
      </div>
    </div>
  )
}

export function XqueryForm() {
  return (
    <section class="xq-grid xq-layout">
      <div class="xq-main-column">
        <form
          class="panel"
          id="xq-form"
        >
          <div class="field">
            <label htmlFor="url">目标 URL</label>
            <input
              id="url"
              name="url"
              type="url"
              placeholder="https://example.com/page.html"
              class="input"
            />
          </div>

          <div
            class="toolbar"
            style={{ marginTop: '12px' }}
          >
            <div class="segment-control">
              <label>
                <input
                  type="radio"
                  name="runtime"
                  value="native"
                  checked
                />
                <span>native</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="runtime"
                  value="byparr"
                />
                <span>byparr</span>
              </label>
            </div>
          </div>

          <div
            class="field"
            style={{ marginTop: '12px' }}
          >
            <label htmlFor="locate">定位表达式（可选）</label>
            <input
              id="locate"
              name="locate"
              placeholder="//article"
              class="input"
            />
          </div>

          <details
            class="xq-section"
            open
          >
            <summary>
              <div>
                <h2>命名空间</h2>
                <p>为页面中的命名节点声明前缀，便于后续表达式引用。</p>
              </div>
              <button
                type="button"
                class="btn btn-secondary"
                id="xq-add-namespace"
              >
                新增命名空间
              </button>
            </summary>
            <div
              class="panel"
              style={{
                border: '0',
                borderTop: '1px solid var(--line)',
                borderRadius: '0 0 16px 16px',
              }}
            >
              <div id="xq-namespaces-rows">
                <div
                  class="toolbar"
                  data-ns-row="1"
                >
                  <input
                    class="input"
                    name="ns-prefix-1"
                    placeholder="prefix"
                  />
                  <input
                    class="input"
                    name="ns-uri-1"
                    placeholder="https://www.w3.org/..."
                  />
                  <button
                    type="button"
                    class="btn btn-secondary"
                    data-ns-remove
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </details>

          <details
            class="xq-section"
            open
          >
            <summary>
              <h2>feed 提取</h2>
              <SectionModeSwitch prefix="feed" />
            </summary>
            <div
              class="panel"
              style={{
                border: '0',
                borderTop: '1px solid var(--line)',
                borderRadius: '0 0 16px 16px',
              }}
            >
              <StructuredFields
                prefix="feed"
                fields={FEED_FIELDS}
              />
              <ScriptField prefix="feed" />
            </div>
          </details>

          <details
            class="xq-section"
            open
          >
            <summary>
              <h2>entry 提取</h2>
              <SectionModeSwitch prefix="entry" />
            </summary>
            <div
              class="panel"
              style={{
                border: '0',
                borderTop: '1px solid var(--line)',
                borderRadius: '0 0 16px 16px',
              }}
            >
              <StructuredFields
                prefix="entry"
                fields={ENTRY_FIELDS}
                requiredKey="id"
              />
              <ScriptField prefix="entry" />
            </div>
          </details>
        </form>
      </div>
      <div class="xq-side-column">
        <div class="panel xq-side-rail">
          <button
            type="submit"
            class="btn btn-primary"
            id="xq-submit"
            form="xq-form"
          >
            运行
          </button>
          <span class="badge">预览模式</span>
          <p class="xq-side-note">仅用于临时抓取与结果预览，不会写入正式配置</p>
          <ResultPanel />
        </div>
      </div>
    </section>
  )
}
