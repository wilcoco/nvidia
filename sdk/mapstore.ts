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
  // Retroactively link work done just before this playbook was opened —
  // but ONLY events no other run has consumed, and only recent ones.
  // Without both guards, finishing one playbook and loading another would
  // wrongly re-attach the previous run's records to the new process.
  const RETRO_WINDOW_MS = 30 * 60_000
  const cutoff = Date.now() - RETRO_WINDOW_MS
  let linked = 0
  for (const ev of actionHistory) {
    if (ev.consumed || ev.ts < cutoff) continue
    const step = map.steps.find((s) => s.action === ev.action && !s.done)
    if (step) {
      step.done = true
      if (ev.resultId) step.resultId = ev.resultId
      ev.consumed = true
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
  /** Set once this event completed a step of some run — it must never be
   *  linked again, or one run's work would bleed into the next playbook. */
  consumed?: boolean
}
const actionHistory: ActionEvent[] = []

/** Single completion path for human UI work and agent run_action alike. */
export function recordActionSuccess(
  actionName: string,
  resultId?: string,
  by: 'user' | 'agent' = 'user',
): void {
  const ev: ActionEvent = { action: actionName, resultId, ts: Date.now() }
  actionHistory.push(ev)
  if (actionHistory.length > 100) actionHistory.shift()
  if (markActionDone(actionName, resultId, by)) ev.consumed = true
}

/** Auto-mark the first not-done step bound to this host action (agent replay path). */
export function markActionDone(
  actionName: string,
  resultId?: string,
  by: 'user' | 'agent' = 'agent',
): Step | null {
  if (!map?.confirmed) return null
  const step = map.steps.find((s) => s.action === actionName && !s.done)
  if (!step) return null
  step.done = true
  delete step.naReason
  if (resultId) step.resultId = resultId
  record(by, 'map', `completed step "${step.label}"`)
  notify()
  return step
}

/** Agent refines a single step in place (e.g. writing captured judgment into its note). */
export function agentUpdateStep(
  stepId: string,
  patch: { label?: string; detail?: string; action?: string; humanOnly?: boolean },
  branch?: { to: string; condition?: string; criteria?: Record<string, Record<string, number | string | boolean>> },
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
    if (branch.condition !== undefined) {
      edge.condition = branch.condition
      changed.push(`condition→${branch.to}`)
    }
    if (branch.criteria !== undefined) {
      edge.criteria = branch.criteria
      changed.push(`criteria→${branch.to}`)
    }
  }
  if (changed.length === 0) return { ok: true, step }
  record('agent', 'map', `updated step "${step.label}" (${changed.join(', ')})`)
  notify()
  return { ok: true, step }
}

/** Record which branch a branching step took (and why); choosing a loop-back
 *  re-opens the loop body so those steps run again. */
const OPS: Record<string, (m: number, v: number) => boolean> = {
  lt: (m, v) => m < v,
  lte: (m, v) => m <= v,
  gt: (m, v) => m > v,
  gte: (m, v) => m >= v,
}

export function resolveDecision(
  stepId: string,
  branchTo: string,
  reason: string,
  evidence?: string,
  by: 'user' | 'agent' = 'user',
  measurements?: Record<string, unknown>,
): { ok: boolean; error?: string; reopened?: string[] } {
  if (!map) return { ok: false, error: 'no process is loaded' }
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return { ok: false, error: `unknown step "${stepId}"` }
  const edge = step.next?.find((e) => e.to === branchTo)
  if (!edge) return { ok: false, error: `step "${stepId}" has no edge to "${branchTo}"` }

  // Safety: a branch with machine-checkable criteria is verified HERE, not
  // trusted to the caller. Violated criteria refuse the branch outright —
  // the right follow-up is "are the measurements wrong, or is this the
  // failure branch?", never "override anyway".
  if (edge.criteria && Object.keys(edge.criteria).length > 0) {
    const violated: string[] = []
    const missing: string[] = []
    for (const [key, rule] of Object.entries(edge.criteria)) {
      const m = measurements?.[key]
      if (m === undefined || m === null) {
        missing.push(key)
        continue
      }
      for (const [op, target] of Object.entries(rule)) {
        if (op === 'eq') {
          if (m !== target) violated.push(`${key} must equal ${target} (got ${m})`)
        } else if (op === 'ne') {
          if (m === target) violated.push(`${key} must not equal ${target}`)
        } else if (OPS[op]) {
          if (typeof m !== 'number' || !OPS[op](m, Number(target))) {
            violated.push(`${key} must be ${op} ${target} (got ${m})`)
          }
        }
      }
    }
    if (missing.length > 0) {
      return {
        ok: false,
        error: `evidence_conflict: this branch requires measurements for ${missing.join(', ')} — supply them in "measurements" (structured values, not prose).`,
      }
    }
    if (violated.length > 0) {
      record(by, 'map', `REFUSED branch at "${step.label}" → "${branchTo}": ${violated.join('; ')}`, measurements)
      return {
        ok: false,
        error: `evidence_conflict: the measurements violate this branch's criteria — ${violated.join('; ')}. Ask the human whether the measurements are wrong or whether to take the failure branch instead. Do not override.`,
      }
    }
  }
  if (!map.decisions) map.decisions = []
  map.decisions.push({ stepId, to: branchTo, reason, evidence: evidence ?? (measurements ? JSON.stringify(measurements) : undefined), ts: Date.now() })
  // A verified pass (forward branch with measurements) is worth keeping on the
  // business record itself — otherwise the approval would show the initial
  // failing readings instead of the values that actually passed.
  const orderAll = new Map(map.steps.map((s, i) => [s.id, i]))
  if (measurements && (orderAll.get(branchTo) ?? 0) > (orderAll.get(stepId) ?? 0)) {
    const producedIds = map.steps
      .filter((s) => s.resultId)
      .map((s) => ({ step: s.label, action: s.action, id: s.resultId! }))
    void Promise.resolve(
      host.getProcessStore()?.saveVerification?.(measurements, { stepId, branchTo, producedIds }),
    ).catch(() => {})
  }
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
    | 'pass_criteria'
  stepId?: string
  step?: string
  /** What the question should find out — the agent writes the actual wording. */
  question_goal?: string
  /** The concrete information still missing. */
  missing_information?: string[]
  /** Generic wording — ONLY for when the domain cannot be inferred at all.
   *  Never show this text to the human when the workspace/entry reveals the domain. */
  fallback_question?: string
  note?: string
}

