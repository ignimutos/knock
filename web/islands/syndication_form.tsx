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

function StandardFields(props: {
  prefix: 'feed' | 'entry'
  fields: readonly string[]
  placeholders: Partial<Record<string, string>>
}) {
  return (
    <div>
      {props.fields.map((field) => (
        <div
          class="field"
          style={{ marginTop: '10px' }}
        >
          <label htmlFor={`syn-${props.prefix}-${field}`}>
            {props.prefix}.{field}
          </label>
          <input
            id={`syn-${props.prefix}-${field}`}
            name={`${props.prefix}-field-${field}`}
            class="input"
            placeholder={props.placeholders[field] ?? `{{ ${field} }}`}
          />
        </div>
      ))}
    </div>
  )
}

export function SyndicationForm() {
  return (
    <section class="xq-grid xq-layout">
      <div class="xq-main-column">
        <form
          class="panel"
          id="syn-form"
        >
          <div class="field">
            <label htmlFor="syn-url">目标 URL</label>
            <input
              id="syn-url"
              name="url"
              type="url"
              class="input"
              placeholder="https://example.com/feed.xml"
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
            <button
              type="button"
              class="btn btn-secondary"
              id="syn-fill-defaults"
            >
              填充默认模板
            </button>
          </div>

          <details
            class="xq-section"
            open
          >
            <summary>
              <div>
                <h2>feed 标准字段</h2>
                <p>为空时保留 syndication runtime 默认映射；可按需覆盖标准字段模板。</p>
              </div>
            </summary>
            <div
              class="panel"
              style={{
                border: '0',
                borderTop: '1px solid var(--line)',
                borderRadius: '0 0 16px 16px',
              }}
            >
              <StandardFields
                prefix="feed"
                fields={FEED_FIELDS}
                placeholders={{
                  title: '{{ title }}',
                  link: '{{ link }}',
                  description: '{{ description }}',
                  generator: '{{ generator }}',
                  language: '{{ language }}',
                  published: '{{ published }}',
                }}
              />
            </div>
          </details>

          <details
            class="xq-section"
            open
          >
            <summary>
              <div>
                <h2>entry 标准字段</h2>
                <p>使用 Liquid 模板快速验证 entry 标准字段输出。</p>
              </div>
            </summary>
            <div
              class="panel"
              style={{
                border: '0',
                borderTop: '1px solid var(--line)',
                borderRadius: '0 0 16px 16px',
              }}
            >
              <StandardFields
                prefix="entry"
                fields={ENTRY_FIELDS}
                placeholders={{
                  id: '{{ id }}',
                  title: '{{ title }}',
                  link: '{{ link }}',
                  description: '{{ description }}',
                  content: '{{ content }}',
                  published: '{{ published }}',
                  updated: '{{ updated }}',
                }}
              />
            </div>
          </details>
        </form>
      </div>
      <div class="xq-side-column">
        <div class="panel xq-side-rail">
          <button
            type="submit"
            class="btn btn-primary"
            id="syn-submit"
            form="syn-form"
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
