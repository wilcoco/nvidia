import type { MapEdit, ProcessMap, Step, StepType } from './types'
import { record } from './journal'

type Listener = () => void

let map: ProcessMap | null = null
let nextEditId = 1
const edits: MapEdit[] = []
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function getMap(): ProcessMap | null {
  return map
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Agent proposes a full map (replaces the current draft). */
export function proposeMap(next: ProcessMap): void {
  map = { ...next, confirmed: false }
  record('agent', 'map', `proposed process map "${next.title}" (${next.steps.length} steps)`)
  notify()
}

function pushEdit(edit: Omit<MapEdit, 'id' | 'ts'>): void {
  edits.push({ id: nextEditId++, ts: Date.now(), ...edit })
  if (edits.length > 200) edits.splice(0, edits.length - 200)
}

/** Human edits made through the panel UI. Journaled so the agent can read them back. */
export function humanEditStep(stepId: string, field: 'label' | 'detail' | 'type', to: string): void {
  if (!map) return
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return
  const from = String(step[field] ?? '')
  if (from === to) return
  if (field === 'type') step.type = to as StepType
  else step[field] = to
  pushEdit({ stepId, field, from, to })
  record('user', 'map', `edited step "${step.label}": ${field} → ${to}`)
  notify()
}

export function humanEditCondition(stepId: string, targetId: string, to: string): void {
  if (!map) return
  const step = map.steps.find((s) => s.id === stepId)
  const branch = step?.next?.find((b) => b.to === targetId)
  if (!step || !branch) return
  const from = branch.condition ?? ''
  if (from === to) return
  branch.condition = to
  pushEdit({ stepId, field: `condition→${targetId}`, from, to })
  record('user', 'map', `edited branch condition on "${step.label}"`)
  notify()
}

export function humanRemoveStep(stepId: string): void {
  if (!map) return
  const idx = map.steps.findIndex((s) => s.id === stepId)
  if (idx < 0) return
  const [removed] = map.steps.splice(idx, 1)
  // Rewire: anything pointing at the removed step now points at its successors.
  const successors = removed.next ?? []
  for (const s of map.steps) {
    if (!s.next) continue
    if (s.next.some((b) => b.to === stepId)) {
      s.next = s.next.filter((b) => b.to !== stepId).concat(successors)
    }
  }
  pushEdit({ stepId, field: 'removed', from: removed.label })
  record('user', 'map', `removed step "${removed.label}"`)
  notify()
}

export function humanConfirmMap(saver?: (m: ProcessMap) => Promise<{ id: string }>): void {
  if (!map) return
  map.confirmed = true
  pushEdit({ field: 'confirmed', to: 'true' })
  record('user', 'map', `confirmed process "${map.title}"`)
  notify()
  if (saver) {
    const current = map
    saver(current)
      .then((saved) => record('user', 'map', `saved "${current.title}" to the shared process library (id ${saved.id})`))
      .catch((err) => record('user', 'map', `saving "${current.title}" failed: ${err instanceof Error ? err.message : err}`))
  }
}

/** Load a process someone saved earlier (already confirmed). Completion state starts fresh. */
export function loadSavedMap(loaded: ProcessMap, meta?: { id?: string; createdBy?: string }): void {
  map = {
    ...loaded,
    confirmed: true,
    steps: loaded.steps.map((s) => ({ ...s, done: false, naReason: undefined, resultId: undefined })),
  }
  record(
    'agent',
    'map',
    `loaded saved process "${loaded.title}"${meta?.createdBy ? ` (created by ${meta.createdBy})` : ''}`,
  )
  notify()
}

/** Auto-mark the first not-done step bound to this host action (agent replay path). */
export function markActionDone(
  actionName: string,
  resultId?: string,
  by: 'user' | 'agent' = 'agent',
): void {
  if (!map?.confirmed) return
  const step = map.steps.find((s) => s.action === actionName && !s.done)
  if (!step) return
  step.done = true
  delete step.naReason
  if (resultId) step.resultId = resultId
  record(by, 'map', `completed step "${step.label}"`)
  notify()
}

/** Human checks a step off (or un-checks it) in the panel. */
export function humanToggleStepDone(stepId: string): void {
  if (!map) return
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return
  step.done = !step.done
  pushEdit({ stepId, field: 'done', to: String(step.done) })
  record('user', 'map', `${step.done ? 'checked off' : 'unchecked'} step "${step.label}"`)
  notify()
}

export type StepStatus =
  | 'done'
  | 'ready'
  | 'skipped'
  | 'pending'
  | 'conditional'
  | 'blocked'
  | 'not_applicable'

/** Resolve a deviation: mark a step done, or excuse it with a reason. */
export function resolveDeviation(
  stepId: string,
  resolution: 'completed' | 'not_applicable',
  reason?: string,
  by: 'user' | 'agent' = 'user',
): { stepId: string; label: string; resolution: string } {
  if (!map) throw new Error('no process is loaded')
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) throw new Error(`unknown step "${stepId}" — see get_process_map for step ids`)
  if (resolution === 'completed') {
    step.done = true
    delete step.naReason
    record(by, 'map', `resolved step "${step.label}" as completed${reason ? ` — ${reason}` : ''}`)
  } else {
    step.naReason = reason || 'marked not applicable'
    record(by, 'map', `marked step "${step.label}" not applicable — ${step.naReason}`)
  }
  pushEdit({ stepId, field: 'resolution', to: resolution })
  notify()
  return { stepId, label: step.label, resolution }
}

