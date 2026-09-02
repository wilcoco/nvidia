/**
 * Understudy — drop-in WebMCP layer that turns any web work-app into an
 * agent-readable, agent-operable workspace.
 *
 * Add <script src="/understudy.js"></script> to a page and call
 * Understudy.init(). The page gains:
 *  - an action journal of what the human does,
 *  - a side panel where the agent drafts a process map the human can edit,
 *  - a WebMCP toolset so an agent (ChatGPT, Chrome) can read the work,
 *    structure it into a process, ask questions, and replay the process.
 */
import { record } from './journal'
import { startCapture } from './capture'
import { mountPanel } from './panel'
import { registerWebmcpTools } from './tools'
import * as host from './host'
import { loadSavedMap, recordActionSuccess, restoreRunState, getMap, clearMap, progress as progressOf, humanToggleStepDone, subscribe as subscribeMap } from './mapstore'
import { startRunTracking, stopRunTracking, resumeRunTracking, currentRunId } from './runsync'
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
    mountPanel()
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
    resume?: { runId: string; steps?: unknown[]; decisions?: unknown[] }
  },
): void {
  loadSavedMap(map, meta?.resume ? { ...meta, quiet: true } : meta)
  if (meta?.resume?.runId) {
    const applied = restoreRunState((meta.resume.steps ?? []) as never, meta.resume.decisions)
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
function completeStep(stepId: string): void {
  humanToggleStepDone(stepId)
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

;(window as any).Understudy = {
  init,
  log,
  registerAction,
  loadProcess,
  unloadProcess,
  notifyAction,
  getLoadedProcess,
  getProgress,
  completeStep,
  currentRunId,
}
