/**
 * Understudy — WebMCP observation, teaching and operation SDK. Shared,
 * governed execution additionally requires a host store/enforcement adapter.
 *
 * Add <script src="/understudy.js"></script> to a page and call
 * Understudy.init(). The page gains:
 *  - an action journal of what the human does,
 *  - a side panel where the agent drafts a process map the human can edit,
 *  - a WebMCP toolset so an agent (ChatGPT, Chrome) can read the work,
 *    structure it into a process, ask questions, and request host actions.
 */
import { record } from './journal'
import { startCapture } from './capture'
import { mountPanel, openPanel, closePanel, openUsageGuide, getInteractionState } from './panel'
import { registerWebmcpTools } from './tools'
import * as host from './host'
import { loadSavedMap, reopenAsDraft, recordActionSuccess, restoreRunState, getMap, clearMap, pendingDecision, progress as progressOf, humanToggleStepDone, getCompletionError, reportProblem as reportProblemOn, subscribe as subscribeMap } from './mapstore'
import { startRunTracking, stopRunTracking, resumeRunTracking, currentRunId, isRunComplete, isRunStarting, getRunStartError, getRunSyncError, flushRun, refreshRunState } from './runsync'
import type { HostAction, InitOptions, ProcessMap } from './types'

let initialized = false

function init(opts: InitOptions = {}): void {
  if (initialized) return
  initialized = true
  if (opts.appName) host.setAppName(opts.appName)
  if (opts.stateProvider) host.setStateProvider(opts.stateProvider)
  if (opts.processStore) host.setProcessStore(opts.processStore)
  if (opts.branchResolver) host.setBranchResolver(opts.branchResolver)
  for (const action of opts.actions ?? []) host.registerAction(action)

  const boot = () => {
    mountPanel(opts.panelInitiallyCollapsed)
    const mode = opts.autoCapture ?? 'full'
    if (mode !== 'off') startCapture(mode)
    registerWebmcpTools()
    record('user', 'navigate', `opened ${host.getAppName()}`)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
}

/** Semantic logging for host apps that want richer journal entries than auto-capture. */
function log(label: string, detail?: unknown): void {
  record('user', 'app', label, detail)
}

function registerAction(action: HostAction): void {
  host.registerAction(action)
}

/** Host apps can push a saved process into the panel (e.g. from a process-list screen).
 *  Pass meta.resume to reattach an existing run's progress instead of starting fresh. */
function loadProcess(
  map: ProcessMap,
  meta?: {
    id?: string
    createdBy?: string
    resume?: { runId: string; steps?: unknown[]; decisions?: unknown[]; events?: ProcessMap['events'] }
  },
): void {
  loadSavedMap(map, meta?.resume ? { ...meta, quiet: true } : meta)
  if (meta?.resume?.runId) {
    const applied = restoreRunState((meta.resume.steps ?? []) as never, meta.resume.decisions, meta.resume.events)
    resumeRunTracking(meta.resume.runId)
    record(
      'user',
      'map',
      `resumed "${map.title}" — run ${meta.resume.runId} reattached, ${applied} completed step(s) restored`,
    )
  } else if (meta?.id) {
    startRunTracking(meta.id)
  }
}

/** Host apps can clear the panel entirely (e.g. after a demo-data reset). */
function unloadProcess(): void {
  stopRunTracking()
  clearMap('user')
}

function draftRevision(map: ProcessMap, sourceId: string): void {
  stopRunTracking()
  loadSavedMap(map, {id: sourceId, quiet: true})
  reopenAsDraft()
  openPanel()
}

/** Host apps report a successful semantic action (e.g. the human saved a form),
 *  so the matching step of a loaded process auto-completes. Call only on success. */
function notifyAction(name: string, resultId?: string): void {
  recordActionSuccess(name, resultId, 'user')
}

/** Host apps can read the currently loaded/drafted map (e.g. to render its data-contract fields). */
function getLoadedProcess(): ProcessMap | null {
  return getMap()
}

/** Host worklists complete a step through the same role/order-guarded lane as the panel checkbox. */
function completeStep(stepId: string, values?: Record<string, unknown>): { ok: boolean; error?: string } {
  const map = getMap()
  if (!map?.confirmed) return { ok: false, error: 'Confirm and run a playbook before completing its tasks.' }
  if (host.getProcessStore()?.startRun && !currentRunId())
    return { ok: false, error: 'Start a run before entering task results.' }
  if (map.steps.find((s) => s.id === stepId)?.done) return { ok: false, error: 'This task is already complete.' }
  const ok = humanToggleStepDone(stepId, values)
  return { ok, ...(ok ? {} : { error: getCompletionError() ?? 'This task could not complete. Check its required inputs, role and pass criteria in the playbook.' }) }
}

/** Host worklists flag a blocked step; journaled for the agent and the team. */
function reportProblem(stepId: string, note: string): void {
  reportProblemOn(stepId, note)
}

/** Live per-step status for host-side worklists ('what is next, and whose is it'). */
function getProgress(): Array<{ id: string; label: string; type: string; role?: string; status?: string; done?: boolean }> {
  const m = getMap()
  if (!m || !m.confirmed) return []
  const statuses = progressOf()
  return m.steps.map((s) => ({
    id: s.id,
    label: s.label,
    type: s.type,
    role: s.role,
    fields: s.fields,
    status: statuses.get(s.id),
    done: s.done,
  }))
}

// Let host apps react to map changes (dynamic field forms, etc.).
subscribeMap(() => {
  try {
    window.dispatchEvent(new CustomEvent('understudy:mapchange'))
  } catch {
    /* ignore */
  }
})

// An unconfirmed draft is interview work in progress — warn before it is lost.
window.addEventListener('beforeunload', (e) => {
  const m = getMap()
  if (m && !m.confirmed && m.steps.length > 0) {
    e.preventDefault()
  }
})

;(window as any).Understudy = {
  init,
  log,
  registerAction,
  loadProcess,
  draftRevision,
  unloadProcess,
  notifyAction,
  getLoadedProcess,
  getProgress,
  completeStep,
  reportProblem,
  currentRunId,
  getRunStartError,
  getRunSyncError,
  flushRun,
  refreshRunState,
  isRunComplete,
  isRunStarting,
  openPanel,
  closePanel,
  openUsageGuide,
  getInteractionState,
  getPendingDecision: () => pendingDecision(),
}