/** Steps that sit on only some branches out of a decision — they may legitimately
 *  never run, so they are never called 'skipped' until they actually happen. */
function conditionalStepIds(steps: Step[]): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const reach = (from: string, acc: Set<string>) => {
    if (acc.has(from)) return
    acc.add(from)
    for (const e of byId.get(from)?.next ?? []) reach(e.to, acc)
  }
  const conditional = new Set<string>()
  for (const d of steps.filter((s) => (s.next?.length ?? 0) > 1)) {
    const perBranch = d.next!.map((e) => {
      const set = new Set<string>()
      reach(e.to, set)
      return set
    })
    const common = perBranch.reduce((a, b) => new Set([...a].filter((x) => b.has(x))))
    for (const set of perBranch) for (const id of set) if (!common.has(id)) conditional.add(id)
  }
  return conditional
}

/**
 * Run-state of a confirmed map, derived on demand.
 * Decision steps are routing, not work, so they carry no status of their own.
 * 'ready'       = the next step whose turn it is (guide, not a nag)
 * 'blocked'     = its turn, but the bound action's precondition fails (e.g. nothing to approve yet)
 * 'skipped'     = a required step still not done although a later step already ran (a deviation)
 * 'conditional' = on a branch whose condition is not yet decided — not required (yet)
 */
export function progress(
  preconditionFor?: (actionName: string) => string | null,
): Map<string, StepStatus> {
  const statuses = new Map<string, StepStatus>()
  if (!map?.confirmed) return statuses
  const conditional = conditionalStepIds(map.steps)
  const actionable = map.steps.filter((s) => s.type !== 'decision')
  // Not-applicable steps count as handled for ordering purposes.
  const lastHandledIdx = actionable.reduce((acc, s, i) => (s.done || s.naReason ? i : acc), -1)
  let gateAssigned = false
  actionable.forEach((s, i) => {
    if (s.done) statuses.set(s.id, 'done')
    else if (s.naReason) statuses.set(s.id, 'not_applicable')
    else if (conditional.has(s.id)) statuses.set(s.id, 'conditional')
    else if (i < lastHandledIdx) statuses.set(s.id, 'skipped')
    else if (!gateAssigned) {
      const reason = s.action && preconditionFor ? preconditionFor(s.action) : null
      statuses.set(s.id, reason ? 'blocked' : 'ready')
      gateAssigned = true
    } else statuses.set(s.id, 'pending')
  })
  return statuses
}

export function editsSince(cursor = 0): MapEdit[] {
  return edits.filter((e) => e.id > cursor)
}

export function orderedSteps(): Step[] {
  return map ? map.steps : []
}
