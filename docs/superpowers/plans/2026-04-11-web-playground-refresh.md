# Web Playground Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing `/xquery` playground UX and add a parallel `/syndication` playground with the same page rhythm, transport switch, result inspection, and scoped verification.

**Architecture:** Keep the current Fresh + Preact SSR structure, imperative inline page scripts, and thin API handlers. Reuse the existing app shell, result panel, API logging wrapper, and `fetchAndParseSource()` runtime, while keeping XQuery and syndication as separate pages and separate adapter modules.

**Tech Stack:** Deno, Fresh, Preact SSR, inline DOM scripts, Zod, existing `fetchAndParseSource()` runtime, Deno test, Prettier, Deno lint

---

## File Structure

### Existing files to modify

- `web/routes/_app.tsx`
  - Shared CSS for layout, sticky side rail, result panels, details/summary sections, segmented transport controls, wrapped error/raw text, and reduced-motion fallback.
- `web/components/layout/app_shell.tsx`
  - Top nav; add `/syndication` entry.
- `web/routes/index.tsx`
  - Landing page cards; add syndication playground card.
- `web/routes/index_test.ts`
  - SSR assertions for both playground entry points.
- `web/islands/xquery_form.tsx`
  - Add transport segmented control, collapsible sections, namespace header layout, and rename primary button to `运行`.
- `web/components/xquery/result_panel.tsx`
  - Add raw-content disclosure block and wrapped error/raw content containers.
- `web/routes/xquery.tsx`
  - Extend page script for transport payload, sticky centering logic, raw-content rendering, wrapped errors, and unchanged JSON tree controls.
- `src/web/xquery_playground.ts`
  - Accept `runtime`, construct `http` or `byparr`, and return `rawContent`.
- `src/web/xquery_playground_test.ts`
  - Cover native/byparr request conversion and raw content passthrough.
- `web/routes/api/xquery/evaluate.ts`
  - Pass through extended success shape without changing error shape.
- `web/routes/api/xquery/evaluate_test.ts`
  - Verify extended success shape and stable error contract.
- `web/main.ts`
  - Register `/syndication` and `/api/syndication/evaluate`.
- `web/main_test.ts`
  - Verify request logging for both playground API routes.
- `README.md`
  - Document `/syndication`, `/api/syndication/evaluate`, transport switch, and raw content viewer.

### New files to create

- `web/islands/syndication_form.tsx`
  - Left-side form for URL, transport segmented control, fill-default-template button, feed fields, entry fields, and reused right-side result rail.
- `web/routes/syndication.tsx`
  - SSR page and inline script for syndication playground.
- `web/routes/syndication_test.ts`
  - SSR assertions for syndication page structure and hooks.
- `src/web/syndication_playground.ts`
  - Syndication-specific request parsing, transport selection, source assembly, and runtime execution.
- `src/web/syndication_playground_test.ts`
  - Adapter tests for empty-input defaults, template fill behavior, runtime selection, and raw content return.
- `web/routes/api/syndication/evaluate.ts`
  - Thin API handler parallel to XQuery handler.
- `web/routes/api/syndication/evaluate_test.ts`
  - Success/error contract tests for syndication API.

## Execution Notes

- Keep one atomic feature branch.
- Do not introduce a generic playground abstraction.
- Keep XQuery and syndication forms separate.
- Keep current structured error response shape.
- Keep current inline-script style; do not introduce client state framework refactors.
- Reuse existing `ResultPanel` path for both pages in this change; do not rename directories unless required.

---

### Task 1: Add shared shell, navigation, and base styles

**Files:**

- Modify: `web/routes/_app.tsx`
- Modify: `web/components/layout/app_shell.tsx`
- Modify: `web/routes/index.tsx`
- Test: `web/routes/_app_test.tsx`
- Test: `web/routes/index_test.ts`

- [ ] **Step 1: Write the failing SSR tests for nav and landing page**

```ts
// web/routes/index_test.ts
Deno.test('web pages: 首页应包含 XQuery 与 Syndication Playground 入口', () => {
  const html = renderToString(IndexPage())
  assertStringIncludes(html, 'XQuery Playground')
  assertStringIncludes(html, 'Syndication Playground')
  assertStringIncludes(html, 'href="/xquery"')
  assertStringIncludes(html, 'href="/syndication"')
})
```

