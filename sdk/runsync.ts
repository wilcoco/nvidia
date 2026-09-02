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
    }))
  const open = steps.filter((s) => ['ready', 'blocked', 'skipped', 'pending'].includes(s.status ?? ''))
  return {
    steps,
    deviations: steps.filter((s) => s.status === 'skipped' || s.naReason).length,
    isComplete: steps.length > 0 && open.length === 0,
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
      deviations: snap.deviations,
      status: snap.isComplete ? 'completed' : 'active',
    })
    .catch(() => {
      /* run bookkeeping must never break the page */
    })
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(sync, 700)
}

let subscribed = false

/** Call right after a saved playbook is loaded; starts a run record for it. */
export function stopRunTracking(): void {
  runId = null
  completed = false
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
