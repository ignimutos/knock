export function ResultPanel() {
  return (
    <section class="result-panel xq-result-panel">
      <div class="result-head">JSON 结果</div>
      <div
        class="panel"
        id="xq-running"
        hidden
      >
        运行中…
      </div>
      <section
        class="panel"
        id="xq-error"
        hidden
      >
        <h2>错误信息</h2>
        <pre
          class="result-pre result-pre-wrap"
          id="xq-error-message"
        />
      </section>
      <section
        class="panel"
        id="xq-warnings"
        hidden
      >
        <h2>警告</h2>
        <ul id="xq-warning-list" />
      </section>
      <section
        class="panel"
        id="xq-debug"
        hidden
      >
        <h2>调试信息</h2>
        <ul id="xq-debug-list" />
      </section>
      <details
        class="panel"
        id="xq-raw-panel"
      >
        <summary>原始响应内容</summary>
        <pre
          class="result-pre result-pre-wrap"
          id="xq-raw-content"
        >
          暂无原始响应内容
        </pre>
      </details>
      <section class="panel">
        <div class="toolbar xq-result-actions">
          <button
            type="button"
            class="btn btn-secondary"
            id="xq-expand-all"
          >
            全部展开
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            id="xq-collapse-all"
          >
            全部折叠
          </button>
        </div>
        <div
          id="xq-json-viewer"
          class="result-pre json-viewer"
        >
          <div class="json-line">{'{ "hint": "输入 URL 与表达式后点击运行" }'}</div>
        </div>
      </section>
    </section>
  )
}