```ts
// web/routes/_app_test.tsx
Deno.test('web app: 应输出 details 与 rail 相关样式钩子', () => {
  const html = renderToString(App({ Component: IndexPage } as never))
  assertStringIncludes(html, '.xq-section')
  assertStringIncludes(html, '.segment-control')
  assertStringIncludes(html, '.result-pre-wrap')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
deno task test web/routes/index_test.ts web/routes/_app_test.tsx
```

Expected: FAIL because `/syndication` copy and the new CSS hooks do not exist yet.

- [ ] **Step 3: Update app shell and landing page**

```tsx
// web/components/layout/app_shell.tsx
<nav class="top-nav">
  <a
    href="/"
    class="nav-link"
  >
    首页
  </a>
  <a
    href="/xquery"
    class="nav-link"
  >
    XQuery
  </a>
  <a
    href="/syndication"
    class="nav-link"
  >
    Syndication
  </a>
  <label>
    <span class="sr-only">主题模式</span>
    <select
      class="theme-select js-theme-select"
      aria-label="主题模式"
    >
      <option value="system">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </select>
  </label>
</nav>
```

```tsx
// web/routes/index.tsx
<section class="card-grid">
  <article class="panel">
    <h2>XQuery Playground</h2>
    <p>
      在浏览器里快速验证 URL、定位表达式和映射逻辑，先得到结构化
      JSON，再决定是否写入正式 source 配置。
    </p>
    <a
      href="/xquery"
      class="cta-link"
    >
      进入 Playground →
    </a>
  </article>
  <article class="panel">
    <h2>Syndication Playground</h2>
    <p>
      直接预览 RSS / Atom / JSON Feed 的标准化结果，并调试 feed / entry
      字段映射。
    </p>
    <a
      href="/syndication"
      class="cta-link"
    >
      进入 Playground →
    </a>
  </article>
</section>
```

- [ ] **Step 4: Add shared styles for details, segmented controls, wrapped text, and sticky rail behavior**

```tsx
// web/routes/_app.tsx inside the shared style block
.xq-section {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
}
.xq-section > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  list-style: none;
  padding: 16px 18px;
}
.xq-section > summary::-webkit-details-marker { display: none; }
.segment-control {
  display: inline-flex;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel-strong);
  gap: 4px;
}
.segment-control input { position: absolute; opacity: 0; pointer-events: none; }
.segment-control label {
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--muted);
}
.segment-control input:checked + span {
  display: inline-flex;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--accent-strong);
  color: var(--btn-text);
}
.result-pre-wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.xq-side-rail {
  position: sticky;
  top: var(--xq-rail-top, 24px);
  transition: top .18s ease;
}
@media (prefers-reduced-motion: reduce) {
  .xq-side-rail { transition: none; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
deno task test web/routes/index_test.ts web/routes/_app_test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/routes/_app.tsx web/components/layout/app_shell.tsx web/routes/index.tsx web/routes/_app_test.tsx web/routes/index_test.ts
git commit -m "feat(web): add shared playground shell updates"
```

---

### Task 2: Upgrade XQuery page markup and result panel

**Files:**

- Modify: `web/islands/xquery_form.tsx`
- Modify: `web/components/xquery/result_panel.tsx`
- Test: `web/routes/xquery_test.ts`

- [ ] **Step 1: Write failing SSR tests for transport switch, disclosure sections, and raw panel**

```ts
// web/routes/xquery_test.ts
Deno.test('web pages: XQuery 页应包含 transport 分段按钮与原始内容区', () => {
  const html = renderToString(XqueryPage())
  assertStringIncludes(html, 'name="runtime"')
  assertStringIncludes(html, 'value="native"')
  assertStringIncludes(html, 'value="byparr"')
  assertStringIncludes(html, '原始响应内容')
  assertStringIncludes(html, 'class="xq-section"')
  assertStringIncludes(html, '>运行<')
})
```

- [ ] **Step 2: Run the failing XQuery SSR test**

Run:

```bash
deno task test web/routes/xquery_test.ts
```

Expected: FAIL because the new controls and copy are not rendered yet.

