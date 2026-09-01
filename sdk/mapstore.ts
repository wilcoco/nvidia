import type { FieldDef, MapEdit, ProcessMap, Step, StepType } from './types'
import { record } from './journal'
import * as host from './host'
import { onGapResolved } from './asks'

onGapResolved((gapKey) => markGapResolved(gapKey))

export function markGapResolved(gapKey: string): void {
  if (!map) return
  if (!map.resolvedGaps) map.resolvedGaps = []
  if (!map.resolvedGaps.includes(gapKey)) {
    map.resolvedGaps.push(gapKey)
    notify()
  }
}

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

/** Agent proposes a full map (replaces the current draft). Interview answers
 *  survive a re-propose: resolvedGaps merge with the previous draft's. */
export function proposeMap(next: ProcessMap): void {
  const prevResolved = map?.resolvedGaps ?? []
  map = {
    ...next,
    confirmed: false,
    resolvedGaps: [...new Set([...(next.resolvedGaps ?? []), ...prevResolved])],
  }
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
  // Retroactively link work already done this session: each successful action
  // completes the first matching step, in the order it actually happened.
  let linked = 0
  for (const ev of actionHistory) {
    const step = map.steps.find((s) => s.action === ev.action && !s.done)
    if (step) {
      step.done = true
      if (ev.resultId) step.resultId = ev.resultId
      linked++
    }
  }
  record(
    'agent',
    'map',
    `loaded saved process "${loaded.title}"${meta?.createdBy ? ` (created by ${meta.createdBy})` : ''}` +
      (linked ? ` — linked ${linked} already-completed step(s)` : ''),
  )
  notify()
}

/** Session history of successful semantic actions — replayed onto maps loaded later,
 *  so work done BEFORE a playbook was opened still counts. */
interface ActionEvent {
  action: string
  resultId?: string
  ts: number
}
const actionHistory: ActionEvent[] = []

