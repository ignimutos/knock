import { useMemo, useState } from 'preact/hooks'
import type { ConfigWorkbenchOverview, ReaderOverview } from '../../src/contracts/workbench.ts'

import { createDraftDelivery, type DeliveryDraft } from './config_workbench_state.ts'
import {
  buildDeliveryPayload,
  buildGlobalPayload,
  buildSourcePayload,
  createDeliveryFormState,
  createGlobalFormState,
  createSourceFormState,
  type SourceFormState,
} from '../components/config/form_state.ts'
import { DeliveryForm } from '../components/config/delivery_form.tsx'
import { GlobalPanel } from '../components/config/global_panel.tsx'
import { SourceManager } from '../components/config/source_manager.tsx'

interface ConfigActionSuccessResult {
  message: string
  workbench: ConfigWorkbenchOverview
}

interface SourceActionSuccessResult {
  message: string
  overview: ReaderOverview
}

function formatDeliveryKinds(kinds: readonly string[] | undefined): string {
  return Array.isArray(kinds) && kinds.length > 0 ? kinds.join(' · ') : '无投递'
}

function defaultSourceFileOverride(): string {
  return '{{ entry.title }}'
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof body.message === 'string' ? body.message : '请求失败')
  }
  return body as T
}

export default function ConfigWorkbench(props: { workbench: ConfigWorkbenchOverview }) {
  const [workbench, setWorkbench] = useState(props.workbench)
  const [selectedSourceId, setSelectedSourceId] = useState(
    props.workbench.reader.sources[0]?.id ?? '',
  )
  const [selectedDeliveryId, setSelectedDeliveryId] = useState(
    props.workbench.deliveries[0]?.id ?? '',
  )
  const [draftDelivery, setDraftDelivery] = useState<DeliveryDraft | null>(
    props.workbench.deliveries.length === 0 ? createDraftDelivery() : null,
  )
  const [globalState, setGlobalState] = useState(() =>
    createGlobalFormState(props.workbench.global),
  )
  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalMessage, setGlobalMessage] = useState('')
  const [globalError, setGlobalError] = useState('')
  const [deliveryState, setDeliveryState] = useState(() =>
    createDeliveryFormState(
      draftDelivery ?? props.workbench.deliveries[0] ?? createDraftDelivery(),
    ),
  )
  const [deliverySaving, setDeliverySaving] = useState(false)
  const [deliveryDeleting, setDeliveryDeleting] = useState(false)
  const [deliveryMessage, setDeliveryMessage] = useState('')
  const [deliveryError, setDeliveryError] = useState('')
  const [sourceStates, setSourceStates] = useState<Record<string, SourceFormState>>(() =>
    Object.fromEntries(
      props.workbench.reader.sources.map((source) => [source.id, createSourceFormState(source)]),
    ),
  )
  const [sourceSaving, setSourceSaving] = useState(false)
  const [sourceMessage, setSourceMessage] = useState('')
  const [sourceError, setSourceError] = useState('')

  const selectedSource = useMemo(
    () =>
      workbench.reader.sources.find((source) => source.id === selectedSourceId) ??
      workbench.reader.sources[0],
    [selectedSourceId, workbench.reader.sources],
  )
  const selectedDelivery = useMemo(
    () =>
      draftDelivery ??
      workbench.deliveries.find((delivery) => delivery.id === selectedDeliveryId) ??
      workbench.deliveries[0],
    [draftDelivery, selectedDeliveryId, workbench.deliveries],
  )
  const selectedSourceState = selectedSource
    ? (sourceStates[selectedSource.id] ?? createSourceFormState(selectedSource))
    : undefined

  function applyWorkbench(
    next: ConfigWorkbenchOverview,
    preferredSourceId?: string,
    preferredDeliveryId?: string,
  ) {
    setWorkbench(next)
    setDraftDelivery(null)
    setGlobalState(createGlobalFormState(next.global))
    setSourceStates(
      Object.fromEntries(
        next.reader.sources.map((source) => [source.id, createSourceFormState(source)]),
      ),
    )
    const nextSource =
      next.reader.sources.find((source) => source.id === preferredSourceId) ??
      next.reader.sources[0]
    const nextDelivery =
      next.deliveries.find((delivery) => delivery.id === preferredDeliveryId) ?? next.deliveries[0]
    setSelectedSourceId(nextSource?.id ?? '')
    setSelectedDeliveryId(nextDelivery?.id ?? '')
    setDeliveryState(createDeliveryFormState(nextDelivery ?? createDraftDelivery()))
  }

  function applyOverview(nextOverview: ReaderOverview, preferredSourceId?: string) {
    const next = { ...workbench, reader: nextOverview }
    setWorkbench(next)
    setSourceStates(
      Object.fromEntries(
        nextOverview.sources.map((source) => [source.id, createSourceFormState(source)]),
      ),
    )
    const nextSource =
      nextOverview.sources.find((source) => source.id === preferredSourceId) ??
      nextOverview.sources[0]
    setSelectedSourceId(nextSource?.id ?? '')
  }

  async function saveGlobal() {
    setGlobalSaving(true)
    setGlobalMessage('')
    setGlobalError('')
    try {
      const result = await postJson<ConfigActionSuccessResult>(
        '/api/config/global',
        buildGlobalPayload(globalState),
      )
      applyWorkbench(
        result.workbench,
        selectedSource?.id,
        draftDelivery ? undefined : selectedDelivery?.id,
      )
      setGlobalMessage(result.message)
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setGlobalSaving(false)
    }
  }

  async function saveDelivery() {
    setDeliverySaving(true)
    setDeliveryMessage('')
    setDeliveryError('')
    try {
      if (deliveryState.id.trim() === '') throw new Error('deliveryId 不能为空')
      const result = await postJson<ConfigActionSuccessResult>(
        '/api/config/deliveries',
        buildDeliveryPayload(deliveryState),
      )
      applyWorkbench(result.workbench, selectedSource?.id, deliveryState.id)
      setDeliveryMessage(result.message)
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setDeliverySaving(false)
    }
  }

  async function deleteDelivery() {
    if (!selectedDelivery || draftDelivery) return
    setDeliveryDeleting(true)
    setDeliveryMessage('')
    setDeliveryError('')
    try {
      const result = await postJson<ConfigActionSuccessResult>('/api/config/deliveries/delete', {
        deliveryId: selectedDelivery.id,
      })
      applyWorkbench(result.workbench, selectedSource?.id)
      setDeliveryMessage(result.message)
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeliveryDeleting(false)
    }
  }

  async function saveSource() {
    if (!selectedSourceState) return
    setSourceSaving(true)
    setSourceMessage('')
    setSourceError('')
    try {
      const result = await postJson<SourceActionSuccessResult>(
        '/api/sources/update',
        buildSourcePayload(selectedSourceState, workbench.reader.deliveries),
      )
      applyOverview(result.overview, selectedSourceState.id)
      setSourceMessage(result.message)
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSourceSaving(false)
    }
  }

  return (
    <>
      <GlobalPanel
        state={globalState}
        saving={globalSaving}
        message={globalMessage}
        error={globalError}
        onChange={(patch) => setGlobalState((current) => ({ ...current, ...patch }))}
        onSave={saveGlobal}
      />

      <section class="reader-layout">
        <aside class="panel reader-sidebar config-sidebar-panel">
          <div class="reader-sidebar-head">
            <div>
              <p class="reader-kicker">canonical deliveries</p>
              <p class="reader-sidebar-copy">左栏切换 delivery，右侧编辑 canonical config。</p>
            </div>
            <p class="reader-summary-text">{workbench.deliveries.length} 个 delivery</p>
          </div>
          <div
            id="config-delivery-list"
            class="reader-source-list"
            role="listbox"
            aria-label="Delivery 列表"
          >
            {workbench.deliveries.map((delivery) => (
              <button
                key={delivery.id}
                type="button"
                class={`reader-source-button${!draftDelivery && selectedDelivery?.id === delivery.id ? ' is-active' : ''}`}
                aria-selected={
                  !draftDelivery && selectedDelivery?.id === delivery.id ? 'true' : 'false'
                }
                onClick={() => {
                  setDraftDelivery(null)
                  setSelectedDeliveryId(delivery.id)
                  setDeliveryState(createDeliveryFormState(delivery))
                  setDeliveryMessage('')
                  setDeliveryError('')
                }}
              >
                <span class="reader-source-headline">
                  <span class="reader-source-name">{delivery.id}</span>
                  <span
                    class={`reader-state-badge is-${delivery.enabled ? 'enabled' : 'disabled'}`}
                  >
                    {delivery.enabled ? '启用' : '停用'}
                  </span>
                </span>
                <span class="reader-source-meta">
                  <span>{delivery.kind}</span>
                  <span>canonical</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              class={`reader-source-button${draftDelivery ? ' is-active' : ''}`}
              id="config-delivery-create"
              onClick={() => {
                const draft = createDraftDelivery()
                setDraftDelivery(draft)
                setDeliveryState(createDeliveryFormState(draft))
                setDeliveryMessage('')
                setDeliveryError('')
              }}
            >
              <span class="reader-source-headline">
                <span class="reader-source-name">新增 delivery</span>
              </span>
              <span class="reader-source-meta">
                <span>create</span>
                <span>canonical</span>
              </span>
            </button>
          </div>
        </aside>

        <section class="reader-main-column">
          <DeliveryForm
            state={deliveryState}
            saving={deliverySaving}
            deleting={deliveryDeleting}
            message={deliveryMessage}
            error={deliveryError}
            canDelete={!draftDelivery}
            onChange={(patch) => setDeliveryState((current) => ({ ...current, ...patch }))}
            onSave={saveDelivery}
            onDelete={deleteDelivery}
          />
        </section>
      </section>

      <section class="reader-layout">
        <aside class="panel reader-sidebar config-sidebar-panel">
          <div class="reader-sidebar-head">
            <div>
              <p class="reader-kicker">sources</p>
              <p class="reader-sidebar-copy">
                左栏切换 source，右侧集中编辑 source 子树与 override。
              </p>
            </div>
            <p class="reader-summary-text">{workbench.reader.sources.length} 个 source</p>
          </div>
          <div
            id="config-source-list"
            class="reader-source-list"
            role="listbox"
            aria-label="Source 列表"
          >
            {workbench.reader.sources.map((source) => (
              <button
                key={source.id}
                type="button"
                class={`reader-source-button${selectedSource?.id === source.id ? ' is-active' : ''}`}
                aria-selected={selectedSource?.id === source.id ? 'true' : 'false'}
                onClick={() => {
                  setSelectedSourceId(source.id)
                  setSourceMessage('')
                  setSourceError('')
                }}
              >
                <span class="reader-source-headline">
                  <span class="reader-source-name">{source.name || source.id}</span>
                  <span class={`reader-state-badge is-${source.enabled ? 'enabled' : 'disabled'}`}>
                    {source.enabled ? '启用' : '停用'}
                  </span>
                </span>
                <span class="reader-source-meta">
                  <span>{source.parser}</span>
                  <span>{source.transport}</span>
                  <span>{formatDeliveryKinds(source.deliveryKinds)}</span>
                </span>
              </button>
            ))}
          </div>
          <a
            href="/reader"
            class="reader-link"
          >
            返回 Reader
          </a>
        </aside>

        <section class="reader-main-column">
          <SourceManager
            source={selectedSourceState}
            allDeliveries={workbench.reader.deliveries}
            saving={sourceSaving}
            message={sourceMessage}
            error={sourceError}
            onChange={(patch) => {
              if (!selectedSourceState) return
              setSourceStates((current) => ({
                ...current,
                [selectedSourceState.id]: { ...selectedSourceState, ...patch },
              }))
            }}
            onToggleDelivery={(deliveryId, checked) => {
              if (!selectedSourceState) return
              const nextDeliveryIds = checked
                ? [...selectedSourceState.deliveryIds, deliveryId]
                : selectedSourceState.deliveryIds.filter((id) => id !== deliveryId)
              const deliveryKind = workbench.reader.deliveries.find(
                (delivery) => delivery.id === deliveryId,
              )?.kind
              const nextOverride =
                checked &&
                deliveryKind === 'file' &&
                (selectedSourceState.deliveryOverrides[deliveryId] ?? '').trim() === ''
                  ? defaultSourceFileOverride()
                  : selectedSourceState.deliveryOverrides[deliveryId]
              setSourceStates((current) => ({
                ...current,
                [selectedSourceState.id]: {
                  ...selectedSourceState,
                  deliveryIds: nextDeliveryIds,
                  deliveryOverrides: {
                    ...selectedSourceState.deliveryOverrides,
                    ...(checked ? { [deliveryId]: nextOverride ?? '' } : {}),
                  },
                },
              }))
            }}
            onOverrideChange={(deliveryId, value) => {
              if (!selectedSourceState) return
              setSourceStates((current) => ({
                ...current,
                [selectedSourceState.id]: {
                  ...selectedSourceState,
                  deliveryOverrides: {
                    ...selectedSourceState.deliveryOverrides,
                    [deliveryId]: value,
                  },
                },
              }))
            }}
            onSave={saveSource}
          />
        </section>
      </section>
    </>
  )
}