- [ ] **Step 3: Update XQuery form markup**

```tsx
// web/islands/xquery_form.tsx
<div class="field">
  <label htmlFor="url">目标 URL</label>
  <input id="url" name="url" type="url" placeholder="https://example.com/page.html" class="input" />
</div>
<div class="field" style={{ marginTop: '12px' }}>
  <span>抓取方式</span>
  <div class="segment-control" role="radiogroup" aria-label="抓取方式">
    <label>
      <input type="radio" name="runtime" value="native" checked />
      <span>native</span>
    </label>
    <label>
      <input type="radio" name="runtime" value="byparr" />
      <span>byparr</span>
    </label>
  </div>
</div>
<details class="xq-section" open>
  <summary>
    <span>命名空间</span>
    <button type="button" class="btn btn-secondary" id="xq-add-namespace">新增命名空间</button>
  </summary>
  <div class="panel" id="xq-namespaces-rows">...</div>
</details>
```

```tsx
// primary button text in xquery form
<button
  type="submit"
  class="btn btn-primary"
  id="xq-submit"
  form="xq-form"
>
  运行
</button>
```

- [ ] **Step 4: Extend the result panel with raw-content disclosure**

```tsx
// web/components/xquery/result_panel.tsx
<section class="panel" id="xq-error" hidden>
  <h2>错误信息</h2>
  <pre class="result-pre result-pre-wrap" id="xq-error-message" />
</section>
<details class="panel" id="xq-raw-panel" hidden>
  <summary>原始响应内容</summary>
  <pre class="result-pre result-pre-wrap" id="xq-raw-content" />
</details>
<section class="panel">
  <div class="toolbar xq-result-actions">
    <button type="button" class="btn btn-secondary" id="xq-expand-all">全部展开</button>
    <button type="button" class="btn btn-secondary" id="xq-collapse-all">全部折叠</button>
  </div>
  <div id="xq-json-viewer" class="result-pre json-viewer">
    <div class="json-line">{'{ "hint": "输入 URL 与表达式后点击运行" }'}</div>
  </div>
</section>
```

- [ ] **Step 5: Run the XQuery SSR test to verify it passes**

Run:

```bash
deno task test web/routes/xquery_test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/islands/xquery_form.tsx web/components/xquery/result_panel.tsx web/routes/xquery_test.ts
git commit -m "feat(web): refresh xquery form layout"
```

---

### Task 3: Add XQuery client behavior and backend transport/raw-content support

**Files:**

- Modify: `web/routes/xquery.tsx`
- Modify: `src/web/xquery_playground.ts`
- Modify: `web/routes/api/xquery/evaluate.ts`
- Test: `src/web/xquery_playground_test.ts`
- Test: `web/routes/api/xquery/evaluate_test.ts`

- [ ] **Step 1: Write failing adapter and API tests**

```ts
// src/web/xquery_playground_test.ts
Deno.test('xquery_playground: byparr 模式请求应转换为 byparr source', () => {
  const parsed = parsePlaygroundRequest({
    runtime: 'byparr',
    url: 'https://example.com/page.html',
    entry: { mode: 'mapping', fields: { id: 'string(@data-id)' } },
  })

  assertEquals(parsed.source.byparr?.url, 'https://example.com/page.html')
  assertEquals(parsed.source.http, undefined)
})
```

```ts
// web/routes/api/xquery/evaluate_test.ts
assertEquals(payload.rawContent, '<html></html>')
```

- [ ] **Step 2: Run the failing adapter and API tests**

Run:

```bash
deno task test src/web/xquery_playground_test.ts web/routes/api/xquery/evaluate_test.ts
```

Expected: FAIL because `runtime` and `rawContent` are not supported yet.

- [ ] **Step 3: Extend XQuery playground request parsing and success payload**