let lastFallbacks: string[] = []
/** Fallback wordings from the last gap computation — used to detect verbatim reuse. */
export function knownFallbackQuestions(): string[] {
  return lastFallbacks
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
      question_goal: `Find out whether anything must happen before "${first.label}"`,
      missing_information: ['prerequisite steps', 'notifications', 'readiness or safety checks'],
      fallback_question: `Before "${first.label}" — is there anything that must happen first?`,
    })
    gaps.push({
      kind: 'required_context',
      stepId: first.id,
      step: first.label,
      question_goal: `Identify the variables or values that must always be captured when doing "${first.label}"`,
      missing_information: ['required fields', 'measurements or values', 'their types and units'],
      fallback_question: `Which values must always be recorded for "${first.label}"?`,
    })
    gaps.push({
      kind: 'precursors',
      stepId: first.id,
      step: first.label,
      question_goal: 'Identify early signs an experienced person notices before this situation becomes a problem',
      missing_information: ['early warning signs', 'what to watch or check'],
      fallback_question: 'Are there early signs that usually precede this situation?',
    })
  }
  const last = map.steps.find((s) => !s.next || s.next.length === 0)
  if (last) {
    gaps.push({
      kind: 'after',
      stepId: last.id,
      step: last.label,
      question_goal: `Find out what follows "${last.label}"`,
      missing_information: ['reports', 'verification', 'hand-off or follow-up tasks'],
      fallback_question: `After "${last.label}" — does anything follow?`,
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
          question_goal: `Determine what decides the flow from "${d.label}" to "${target?.label ?? e.to}"`,
          missing_information: ['the deciding condition', 'thresholds if any'],
          fallback_question: `When does the flow go from "${d.label}" to "${target?.label ?? e.to}"?`,
        })
      }
    }
  }
  if (!map.steps.some((s) => s.type === 'approval')) {
    gaps.push({
      kind: 'final_signoff',
      question_goal: 'Identify who gives the final sign-off, at which point, and on what conditions',
      missing_information: ['approver (role or person)', 'approval point in the flow', 'approval conditions'],
      fallback_question: 'Who gives the final sign-off for this process, and at which point?',
    })
  }
  for (const s of actionable.filter((x) => !x.detail).slice(0, 3)) {
    gaps.push({
      kind: 'judgment',
      stepId: s.id,
      step: s.label,
      question_goal: `Capture the rule or threshold that guides "${s.label}"`,
      missing_information: ['the rule or threshold', 'what an expert checks', 'when they would deviate'],
      fallback_question: `What rule or threshold guides "${s.label}"?`,
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
  // Branch edges that go FORWARD but carry no machine-checkable criteria:
  // the engine cannot refuse a wrong pass-choice without them.
  const orderIdx = new Map(map.steps.map((s, i) => [s.id, i]))
  for (const s of map.steps.filter((x) => (x.next?.length ?? 0) >= 2)) {
    for (const e of s.next ?? []) {
      const isForward = (orderIdx.get(e.to) ?? 0) > (orderIdx.get(s.id) ?? 0)
      if (isForward && (!e.criteria || Object.keys(e.criteria).length === 0)) {
        gaps.push({
          kind: 'pass_criteria',
          stepId: s.id,
          step: s.label,
          note: `The pass edge "${s.label}" → "${map.steps.find((t) => t.id === e.to)?.label ?? e.to}" has no machine-checkable criteria — the engine cannot refuse a wrong pass-choice. If the human stated thresholds (e.g. "under 55°C, 3 clean cycles, no leak"), encode them now via update_step {stepId, branch_to, branch_criteria: {...}}. If none were stated, ask via ask_user.`,
        })
      }
    }
  }
  const resolved = new Set(map.resolvedGaps ?? [])
  lastFallbacks = gaps.map((g) => g.fallback_question).filter((q): q is string => !!q)
  return gaps.filter((g) => !resolved.has(g.stepId ? `${g.kind}:${g.stepId}` : g.kind) && !resolved.has(g.kind))
}

/** Would running this action now jump past required, not-yet-done steps? */
export function prerequisiteGap(actionName: string): { target: string; missing: string[] } | null {
  if (!map?.confirmed) return null
  const target = map.steps.find((s) => s.action === actionName && !s.done)
  if (!target) return null
  const statuses = progress()
  const order = new Map(map.steps.map((s, i) => [s.id, i]))
  const actionable = map.steps.filter((s) => s.type !== 'decision')
  const targetIdx = actionable.findIndex((s) => s.id === target.id)
  const missing = actionable
    .slice(0, targetIdx)
    .filter((s) => ['ready', 'skipped', 'pending', 'blocked'].includes(statuses.get(s.id) ?? ''))
    .map((s) => s.label)
  const gate = lastPendingDecision
  if (gate && (order.get(gate.id) ?? 0) < (order.get(target.id) ?? 0)) {
    missing.push(`unresolved decision "${gate.label}" (resolve_decision first)`)
  }
  return missing.length ? { target: target.label, missing } : null
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
let lastPendingDecision: Step | null = null

/** A branching step whose outcome must be resolved before the run can move past it. */
export function pendingDecision(): Step | null {
  progress()
  return lastPendingDecision
}

function forwardResolved(d: Step, order: Map<string, number>): boolean {
  const decs = map?.decisions?.filter((x) => x.stepId === d.id) ?? []
  if (decs.length === 0) return false
  const last = decs[decs.length - 1]
  return (order.get(last.to) ?? 0) > (order.get(d.id) ?? 0)
}

export function progress(
  preconditionFor?: (actionName: string) => string | null,
): Map<string, StepStatus> {
  const statuses = new Map<string, StepStatus>()
  lastPendingDecision = null
  if (!map?.confirmed) return statuses
  const conditionalMap = conditionalSteps(map.steps)
  const resolver = host.getBranchResolver()
  const conditional = new Set(
    [...conditionalMap.entries()]
      .filter(([, conditions]) => !(resolver && conditions.some((c) => resolver(c) === true)))
      .map(([id]) => id),
  )
  const order = new Map(map.steps.map((s, i) => [s.id, i]))
  const actionable = map.steps.filter((s) => s.type !== 'decision')
  // Not-applicable steps count as handled for ordering purposes.
  const lastHandledIdx = actionable.reduce((acc, s, i) => (s.done || s.naReason ? i : acc), -1)
  // Any step with 2+ outgoing edges needs its outcome resolved — including the
  // common fail-loops-back / pass-goes-forward shape (1 forward + 1 back edge).
  const hasBranching = (s: Step) => (s.next?.length ?? 0) >= 2
  let gateAssigned = false
  let aIdx = -1
  for (const s of map.steps) {
    if (s.type === 'decision') {
      // An unresolved decision whose predecessors are handled IS the gate:
      // nothing after it may become ready until resolve_decision picks an edge.
      if (hasBranching(s) && !gateAssigned && !forwardResolved(s, order)) {
        statuses.set(s.id, 'ready')
        lastPendingDecision = s
        gateAssigned = true
      }
      continue
    }
    aIdx++
    if (s.done) statuses.set(s.id, 'done')
    else if (s.naReason) statuses.set(s.id, 'not_applicable')
    else if (conditional.has(s.id)) statuses.set(s.id, 'conditional')
    else if (aIdx < lastHandledIdx) statuses.set(s.id, 'skipped')
    else if (!gateAssigned) {
      const reason = s.action && preconditionFor ? preconditionFor(s.action) : null
      statuses.set(s.id, reason ? 'blocked' : 'ready')
      gateAssigned = true
    } else statuses.set(s.id, 'pending')
    // A completed TASK that branches also needs its outcome resolved before
    // anything later runs (e.g. verification done — passed or failed?).
    if ((s.done || s.naReason) && hasBranching(s) && !gateAssigned && !forwardResolved(s, order)) {
      lastPendingDecision = s
      gateAssigned = true
    }
  }
  return statuses
}

export function editsSince(cursor = 0): MapEdit[] {
  return edits.filter((e) => e.id > cursor)
}

export function orderedSteps(): Step[] {
  return map ? map.steps : []
}