/** Single completion path for human UI work and agent run_action alike. */
export function recordActionSuccess(
  actionName: string,
  resultId?: string,
  by: 'user' | 'agent' = 'user',
): void {
  actionHistory.push({ action: actionName, resultId, ts: Date.now() })
  if (actionHistory.length > 100) actionHistory.shift()
  markActionDone(actionName, resultId, by)
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

/** Agent refines a single step in place (e.g. writing captured judgment into its note). */
export function agentUpdateStep(
  stepId: string,
  patch: { label?: string; detail?: string; action?: string; humanOnly?: boolean },
  branch?: { to: string; condition: string },
): { ok: boolean; error?: string; step?: Step } {
  if (!map) return { ok: false, error: 'no process map exists yet — propose one first' }
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return { ok: false, error: `unknown step "${stepId}"` }
  const changed: string[] = []
  for (const field of ['label', 'detail', 'action'] as const) {
    const value = patch[field]
    if (value !== undefined && value !== step[field]) {
      step[field] = value
      changed.push(field)
    }
  }
  if (patch.humanOnly !== undefined && patch.humanOnly !== step.humanOnly) {
    step.humanOnly = patch.humanOnly
    if (patch.humanOnly) delete step.action
    changed.push('humanOnly')
  }
  if (branch) {
    const edge = step.next?.find((b) => b.to === branch.to)
    if (!edge) return { ok: false, error: `step "${stepId}" has no edge to "${branch.to}"` }
    edge.condition = branch.condition
    changed.push(`condition→${branch.to}`)
  }
  if (changed.length === 0) return { ok: true, step }
  record('agent', 'map', `updated step "${step.label}" (${changed.join(', ')})`)
  notify()
  return { ok: true, step }
}

/** Record which branch a branching step took (and why); choosing a loop-back
 *  re-opens the loop body so those steps run again. */
export function resolveDecision(
  stepId: string,
  branchTo: string,
  reason: string,
  evidence?: string,
  by: 'user' | 'agent' = 'user',
): { ok: boolean; error?: string; reopened?: string[] } {
  if (!map) return { ok: false, error: 'no process is loaded' }
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return { ok: false, error: `unknown step "${stepId}"` }
  const edge = step.next?.find((e) => e.to === branchTo)
  if (!edge) return { ok: false, error: `step "${stepId}" has no edge to "${branchTo}"` }
  if (!map.decisions) map.decisions = []
  map.decisions.push({ stepId, to: branchTo, reason, evidence, ts: Date.now() })
  record(
    by,
    'map',
    `decision at "${step.label}": took branch → "${map.steps.find((s) => s.id === branchTo)?.label ?? branchTo}" — ${reason}${evidence ? ` (evidence: ${evidence})` : ''}`,
  )
  const idx = new Map(map.steps.map((s, i) => [s.id, i]))
  const from = idx.get(stepId) ?? 0
  const to = idx.get(branchTo) ?? 0
  const reopened: string[] = []
  if (to <= from) {
    // Loop-back: the loop body (target through the branching step) runs again.
    for (const s of map.steps) {
      const i = idx.get(s.id) ?? 0
      if (i >= to && i <= from && s.type !== 'decision' && (s.done || s.naReason)) {
        s.done = false
        delete s.naReason
        reopened.push(s.label)
      }
    }
    if (reopened.length) record(by, 'map', `re-opened for the loop: ${reopened.join('; ')}`)
  }
  notify()
  return { ok: true, reopened }
}

/** Set/replace the playbook's data contract (from the required_context interview). */
export function setMapFields(fields: FieldDef[]): { ok: boolean; error?: string; fields?: FieldDef[] } {
  if (!map) return { ok: false, error: 'no process map exists yet — propose one first' }
  if (!Array.isArray(fields)) return { ok: false, error: 'fields must be an array' }
  map.fields = fields
  markGapResolved('required_context')
  record('agent', 'map', `defined the playbook's data contract (${fields.map((f) => f.key).join(', ')})`)
  notify()
  return { ok: true, fields }
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

export interface MapGap {
  kind:
    | 'before'
    | 'after'
    | 'branch_condition'
    | 'final_signoff'
    | 'judgment'
    | 'replay_binding'
    | 'required_context'
    | 'precursors'
  stepId?: string
  step?: string
  suggested_question?: string
  note?: string
}

/** What the current map does NOT yet know — the interview agenda for the agent. */
export function mapGaps(): MapGap[] {
  if (!map) return []
  const gaps: MapGap[] = []
  const actionable = map.steps.filter((s) => s.type !== 'decision')
  const first = actionable[0]
  if (first) {
    gaps.push({
      kind: 'before',
      stepId: first.id,
      step: first.label,
      suggested_question: `Before "${first.label}" — is there anything that must happen first (stopping the line, notifying someone, a check)?`,
    })
    gaps.push({
      kind: 'required_context',
      stepId: first.id,
      step: first.label,
      suggested_question: `When logging "${first.label}" — which variables or readings must always be captured (measurements, settings, conditions)? I'll note them on the step so nothing gets missed.`,
    })
    gaps.push({
      kind: 'precursors',
      stepId: first.id,
      step: first.label,
      suggested_question: `Are there warning signs that usually precede this situation — things an experienced operator would notice early? I'll record them so the playbook helps people catch it sooner.`,
    })
  }
  const last = map.steps.find((s) => !s.next || s.next.length === 0)
  if (last) {
    gaps.push({
      kind: 'after',
      stepId: last.id,
      step: last.label,
      suggested_question: `After "${last.label}" — does anything follow (a report, cleanup, verification, restart)?`,
    })
  }
  for (const d of map.steps) {
    for (const e of d.next ?? []) {
      if ((d.next?.length ?? 0) > 1 && !e.condition) {
        const target = map.steps.find((s) => s.id === e.to)
        gaps.push({
          kind: 'branch_condition',
          stepId: d.id,
          step: d.label,
          suggested_question: `When exactly does the flow go from "${d.label}" to "${target?.label ?? e.to}"? What decides it?`,
        })
      }
    }
  }
  if (!map.steps.some((s) => s.type === 'approval')) {
    gaps.push({
      kind: 'final_signoff',
      suggested_question: 'Who gives the final sign-off for this process, and at which point?',
    })
  }
  for (const s of actionable.filter((x) => !x.detail).slice(0, 3)) {
    gaps.push({
      kind: 'judgment',
      stepId: s.id,
      step: s.label,
      suggested_question: `What rule or threshold guides "${s.label}"? What would an expert check, and when would they deviate?`,
    })
  }
  for (const s of actionable.filter((x) => !x.action && !x.humanOnly)) {
    gaps.push({
      kind: 'replay_binding',
      stepId: s.id,
      step: s.label,
      note: 'No host action bound. If a matching host action exists (see describe_workspace), bind it via update_step; if the step is inherently manual, mark it update_step {humanOnly: true} so this stops being flagged.',
    })
  }
  const resolved = new Set(map.resolvedGaps ?? [])
  return gaps.filter((g) => !resolved.has(g.stepId ? `${g.kind}:${g.stepId}` : g.kind) && !resolved.has(g.kind))
}

/** Would running this action now jump past required, not-yet-done steps? */
export function prerequisiteGap(actionName: string): { target: string; missing: string[] } | null {
  if (!map?.confirmed) return null
  const target = map.steps.find((s) => s.action === actionName && !s.done)
  if (!target) return null
  const statuses = progress()
  const actionable = map.steps.filter((s) => s.type !== 'decision')
  const targetIdx = actionable.findIndex((s) => s.id === target.id)
  const missing = actionable
    .slice(0, targetIdx)
    .filter((s) => ['ready', 'skipped', 'pending', 'blocked'].includes(statuses.get(s.id) ?? ''))
  return missing.length ? { target: target.label, missing: missing.map((s) => s.label) } : null
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

/** Steps that sit on only some branches out of a decision, with the conditions
 *  that would activate them. They may legitimately never run, so they are never
 *  called 'skipped' — unless the host's branchResolver confirms their branch is
 *  the active one, which promotes them to required. */
function conditionalSteps(steps: Step[]): Map<string, string[]> {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const order = new Map(steps.map((s, i) => [s.id, i]))
  const reach = (from: string, acc: Set<string>) => {
    if (acc.has(from)) return
    acc.add(from)
    for (const e of byId.get(from)?.next ?? []) {
      // follow forward edges only — loop-backs don't extend a branch's footprint
      if ((order.get(e.to) ?? 0) > (order.get(from) ?? 0)) reach(e.to, acc)
    }
  }
  const indexOf = new Map(steps.map((s, i) => [s.id, i]))
  const conditional = new Map<string, string[]>()
  for (const d of steps.filter((s) => (s.next?.length ?? 0) > 1)) {
    const dIdx = indexOf.get(d.id) ?? 0
    // A loop-back edge (target earlier than the branching step) means "repeat",
    // never "optional" — exclude it, or it would poison required main-path
    // steps like maintenance-before-verification.
    const forward = d.next!.filter((e) => (indexOf.get(e.to) ?? 0) > dIdx)
    if (forward.length < 2) continue
    const perBranch = forward.map((e) => {
      const set = new Set<string>()
      reach(e.to, set)
      return { condition: e.condition, set }
    })
    const common = perBranch
      .map((b) => b.set)
      .reduce((a, b) => new Set([...a].filter((x) => b.has(x))))
    for (const b of perBranch) {
      for (const id of b.set) {
        if (common.has(id)) continue
        const conditions = conditional.get(id) ?? []
        if (b.condition) conditions.push(b.condition)
        conditional.set(id, conditions)
      }
    }
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
  const conditionalMap = conditionalSteps(map.steps)
  const resolver = host.getBranchResolver()
  const conditional = new Set(
    [...conditionalMap.entries()]
      .filter(([, conditions]) => !(resolver && conditions.some((c) => resolver(c) === true)))
      .map(([id]) => id),
  )
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