```ts
// src/web/xquery_playground.ts
const playgroundRequestSchema = z
  .object({
    runtime: z.enum(['native', 'byparr']).default('native'),
    url: z.string().url('url 配置非法'),
    headers: z.record(z.string(), z.string()).optional(),
    locate: z.string().optional(),
    namespaces: z.record(z.string(), z.string()).optional(),
    feed: playgroundSectionSchema.optional(),
    entry: playgroundSectionSchema,
  })
  .strict()

const source =
  request.runtime === 'byparr'
    ? {
        id: 'playground',
        enabled: true as const,
        deliveries: [] as [],
        byparr: parseWithFirstIssue(
          byparrSchema,
          { url: request.url },
          'byparr 配置非法',
        ),
        xquery,
      }
    : {
        id: 'playground',
        enabled: true as const,
        deliveries: [] as [],
        http,
        xquery,
      }

return {
  warnings: parsed.warnings,
  fetchMeta: {
    ok: true,
    payloadBytes: result.payload.length,
    fetchDurationMs: result.timing.fetchDurationMs,
    parseDurationMs: result.timing.parseDurationMs,
  },
  parser: result.parser,
  rawContent: result.payload,
  feed: result.feedMapped,
  entries: result.entries,
}
```

- [ ] **Step 4: Extend XQuery page script for transport, sticky rail, wrapped errors, and raw content**

```ts
// web/routes/xquery.tsx inside xqueryPageScript
const runtimeInputs = Array.from(form.querySelectorAll('input[name="runtime"]'))
const rawPanel = document.getElementById('xq-raw-panel')
const rawContent = document.getElementById('xq-raw-content')
const sideRail = document.querySelector('.xq-side-rail')

const getRuntime = () => {
  const active = runtimeInputs.find((input) => input instanceof HTMLInputElement && input.checked)
  return active instanceof HTMLInputElement && active.value === 'byparr' ? 'byparr' : 'native'
}

const syncRailTop = () => {
  if (!(sideRail instanceof HTMLElement)) return
  const viewportHeight = window.innerHeight
  const railHeight = sideRail.offsetHeight
  const nextTop = railHeight >= viewportHeight - 64 ? 24 : Math.max(24, Math.round((viewportHeight - railHeight) / 2))
  sideRail.style.setProperty('--xq-rail-top', `${nextTop}px`)
}

const renderRawContent = (value) => {
  if (!(rawPanel instanceof HTMLElement) || !(rawContent instanceof HTMLElement)) return
  if (typeof value !== 'string' || value === '') {
    rawPanel.hidden = true
    rawContent.textContent = ''
    return
  }
  rawPanel.hidden = false
  rawContent.textContent = value
}

const buildPayload = () => ({
  runtime: getRuntime(),
  url: ...,
  locate: ...,
  feed: buildSection('feed', getMode(feedModeInputs, 'structured')),
  entry: buildSection('entry', getMode(entryModeInputs, 'structured')),
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
deno task test src/web/xquery_playground_test.ts web/routes/api/xquery/evaluate_test.ts web/routes/xquery_test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/routes/xquery.tsx src/web/xquery_playground.ts web/routes/api/xquery/evaluate.ts src/web/xquery_playground_test.ts web/routes/api/xquery/evaluate_test.ts web/routes/xquery_test.ts
git commit -m "feat(web): add xquery transport and raw payload view"
```

---

### Task 4: Build syndication page, adapter, and API route

**Files:**

- Create: `web/islands/syndication_form.tsx`
- Create: `web/routes/syndication.tsx`
- Create: `web/routes/syndication_test.ts`
- Create: `src/web/syndication_playground.ts`
- Create: `src/web/syndication_playground_test.ts`
- Create: `web/routes/api/syndication/evaluate.ts`
- Create: `web/routes/api/syndication/evaluate_test.ts`
- Modify: `web/main.ts`
- Modify: `web/main_test.ts`

- [ ] **Step 1: Write the failing syndication SSR and adapter tests**

```ts
// web/routes/syndication_test.ts
Deno.test(
  'web pages: Syndication 页应包含 transport、填充按钮与结果面板',
  () => {
    const html = renderToString(SyndicationPage())
    assertStringIncludes(html, 'Syndication Playground')
    assertStringIncludes(html, '填充默认模板')
    assertStringIncludes(html, 'name="runtime"')
    assertStringIncludes(html, 'feed.title')
    assertStringIncludes(html, 'entry.id')
    assertStringIncludes(html, '原始响应内容')
  },
)
```

