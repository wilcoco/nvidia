// Persists each execution of a loaded playbook as a run record (via the host's
// processStore adapter): step outcomes, deviations, completion. Fire-and-forget —
// the page never blocks on run bookkeeping.
import * as mapstore from './mapstore'
import * as host from './host'
import { record } from './journal'
import { preconditionFor } from './runner'

let runId: string | null = null
let completed = false
let syncTimer: ReturnType<typeof setTimeout> | null = null

export function currentRunId(): string | null {
  return runId
}

function snapshot() {
  const map = mapstore.getMap()
  if (!map) return null
  // A draft (e.g. reopened for revision) has no execution state — never let
  // its empty status table read as "run complete".
  if (!map.confirmed) return null
  const statuses = mapstore.progress(preconditionFor)
  const steps = map.steps
    .filter((s) => s.type !== 'decision')
    .map((s) => ({
      id: s.id,
      label: s.label,
      type: s.type,
      action: s.action,
      status: statuses.get(s.id),
      resultId: s.resultId,
      naReason: s.naReason,
      role: s.role,
      completedBy: s.completedBy,
      completedAt: s.completedAt,
      resultData: s.resultData,
    }))
  const open = steps.filter((s) => ['ready', 'blocked', 'skipped', 'pending'].includes(s.status ?? ''))
  // An unresolved decision keeps the run open even when every reachable task
  // is handled — the not-yet-chosen branches are still conditional, not done.
  // It travels inside `steps` so the server's completion gate sees it too.
  const gate = mapstore.pendingDecision()
  const outSteps: Array<Record<string, unknown>> = [...steps]
  if (gate) {
    outSteps.push({ id: `gate:${gate.id}`, label: `decision: ${gate.label}`, type: 'gate', status: 'ready' })
  }
  return {
    steps: outSteps,
    decisions: map.decisions ?? [],
    deviations: steps.filter((s) => s.status === 'skipped' || s.naReason).length,
    isComplete: steps.length > 0 && open.length === 0 && !gate,
  }
}

/** True when every required step of the loaded run is handled. */
export function isRunComplete(): boolean {
  return snapshot()?.isComplete ?? false
}

function sync() {
  const store = host.getProcessStore()
  if (!runId || !store?.updateRun) return
  const snap = snapshot()
  if (!snap) return
  const finishing = snap.isComplete && !completed
  if (finishing) {
    completed = true
    record('user', 'map', `playbook run complete — all required steps handled`)
  }
  void store
    .updateRun(runId, {
      steps: snap.steps,
      decisions: snap.decisions,
      deviations: snap.deviations,
      status: snap.isComplete ? 'completed' : 'active',
    })
    .catch((err) => {
      if (!syncFailureLogged) {
        syncFailureLogged = true
        record(
          'user',
          'map',
          `⚠ run sync failing (${err instanceof Error ? err.message : err}) — progress is NOT persisting to the server`,
        )
      }
    })
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer)
  // A finished run must not sit in the debounce window — a new run starting
  // meanwhile would retire it as abandoned instead of completed.
  const snap = snapshot()
  if (snap?.isComplete && !completed) {
    syncTimer = null
    sync()
    return
  }
  syncTimer = setTimeout(sync, 700)
}

let subscribed = false

/** Call right after a saved playbook is loaded; starts a run record for it. */
let syncFailureLogged = false

export function stopRunTracking(): void {
  runId = null
  completed = false
  syncFailureLogged = false
}

/** Reattach to a run that already exists (page reload) instead of starting a new one. */
export function resumeRunTracking(id: string): void {
  runId = id
  completed = false
  if (!subscribed) {
    subscribed = true
    mapstore.subscribe(scheduleSync)
  }
}

export function startRunTracking(processId: string): void {
  const store = host.getProcessStore()
  runId = null
  completed = false
  if (!store?.startRun) return
  const map = mapstore.getMap()
  if (!map) return
  if (!subscribed) {
    subscribed = true
    mapstore.subscribe(scheduleSync)
  }
  void store
    .startRun(processId, map)
    .then((run) => {
      runId = run.id
      record('user', 'map', `started run ${run.id} of "${map.title}"`)
      sync()
    })
    .catch(() => {
      /* offline/unauthenticated: run just isn't persisted */
    })
}