```ts
// src/web/syndication_playground_test.ts
Deno.test('syndication_playground: 空输入时应保留默认 mapping 行为', () => {
  const parsed = parseSyndicationPlaygroundRequest({
    runtime: 'native',
    url: 'https://example.com/feed.xml',
    feed: {},
    entry: {},
  })

  assertEquals(parsed.source.syndication, {})
})
```

- [ ] **Step 2: Run the failing syndication tests**

Run:

```bash
deno task test web/routes/syndication_test.ts src/web/syndication_playground_test.ts
```

Expected: FAIL because the page and adapter files do not exist yet.

- [ ] **Step 3: Create the syndication form and page**

```tsx
// web/islands/syndication_form.tsx
const FEED_FIELDS = [
  'title',
  'link',
  'description',
  'generator',
  'language',
  'published',
] as const
const ENTRY_FIELDS = [
  'id',
  'title',
  'link',
  'description',
  'content',
  'published',
  'updated',
] as const

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
            <div
              class="segment-control"
              role="radiogroup"
              aria-label="抓取方式"
            >
              ...
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
              <span>feed 映射</span>
            </summary>
            <div class="panel">...</div>
          </details>
          <details
            class="xq-section"
            open
          >
            <summary>
              <span>entry 映射</span>
            </summary>
            <div class="panel">...</div>
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
```

```tsx
// web/routes/syndication.tsx
export default function SyndicationPage() {
  return (
    <AppShell
      title="Syndication Playground"
      subtitle="输入目标 URL，预览规范化结果并调试标准字段映射。"
    >
      <SyndicationForm />
      <script dangerouslySetInnerHTML={{ __html: syndicationPageScript }} />
    </AppShell>
  )
}
```

- [ ] **Step 4: Create the syndication adapter and API handler**

```ts
// src/web/syndication_playground.ts
const requestSchema = z
  .object({
    runtime: z.enum(['native', 'byparr']).default('native'),
    url: z.string().url('url 配置非法'),
    feed: z.record(z.string(), z.string()).optional().default({}),
    entry: z.record(z.string(), z.string()).optional().default({}),
  })
  .strict()

export function parseSyndicationPlaygroundRequest(input: unknown) {
  const request = parseWithFirstIssue(
    requestSchema,
    input,
    'Playground 请求非法',
  )
  assertPlaygroundUrlAllowed(request.url)
  const mapping = {
    ...(Object.keys(request.feed).length > 0 ? { feed: request.feed } : {}),
    ...(Object.keys(request.entry).length > 0 ? { entry: request.entry } : {}),
  }
  return {
    source:
      request.runtime === 'byparr'
        ? {
            id: 'playground',
            enabled: true as const,
            deliveries: [] as [],
            byparr: parseWithFirstIssue(
              byparrSchema,
              { url: request.url },
              'byparr 配置非法',
            ),
            syndication: mapping,
          }
        : {
            id: 'playground',
            enabled: true as const,
            deliveries: [] as [],
            http: parseWithFirstIssue(
              sourceHttpSchema,
              { url: request.url },
              'http 配置非法',
            ),
            syndication: mapping,
          },
    warnings: [],
  }
}
```

```ts
// web/routes/api/syndication/evaluate.ts
import { classifyPlaygroundError } from '../../../../src/web/xquery_playground.ts'
import { evaluateSyndicationPlayground } from '../../../../src/web/syndication_playground.ts'

export const POST = async function handler(request: Request, deps: HandlerDeps = {}) {
  const runEvaluate = deps.evaluatePlayground ?? evaluateSyndicationPlayground
  ...
}
```

- [ ] **Step 5: Wire the new page and route into web main**

```ts
// web/main.ts
import SyndicationPage from './routes/syndication.tsx'
import { handler as evaluateSyndicationHandler } from './routes/api/syndication/evaluate.ts'

export const app = new App()
  .use(staticFiles())
  .get('/', () => renderPage(IndexPage))
  .get('/xquery', () => renderPage(XqueryPage))
  .get('/syndication', () => renderPage(SyndicationPage))
  .post(
    '/api/syndication/evaluate',
    withApiRequestLogging(
      '/api/syndication/evaluate',
      'web.api.syndication.evaluate',
      (request, onLogMeta) =>
        evaluateSyndicationHandler(request, { onLogMeta }),
    ),
  )
```

- [ ] **Step 6: Run syndication tests to verify they pass**

Run:

```bash
deno task test web/routes/syndication_test.ts src/web/syndication_playground_test.ts web/routes/api/syndication/evaluate_test.ts web/main_test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/islands/syndication_form.tsx web/routes/syndication.tsx web/routes/syndication_test.ts src/web/syndication_playground.ts src/web/syndication_playground_test.ts web/routes/api/syndication/evaluate.ts web/routes/api/syndication/evaluate_test.ts web/main.ts web/main_test.ts
git commit -m "feat(web): add syndication playground"
```

---

### Task 5: Finish docs and full scoped verification

**Files:**

- Modify: `README.md`
- Test: `web/routes/index_test.ts`
- Test: `web/routes/xquery_test.ts`
- Test: `web/routes/syndication_test.ts`
- Test: `src/web/xquery_playground_test.ts`
- Test: `src/web/syndication_playground_test.ts`
- Test: `web/routes/api/xquery/evaluate_test.ts`
- Test: `web/routes/api/syndication/evaluate_test.ts`
- Test: `web/main_test.ts`

- [ ] **Step 1: Write the failing README assertions mentally and update docs**

```md
## Web Playground

- 首页：`/`
- XQuery Playground：`/xquery`
- Syndication Playground：`/syndication`
- XQuery API：`/api/xquery/evaluate`
- Syndication API：`/api/syndication/evaluate`

说明：

- 两个 playground 都支持 `native / byparr` 抓取方式切换。
- XQuery 结果区支持查看原始响应内容。
- Syndication 页面可在保留默认解析行为的前提下，一键填充标准字段模板。
```

- [ ] **Step 2: Run the complete scoped test suite**

Run:

```bash
deno task test src/web/xquery_playground_test.ts src/web/syndication_playground_test.ts web/routes/api/xquery/evaluate_test.ts web/routes/api/syndication/evaluate_test.ts web/routes/xquery_test.ts web/routes/syndication_test.ts web/routes/index_test.ts web/main_test.ts
```

Expected: PASS

- [ ] **Step 3: Run scoped static verification**

Run:

```bash
deno task check web src/web
```

Expected: PASS

Run:

```bash
deno task lint:check web src/web README.md
```

Expected: PASS

Run:

```bash
deno task fmt:check web src/web README.md
```

Expected: PASS

- [ ] **Step 4: Start the local web app and manually verify both pages**

Run:

```bash
deno task web
```

Manual checks:

- `/xquery`
  - transport segmented control switches request payload
  - namespace/feed/entry sections collapse and expand
  - right rail centers when shorter than viewport and falls back when taller
  - long error text wraps and remains scrollable
  - raw content panel stays collapsed by default and expands correctly
- `/syndication`
  - empty form still allows runtime-default parsing
  - `填充默认模板` fills feed + entry standard fields
  - transport segmented control switches request payload
  - JSON result and raw content render correctly

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(web): document updated playground flows"
```

---

## Self-Review

### Spec coverage

- XQuery right rail float + buffered animation: covered in Task 1 styles and Task 3 script.
- XQuery namespace/feed/entry collapsible UI: covered in Task 2.
- Namespace header button alignment: covered in Task 2.
- XQuery long error wrapping: covered in Task 2 and Task 3.
- XQuery raw URL content box: covered in Task 2 and Task 3.
- XQuery native/byparr switch: covered in Task 2 and Task 3.
- New syndication playground mirroring page rhythm: covered in Task 4.
- Syndication default-empty + one-click template fill behavior: covered in Task 4.
- Docs and verification: covered in Task 5.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to above” placeholders remain.
- Every created/modified file is named explicitly.
- Every task has concrete commands and expected pass/fail state.

### Type consistency

- XQuery path uses `runtime: 'native' | 'byparr'` in page, adapter, and tests.
- Syndication path uses the same `runtime` vocabulary.
- Both APIs keep the same structured error envelope shape: `message`, `code`, `category`.
- Both success payloads include `warnings`, `fetchMeta`, `parser`, `rawContent`, `feed`, `entries`.

Plan complete and saved to `docs/superpowers/plans/2026-04-11-web-playground-refresh.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
