import type { BranchTarget, FieldDef, MapEdit, ProcessMap, Step, StepType, RunEvent } from './types'
import { record } from './journal'
import * as host from './host'
import { onGapResolved } from './asks'
import { validateFields, validateFieldValues, validateFieldBindings, validateCriteria } from '../shared/fields'

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

/** Unload the current map/draft entirely (e.g. the host reset its demo data). */
export function clearMap(by: 'user' | 'agent' = 'user'): void {
  if (!map) return
  const title = map.title
  map = null
  record(by, 'map', `unloaded process "${title}" from the panel`)
  notify()
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
    editError: undefined,
    resolvedGaps: [...new Set([...(next.resolvedGaps ?? []), ...prevResolved])],
  }
  record('agent', 'map', `proposed process map "${next.title}" (${next.steps.length} steps)`)
  notify()
}

function pushEdit(edit: Omit<MapEdit, 'id' | 'ts'>): void {
  edits.push({ id: nextEditId++, ts: Date.now(), ...edit })
  if (edits.length > 200) edits.splice(0, edits.length - 200)
}

function actingPersona(): string | undefined {
  try {
    const st = host.getState() as { actingAs?: unknown } | null
    return typeof st?.actingAs === 'string' ? st.actingAs : undefined
  } catch {
    return undefined
  }
}

/** An assignee flags that their step cannot proceed — journaled for the agent
 *  and the rest of the team; the step stays open. */
function appendRunEvent(step: Step, kind: RunEvent['kind'], note?: string): void {
  if (!map?.confirmed) return
  const signed = step.type === 'approval' && step.resultId && kind === 'completed'
  const id = signed ? `approval:${step.resultId}` : globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  if (signed) kind = 'approval'
  const event: RunEvent = { id, ts: Date.now(), kind, stepId: step.id, label: step.label, actor: actingPersona(), note,
    ...(kind === 'completed' ? { values: structuredClone(step.resultData ?? {}), resultId: step.resultId } : {}) }
  ;(map.events ??= []).push(event)
}

export function reportProblem(stepId: string, note: string): void {
  const step = map?.steps.find((s) => s.id === stepId)
  if (!step || !note.trim()) return
  appendRunEvent(step, 'problem', note.trim())
  const persona = actingPersona()
  record(
    'user',
    'map',
    `PROBLEM reported on "${step.label}"${persona ? ` by ${persona}` : ''}: ${note} — step remains open; agent, read this and help.`,
  )
  notify()
}

/** A confirmed (running) playbook is read-only for every role — structural
 *  changes go through an explicit draft revision that must be re-confirmed. */
function structureLocked(): boolean {
  return !!(map?.confirmed || map?.saving)
}

/** Reopen the confirmed playbook as an editable draft revision (human gesture). */
export function reopenAsDraft(): void {
  if (!map || !map.confirmed) return
  map.confirmed = false
  pushEdit({ field: 'confirmed', to: 'false' })
  record(
    'user',
    'map',
    `reopened "${map.title}" as a draft revision — edits now allowed; re-confirm to save v${(map.version ?? 0) + 1}`,
  )
  notify()
}

/** Human edits made through the panel UI. Journaled so the agent can read them back. */
export function humanEditStep(stepId: string, field: 'label' | 'detail' | 'type', to: string): void {
  if (structureLocked()) return
  if (!map) return
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return
  const from = String(step[field] ?? '')
  if (from === to) return
  if (field === 'type') {
    step.type = to as StepType
    if (step.type !== 'approval') delete step.approvalPurpose
  }
  else step[field] = to
  pushEdit({ stepId, field, from, to })
  record('user', 'map', `edited step "${step.label}": ${field} → ${to}`)
  notify()
}

export function humanEditCondition(stepId: string, targetId: string, to: string): void {
  if (structureLocked()) return
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
  if (structureLocked() || !map) return
  map.editError = undefined
  const idx = map.steps.findIndex((s) => s.id === stepId)
  if (idx < 0) return
  const removed = map.steps[idx]
  const refuse = (reason: string) => {
    map!.editError = `Cannot remove “${removed.label}”: ${reason} Ask your agent to revise the connections and required inputs, then review the draft.`
    record('user', 'map', map!.editError)
    notify()
  }
  // Omitted next means the following task, while [] explicitly means end.
  const edgesOf = (s: Step, i: number): BranchTarget[] => s.next ?? (map!.steps[i + 1] ? [{to: map!.steps[i + 1].id}] : [])
  const successors = edgesOf(removed, idx)
  if (successors.length > 1 || successors.some(e => e.to === stepId)) {
    refuse('this would remove a branch decision or retry boundary. Choose the remaining routes explicitly first.'); return
  }
  const unassigned = (map.fields ?? []).filter(f => removed.fields?.includes(f.key) &&
    !map!.steps.some(s => s.id !== stepId && s.fields?.includes(f.key)))
  if (unassigned.length) { refuse(`reassign its required inputs first: ${unassigned.map(f => f.label ?? f.key).join(', ')}.`); return }
  const rewired = new Map<Step, BranchTarget[]>()
  for (let i = 0; i < map.steps.length; i++) {
    const s = map.steps[i]
    if (s === removed) continue
    const original = edgesOf(s, i)
    const incoming = original.filter(e => e.to === stepId)
    if (!incoming.length) continue
    const successor = successors[0]
    if (!successor) {
      if (original.length > 1 || incoming.some(e => e.condition || Object.keys(e.criteria ?? {}).length)) {
        refuse('ending this path would discard an incoming condition. Keep a terminal task or move the condition first.'); return
      }
      rewired.set(s, [])
      continue
    }
    if (successor.to === s.id || original.some(e => e.to === successor.to)) {
      refuse('the replacement would create a self-loop or duplicate route.'); return
    }
    const replacements: BranchTarget[] = []
    for (const edge of incoming) {
      // Both guards must hold (AND). Never overwrite a rule with the same key.
      const criteria = structuredClone(edge.criteria ?? {})
      for (const [key, rules] of Object.entries(successor.criteria ?? {})) {
        if (removed.fields?.includes(key)) {
          refuse(`“${key}” is measured again in this task. Combining observations from different stages would change the rule; keep this measurement or explicitly redesign it.`); return
        }
        if (!s.fields?.includes(key) && !(key in criteria)) {
          refuse(`the remaining task must collect “${key}” before it can enforce the outgoing condition.`); return
        }
        for (const [op, value] of Object.entries(rules)) {
          if (criteria[key]?.[op] !== undefined && criteria[key][op] !== value) {
            refuse(`the two “${key} ${op}” rules need an explicit combined condition.`); return
          }
          ;(criteria[key] ??= {})[op] = value
        }
      }
      const invalidCriteria = validateCriteria(criteria, map.fields)
      if (invalidCriteria) { refuse(invalidCriteria); return }
      replacements.push({to: successor.to,
        condition: [...new Set([edge.condition, successor.condition].filter(Boolean))].join(' AND ') || undefined,
        ...(Object.keys(criteria).length ? {criteria} : {})})
    }
    rewired.set(s, original.flatMap(e => e.to === stepId ? replacements.splice(0, 1) : [e]))
  }
  // Apply only after every incoming path has been checked; refusal is atomic.
  for (const [s, next] of rewired) {
    pushEdit({stepId: s.id, field: 'next', from: JSON.stringify(s.next), to: JSON.stringify(next)})
    s.next = next
  }
  if (map.entry === stepId) map.entry = successors[0]?.to ?? map.steps.find(s => s !== removed)?.id
  map.steps.splice(idx, 1)
  pushEdit({ stepId, field: 'removed', from: removed.label })
  record('user', 'map', `removed step "${removed.label}"; preserved conditions on ${rewired.size} incoming connection(s)`)
  notify()
}

export function humanConfirmMap(saver?: (m: ProcessMap) => Promise<{ id: string; version?: number }>): void {
  if (!map || map.confirmed || map.saving) return
  const invalid = validateFieldBindings(map)
  if (invalid) { map.saveError = invalid; notify(); return }
  const confirm = (current: ProcessMap) => {
    current.editError = undefined
    // A revised design is ready for a NEW execution. Do not present the
    // previous run's completed tasks or decisions as this version's work.
    current.decisions = []
    current.events = []
    current.steps = current.steps.map((step) => ({ ...step, done: false, naReason: undefined, resultId: undefined, completedBy: undefined, completedAt: undefined, resultData: undefined }))
    current.confirmed = true
    current.saving = false
    pushEdit({ field: 'confirmed', to: 'true' })
    record('user', 'map', `confirmed process "${current.title}"`)
    notify()
  }
  if (saver) {
    const current = map
    current.saveError = undefined
    current.saving = true
    notify()
    // The library stores the DESIGN, never a run's state: strip decisions and
    // per-step execution residue before saving.
    const clean: ProcessMap = {
      ...current,
      saving: undefined,
      saveError: undefined,
      editError: undefined,
      confirmed: true,
      decisions: [],
      events: [],
      resolvedGaps: current.resolvedGaps,
      steps: current.steps.map((s) => ({
        ...s,
        done: undefined,
        naReason: undefined,
        resultId: undefined,
        completedBy: undefined,
        completedAt: undefined,
        resultData: undefined,
      })),
    }
    saver(clean)
      .then((saved) => {
        current.saving = false
        if (map === current) {
          current.sourceProcessId = saved.id
          current.version = saved.version ?? current.version ?? 1
          confirm(current)
        }
        record(
          'user',
          'map',
          saved.version && saved.version > 1
            ? `saved "${current.title}" as v${saved.version} (id ${saved.id}) — same playbook, new immutable revision; earlier ids stay as history`
            : `saved "${current.title}" to the shared process library (id ${saved.id})`,
        )
      })
      .catch((err) => {
        record(
          'user',
          'map',
          `saving "${current.title}" FAILED: ${err instanceof Error ? err.message : err} — the map is back to draft; fix and confirm again`,
        )
        if (map === current) {
          current.saving = false
          current.confirmed = false
          current.saveError = `Could not save: ${err instanceof Error ? err.message : err}. Your draft is still here; try saving again.`
          notify()
        }
      })
  } else confirm(map)
}

/** Load a process someone saved earlier (already confirmed). Completion state starts fresh. */
export function loadSavedMap(
  loaded: ProcessMap,
  meta?: { id?: string; createdBy?: string; quiet?: boolean },
): void {
  map = {
    ...loaded,
    sourceProcessId: meta?.id ?? loaded.sourceProcessId,
    confirmed: true,
    editError: undefined,
    decisions: [],
    events: [],
    steps: loaded.steps.map((s) => ({
      ...s,
      done: false,
      naReason: undefined,
      resultId: undefined,
      completedBy: undefined,
      completedAt: undefined,
      resultData: undefined,
    })),
  }
  // A new execution never imports session actions. Only restoreRunState may
  // bring back work, using a specifically selected persisted run.
  if (!meta?.quiet) {
    record(
      'agent',
      'map',
      `loaded saved process "${loaded.title}"${meta?.createdBy ? ` (created by ${meta.createdBy})` : ''}`,
    )
  }
  notify()
}

/** Single completion path for human UI work and agent run_action alike. */
export function recordActionSuccess(
  actionName: string,
  resultId?: string,
  by: 'user' | 'agent' = 'user',
): void {
  if (resultId && map?.steps.some(s => s.done && s.action === actionName && s.resultId === resultId)) return
  markActionDone(actionName, resultId, by)
}

/** Auto-mark the first not-done step bound to this host action (agent replay path). */
export function markActionDone(
  actionName: string,
  resultId?: string,
  by: 'user' | 'agent' = 'agent',
): Step | null {
  if (!map?.confirmed) return null
  // Several steps may bind the same action (e.g. both sign-off lanes run
  // approve_review). The success belongs to the step that is actually LIVE:
  // never one sitting on a branch that was not taken.
  const statuses = progress()
  const candidates = map.steps.filter((s) => s.action === actionName && !s.done)
  let step = candidates.find((s) => statuses.get(s.id) === 'ready')
  // The task UI may have already completed the administrative request, or
  // a rejected review may be resubmitted. Attach the receipt only within the
  // currently ready approval's unsigned scope; never backfill arbitrary work.
  if (!step && actionName === 'request_review' && resultId) {
    const approvalIndex = map.steps.findIndex(s => s.type === 'approval' && ['ready', 'blocked'].includes(statuses.get(s.id) ?? ''))
    const before = map.steps.slice(0, Math.max(0, approvalIndex))
    const signedIndex = before.reduce((last, s, i) => s.type === 'approval' && s.done ? i : last, -1)
    step = before.slice(signedIndex + 1).reverse().find(s => s.action === actionName && s.done && statuses.get(s.id) === 'done')
  }
  if (!step) return null
  // A step that demands evidence completes only through its task card —
  // an action success carries no measured values.
  if (!step.done && step.fields?.length) {
    const needed = (map.fields ?? []).filter(
      (f) => step.fields!.includes(f.key) && (f.required || f.confirm),
    )
    if (needed.length) {
      record(
        by,
        'map',
        `"${step.label}" was performed but needs ${needed.map((f) => f.label ?? f.key).join(', ')} — complete it from the assignee's task card`,
      )
      notify()
      return null
    }
  }
  if (!step.done && (step.next?.length ?? 0) === 1 && step.next![0].criteria && Object.keys(step.next![0].criteria!).length) {
    record(by, 'map', `"${step.label}" has exit criteria — complete it from the task card with the measured values`)
    notify()
    return null
  }
  step.done = true
  delete step.naReason
  if (resultId) step.resultId = resultId
  const persona = actingPersona()
  step.completedBy = persona ?? step.completedBy
  step.completedAt = Date.now()
  appendRunEvent(step, 'completed', actionName === 'request_review' && resultId ? `Review request #${resultId} recorded` : undefined)
  record(by, 'map', `completed step "${step.label}"${persona ? ` (by ${persona})` : ''}`)
  notify()
  return step
}

/** Reopening evidence starts a new review cycle, including its administrative
 * request. Old completion events remain history, while live receipts are cleared. */
function reopenReviewRequests(fromIndex: number): void {
  if (!map) return
  for (const s of map.steps.slice(fromIndex + 1)) {
    if (s.type === 'approval' && s.done) break
    if (s.action !== 'request_review' || !s.done) continue
    appendRunEvent(s, 'reopened', `Evidence reopened; previous request${s.resultId ? ` #${s.resultId}` : ''} is historical`)
    s.done = false
    delete s.naReason
    s.resultId = undefined
    s.completedBy = undefined
    s.completedAt = undefined
    s.resultData = undefined
  }
}

/** Agent refines a single step in place (e.g. writing captured judgment into its note). */
export function agentUpdateStep(
  stepId: string,
  patch: {
    label?: string
    detail?: string
    action?: string
    humanOnly?: boolean
    role?: string
    fields?: string[]
    approvalPurpose?: 'work' | 'plan'
  },
  branch?: { to: string; condition?: string; criteria?: Record<string, Record<string, number | string | boolean>> },
): { ok: boolean; error?: string; detail?: string; step?: Step } {
  if (!map) return { ok: false, error: 'no process map exists yet — propose one first' }
  if (structureLocked())
    return {
      ok: false,
      error: 'confirmed_readonly',
      detail:
        'This playbook is confirmed and running — its structure is read-only for every role. To revise it, propose_process_map a new draft (the human re-confirms it as the next version), or ask the human to press "Propose changes" on the panel.',
    }
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return { ok: false, error: `unknown step "${stepId}"` }
  const changed: string[] = []
  if (patch.approvalPurpose !== undefined && (step.type !== 'approval' || !['work', 'plan'].includes(patch.approvalPurpose)))
    return {ok: false, error: 'Set approvalPurpose to work or plan on an approval step.'}
  if (patch.role !== undefined && patch.role !== '') {
    const st = host.getState() as { users?: Array<{ role?: unknown }> } | null
    const known = Array.isArray(st?.users)
      ? [...new Set(st.users.map((u) => u?.role).filter((r): r is string => typeof r === 'string'))]
      : []
    if (known.length && !known.includes(patch.role)) {
      return {
        ok: false,
        error: `unknown role "${patch.role}" — this workspace's roles are: ${known.join(', ')}`,
      }
    }
  }
  for (const field of ['label', 'detail', 'action', 'role'] as const) {
    const value = patch[field]
    if (value !== undefined && value !== step[field]) {
      step[field] = value
      changed.push(field)
    }
  }
  if (patch.approvalPurpose !== undefined) { step.approvalPurpose = patch.approvalPurpose; changed.push('approvalPurpose') }
  if (patch.fields !== undefined) {
    const contract = new Set((map.fields ?? []).map((f) => f.key))
    const bad = patch.fields.filter((k) => typeof k === 'string' && !contract.has(k))
    if (bad.length) {
      return {
        ok: false,
        error: `unknown field key(s) ${bad.join(', ')} — declare them first with update_map_fields; the contract currently has: ${[...contract].join(', ') || 'none'}`,
      }
    }
    step.fields = patch.fields.filter((k) => typeof k === 'string')
    changed.push('fields')
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
  map.editError = undefined
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

function retrySignatureError(stepId: string, branchTo: string): string | null {
  if (!map) return null
  const from = map.steps.findIndex(s => s.id === stepId)
  const to = map.steps.findIndex(s => s.id === branchTo)
  if (to < 0 || to > from) return null
  const signature = map.steps.slice(to).find(s => s.type === 'approval' && s.done)
  return signature ? `This retry crosses work already signed off at “${signature.label}”. Start a new execution to record a correction.` : null
}

export function resolveDecision(
  stepId: string,
  branchTo: string,
  reason: string,
  evidence?: string,
  by: 'user' | 'agent' = 'user',
  measurements?: Record<string, unknown>,
): { ok: boolean; error?: string; detail?: string; reopened?: string[] } {
  if (!map) return { ok: false, error: 'no process is loaded' }
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return { ok: false, error: `unknown step "${stepId}"` }
  const edge = step.next?.find((e) => e.to === branchTo)
  if (!edge) return { ok: false, error: `step "${stepId}" has no edge to "${branchTo}"` }
  if (!map.confirmed)
    return { ok: false, error: 'draft_not_running', detail: 'This map is an unconfirmed draft — decisions are recorded only on a confirmed, running playbook.' }
  // Role separation: a decision owned by a role is resolved only by that role.
  {
    const role = host.actorRole()
    if (step.role && role && step.role !== role) {
      return {
        ok: false,
        error: 'role_mismatch',
        detail: `The decision "${step.label}" belongs to the ${step.role} role; the active persona's role is ${role}. Switch persona first.`,
      }
    }
  }
  // Order enforcement: a decision may only be resolved when it IS the live
  // gate — recording outcomes for steps not yet reached is how audit trails
  // get falsified, so it is refused, not warned.
  const live = progress()
  if (map.confirmed && lastPendingDecision?.id !== stepId) {
    const orderNow = new Map(map.steps.map((s, i) => [s.id, i]))
    const myIdx = orderNow.get(stepId) ?? 0
    const unfinished = map.steps
      .filter((s, i) => i < myIdx && s.type !== 'decision' && !s.done && !s.naReason)
      .filter((s) => {
        const st = live.get(s.id)
        return st !== 'not_applicable' && st !== 'conditional'
      })
      .map((s) => s.label)
    return {
      ok: false,
      error: 'out_of_sequence',
      detail: `The decision "${step.label}" is not awaiting resolution${
        lastPendingDecision ? ` — the live gate is "${lastPendingDecision.label}"` : ''
      }.${unfinished.length ? ` Complete first: ${unfinished.join(' → ')}.` : ''} Check get_process_progress before resolving.`,
    } as { ok: boolean; error: string; detail?: string }
  }

  // Safety: a branch with machine-checkable criteria is verified HERE, not
  // trusted to the caller. Violated criteria refuse the branch outright —
  // the right follow-up is "are the measurements wrong, or is this the
  // failure branch?", never "override anyway".
  if (edge.criteria && Object.keys(edge.criteria).length > 0) {
    // The assignee's submitted step values are the authoritative record: a
    // caller cannot 'improve' them in the resolve call.
    const submitted: Record<string, unknown> = {}
    for (const s of map.steps) if (s.done && s.resultData) Object.assign(submitted, s.resultData)
    const contradictions: string[] = []
    for (const key of Object.keys(edge.criteria)) {
      if (key in submitted && measurements?.[key] !== undefined && measurements[key] !== submitted[key]) {
        contradictions.push(`${key}: submitted ${submitted[key]}, claimed ${measurements[key]}`)
      }
    }
    if (contradictions.length) {
      record(by, 'map', `REFUSED branch at "${step.label}": claimed measurements contradict the assignee's submissions — ${contradictions.join('; ')}`)
      return {
        ok: false,
        error: `evidence_conflict: your measurements contradict what the assignee actually submitted — ${contradictions.join('; ')}. The submitted values are the record; to change them the assignee must redo the step.`,
      }
    }
    const violated: string[] = []
    const missing: string[] = []
    for (const [key, rule] of Object.entries(edge.criteria)) {
      const m = measurements?.[key] ?? submitted[key]
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
  const signatureError = retrySignatureError(stepId, branchTo)
  if (signatureError) return {ok: false, error: 'signed_work_immutable', detail: signatureError}
  if (!map.decisions) map.decisions = []
  map.decisions.push({ stepId, to: branchTo, reason, evidence: evidence ?? (measurements ? JSON.stringify(measurements) : undefined),
    measurements: measurements ? structuredClone(measurements) : undefined, ts: Date.now() })
  // Measured resolutions are worth keeping on the business record itself,
  // together with WHERE they routed the run — a remediation branch can also
  // point forward, so direction alone says nothing about pass/fail.
  if (measurements) {
    const targetStep = map.steps.find((s) => s.id === branchTo)
    const producedIds = map.steps
      .filter((s) => s.resultId)
      .map((s) => ({ step: s.label, action: s.action, id: s.resultId! }))
    void Promise.resolve(
      host.getProcessStore()?.saveVerification?.(measurements, {
        stepId,
        branchTo,
        producedIds,
        branchLabel: targetStep?.label,
        toApproval: targetStep?.type === 'approval',
        criteriaChecked: !!(edge.criteria && Object.keys(edge.criteria).length > 0),
      }),
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
    // Loop-back: the loop body (target through the branching step) runs again,
    // and every decision inside it must be re-resolved on the retry.
    const resetDecisions: string[] = []
    for (const s of map.steps) {
      const i = idx.get(s.id) ?? 0
      if (i < to || i > from) continue
      if (s.type !== 'decision' && (s.done || s.naReason)) {
        appendRunEvent(s, 'reopened', `Retry from ${step.label}`)
        s.done = false
        delete s.naReason
        s.completedBy = undefined
        s.completedAt = undefined
        s.resultData = undefined
        s.resultId = undefined
        reopened.push(s.label)
      }
      if (s.id !== stepId && (s.next?.length ?? 0) > 1) {
        let had = false
        for (const d of map.decisions ?? []) {
          if (d.stepId === s.id && !d.invalidated) {
            d.invalidated = true
            had = true
          }
        }
        if (had) resetDecisions.push(s.label)
      }
    }
    if (reopened.length) record(by, 'map', `re-opened for the loop: ${reopened.join('; ')}`)
    if (resetDecisions.length)
      record(by, 'map', `decision(s) reset for the retry — must be re-resolved: ${resetDecisions.join('; ')}`)
    reopenReviewRequests(to)
  }
  notify()
  return { ok: true, reopened }
}

/** Set/replace the playbook's data contract (from the required_context interview). */
export function setMapFields(fields: FieldDef[]): { ok: boolean; error?: string; detail?: string; fields?: FieldDef[] } {
  if (structureLocked())
    return {
      ok: false,
      error: 'confirmed_readonly',
      detail: 'The playbook is confirmed and running — its data contract is read-only. Revise via a new draft (propose_process_map or the Propose changes button).',
    }
  if (!map) return { ok: false, error: 'no process map exists yet — propose one first' }
  const invalid = validateFields(fields)
  if (invalid) return { ok: false, error: invalid }
  const keys = new Set(fields.map(f => f.key))
  const referenced = map.steps.flatMap(s => s.fields ?? []).filter(k => !keys.has(k))
  if (referenced.length) return {ok: false, error: `Unassign fields from their steps before removing them: ${referenced.join(', ')}`}
  map.fields = fields
  map.editError = undefined
  record('agent', 'map', `defined the playbook's data contract (${fields.map((f) => f.key).join(', ')})`)
  notify()
  return { ok: true, fields }
}

/** Human checks a step off (or un-checks it) in the panel. */
function mapLooksComplete(): boolean {
  if (!map?.confirmed) return false
  const statuses = progress()
  const open = map.steps.filter(
    (s) =>
      s.type !== 'decision' &&
      ['ready', 'blocked', 'skipped', 'pending'].includes(statuses.get(s.id) ?? ''),
  )
  return open.length === 0 && !lastPendingDecision
}

let lastCompletionError: string | null = null
export function getCompletionError(): string | null { return lastCompletionError }
function refuseCompletion(reason: string): false {
  lastCompletionError = reason
  record('user', 'map', reason)
  notify()
  return false
}

export function humanToggleStepDone(
  stepId: string,
  values?: Record<string, unknown>,
  opts?: { allowSkip?: boolean },
): boolean {
  lastCompletionError = null
  {
    const step = map?.steps.find((s) => s.id === stepId)
    const role = host.actorRole()
    if (step && !step.done && map?.confirmed && step.next?.length === 1) {
      for (const edge of step.next ?? []) {
        const reason = retrySignatureError(stepId, edge.to)
        if (reason) return refuseCompletion(reason)
      }
    }
    if (step?.type === 'approval') {
      return refuseCompletion(`blocked: "${step.label}" completes only via a successful review action`)
    }
    if (step?.role && role && step.role !== role && !step.done) {
      return refuseCompletion(`blocked: "${step.label}" belongs to ${step.role}; active persona is ${role}`)
    }
    if (step && step.done && mapLooksComplete()) {
      return refuseCompletion(`blocked: the run is complete — its record is frozen; start a new run to redo work`)
    }
    if (step && step.done) {
      const index = map!.steps.indexOf(step)
      if (map!.steps.slice(index + 1).some((s) => s.type === 'approval' && s.done)) {
        return refuseCompletion('This work has already been signed off. Start a new execution to record a correction.')
      }
      // Un-completing is reserved for the persona who did it (or its owning role).
      const persona = actingPersona()
      const allowed = !step.completedBy || step.completedBy === persona || (step.role && role && step.role === role)
      if (!allowed) {
        return refuseCompletion(`blocked: "${step.label}" was completed by ${step.completedBy}; only they (or the ${step.role ?? 'owning'} role) may reopen it`)
      }
    }
    // Exit criteria on a NON-branching step gate its completion: "restore
    // succeeded" encoded on the only outgoing edge must hold to complete.
    // (Branching steps route via resolve_decision — not enforced here.)
    if (step && !step.done && map?.confirmed && (step.next?.length ?? 0) === 1) {
      const edge = step.next![0]
      if (edge.criteria && Object.keys(edge.criteria).length > 0) {
        const violated: string[] = []
        for (const [key, rule] of Object.entries(edge.criteria)) {
          const v = values?.[key] ?? step.resultData?.[key]
          for (const [op, target] of Object.entries(rule)) {
            if (op === 'eq' && v !== target) violated.push(`${key} must equal ${target} (got ${v ?? 'nothing'})`)
            else if (op === 'ne' && v === target) violated.push(`${key} must not equal ${target}`)
            else if (['lt', 'lte', 'gt', 'gte'].includes(op)) {
              const n = Number(v)
              const t = Number(target)
              const okNum =
                !Number.isNaN(n) &&
                ((op === 'lt' && n < t) || (op === 'lte' && n <= t) || (op === 'gt' && n > t) || (op === 'gte' && n >= t))
              if (!okNum) violated.push(`${key} must be ${op} ${target} (got ${v ?? 'nothing'})`)
            }
          }
        }
        if (violated.length) {
          return refuseCompletion(`blocked: "${step.label}" cannot complete — its exit criteria failed: ${violated.join('; ')}`)
        }
      }
    }
    if (step && !step.done && map?.confirmed) {
      const st0 = progress().get(stepId)
      if (st0 === 'not_applicable' || st0 === 'conditional') {
        return refuseCompletion(`blocked: "${step.label}" is not on the active path — its branch was not taken`)
      }
    }
    if (step && !step.done && !opts?.allowSkip && map?.confirmed) {
      const st = progress().get(stepId)
      if (st === 'pending') {
        return refuseCompletion(`blocked: "${step.label}" is not the next step — finish earlier steps first (or skip explicitly from the panel)`)
      }
    }
    if (step && !step.done) {
      if (step.fields?.length) {
        const relevant = (map?.fields ?? []).filter((f) => step.fields!.includes(f.key))
        const missing = validateFieldValues(relevant, values)
        if (relevant.length !== step.fields.length) missing.push('The task references an undefined field; revise its playbook.')
        if (missing.length) {
          return refuseCompletion(`blocked: "${step.label}" — ${missing.join('; ')}`)
        }
      }
      const persona = actingPersona()
      step.completedBy = persona ?? undefined
      step.completedAt = Date.now()
      if (values && Object.keys(values).length) step.resultData = values
    } else if (step && step.done) {
      // A new submission needs new decisions, even while its old review is pending.
      const idx = map!.steps.findIndex((s) => s.id === step.id)
      const downstream = new Set(map!.steps.slice(idx).map((s) => s.id))
      for (const d of map!.decisions ?? []) if (downstream.has(d.stepId)) d.invalidated = true
      step.completedBy = undefined
      step.completedAt = undefined
      step.resultData = undefined
      step.resultId = undefined
      reopenReviewRequests(idx)
    }
  }
  if (!map) return false
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return false
  step.done = !step.done
  appendRunEvent(step, step.done ? 'completed' : 'reopened')
  pushEdit({ stepId, field: 'done', to: String(step.done) })
  {
    const persona = actingPersona()
    const vals = step.resultData
      ? ` — submitted: ${Object.entries(step.resultData)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`
      : ''
    record(
      'user',
      'map',
      `${step.done ? 'completed' : 'reopened'} step "${step.label}"${persona ? ` (by ${persona})` : ''}${step.done ? vals : ''}`,
    )
  }
  // A task whose outgoing edge points BACKWARD is a retry instruction: its
  // completion reopens the loop body exactly like a decision loop-back —
  // otherwise the run would silently read as finished with stale failures.
  if (step.done && map && step.next?.length === 1) {
    const idx = new Map(map.steps.map((s, i) => [s.id, i]))
    const from = idx.get(step.id) ?? 0
    for (const e of step.next ?? []) {
      const to = idx.get(e.to) ?? 0
      if (to > from) continue
      const reopened: string[] = []
      const resetDecisions: string[] = []
      for (const s of map.steps) {
        const i = idx.get(s.id) ?? 0
        if (i < to || i > from) continue
        if (s.type !== 'decision' && (s.done || s.naReason)) {
          appendRunEvent(s, 'reopened', `Retry from ${step.label}`)
          s.done = false
          delete s.naReason
          s.completedBy = undefined
          s.completedAt = undefined
          s.resultData = undefined
          s.resultId = undefined
          reopened.push(s.label)
        }
        if ((s.next?.length ?? 0) > 1) {
          let had = false
          for (const d of map.decisions ?? []) {
            if (d.stepId === s.id && !d.invalidated) {
              d.invalidated = true
              had = true
            }
          }
          if (had) resetDecisions.push(s.label)
        }
      }
      if (reopened.length)
        record('user', 'map', `"${step.label}" loops back — re-opened for the retry: ${reopened.join('; ')}`)
      if (resetDecisions.length)
        record('user', 'map', `decision(s) reset for the retry — must be re-resolved: ${resetDecisions.join('; ')}`)
      reopenReviewRequests(to)
    }
  }
  notify()
  return true
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
    | 'field_assignment'
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
      kind: 'precursors',
      stepId: first.id,
      step: first.label,
      question_goal: 'Identify early signs an experienced person notices before this situation becomes a problem',
      missing_information: ['early warning signs', 'what to watch or check'],
      fallback_question: 'Are there early signs that usually precede this situation?',
    })
  }
  for (const step of actionable.filter(s => s.type === 'task' && !s.fields?.length)) gaps.push({
    kind: 'required_context', stepId: step.id, step: step.label,
    question_goal: `Find which measurements, maintained values or choices the owner must record for "${step.label}"; ask explicitly whether any are needed.`,
    missing_information: ['numeric values and units', 'dropdown choices and their allowed options', 'required vs optional inputs', 'who records each value and in which task', 'pass/fail thresholds', 'which next task each routing choice leads to'],
    fallback_question: `Which numbers or choices should the next owner record for "${step.label}"?`,
    note: 'Define fields with update_map_fields, then bind their keys to this task with update_step.fields. Use type select with options for a dropdown. If no inputs are needed, record that answer for required_context:stepId.',
  })
  const bindingError = validateFieldBindings(map)
  if (bindingError) gaps.push({kind: 'field_assignment', note: bindingError, question_goal: 'Ensure every input will appear on the responsible task card.'})
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
    const edges = s.next ?? []
    // One criteria-carrying edge is enough: its siblings act as the
    // else-branches (a failure route needs no mirror-image thresholds).
    if (edges.some((e) => e.criteria && Object.keys(e.criteria).length > 0)) continue
    const fwd = edges.find((e) => (orderIdx.get(e.to) ?? 0) > (orderIdx.get(s.id) ?? 0))
    if (!fwd) continue
    gaps.push({
      kind: 'pass_criteria',
      stepId: s.id,
      step: s.label,
      note: `No edge of the decision "${s.label}" carries machine-checkable criteria — the engine cannot refuse a wrong pass-choice. Encode the PASS edge's thresholds via update_step {stepId, branch_to, branch_criteria: {...}} (the other edges then act as the else-branches). If no thresholds were stated, ask via ask_user.`,
    })
  }
  const resolved = new Set(map.resolvedGaps ?? [])
  lastFallbacks = gaps.map((g) => g.fallback_question).filter((q): q is string => !!q)
  return gaps.filter((g) => g.kind === 'field_assignment' || (!resolved.has(g.stepId ? `${g.kind}:${g.stepId}` : g.kind) && !resolved.has(g.kind)))
}

/** Reapply a persisted run's progress onto the freshly loaded map (page reload). */
export function restoreRunState(
  steps: Array<{
    id?: unknown
    status?: unknown
    resultId?: unknown
    naReason?: unknown
    completedBy?: unknown
    completedAt?: unknown
    resultData?: unknown
  }>,
  decisions?: unknown[],
  events?: RunEvent[],
  replace = false,
): number {
  if (!map) return 0
  if (replace) {
    for (const step of map.steps) {
      step.done = false
      step.resultId = undefined
      step.naReason = undefined
      step.completedBy = undefined
      step.completedAt = undefined
      step.resultData = undefined
    }
    map.decisions = []
  }
  let applied = 0
  for (const ps of steps) {
    if (typeof ps?.id !== 'string') continue
    const st = map.steps.find((s) => s.id === ps.id)
    if (!st) continue
    if (ps.status === 'done') {
      st.done = true
      applied++
    }
    if (typeof ps.resultId === 'string') st.resultId = ps.resultId
    if (typeof ps.naReason === 'string') st.naReason = ps.naReason
    if (typeof ps.completedBy === 'string') st.completedBy = ps.completedBy
    if (typeof ps.completedAt === 'number') st.completedAt = ps.completedAt
    if (ps.resultData && typeof ps.resultData === 'object')
      st.resultData = ps.resultData as Record<string, unknown>
  }
  if (Array.isArray(decisions) && decisions.length) {
    map.decisions = decisions as typeof map.decisions
  }
  map.events = structuredClone(events ?? [])
  notify()
  return applied
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
  if (mapLooksComplete())
    throw new Error(
      'The run is complete and signed off — its record is frozen. Corrections require a new run (or an explicit audit-correction process), not a deviation.',
    )
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) throw new Error(`unknown step "${stepId}" — see get_process_map for step ids`)
  if (step.type === 'approval')
    throw new Error(`"${step.label}" is an approval step — it completes only through a successful review action, never a deviation.`)
  {
    const role = host.actorRole()
    if (step.role && role && step.role !== role)
      throw new Error(`"${step.label}" belongs to the ${step.role} role; the active persona's role is ${role}. Switch persona first.`)
  }
  if (resolution === 'completed') {
    if (step.fields?.length) {
      const needed = (map?.fields ?? []).filter(
        (f) => step.fields!.includes(f.key) && (f.required || f.confirm),
      )
      if (needed.length)
        throw new Error(
          `"${step.label}" requires ${needed.map((f) => f.label ?? f.key).join(', ')} — a deviation cannot skip required evidence; the assignee must complete it from their task card, or resolve it as not_applicable with a reason.`,
        )
    }
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
  const decs = map?.decisions?.filter((x) => x.stepId === d.id && !x.invalidated) ?? []
  if (decs.length === 0) return false
  const last = decs[decs.length - 1]
  return (order.get(last.to) ?? 0) > (order.get(d.id) ?? 0)
}

/** Forward footprint of each branching step: which steps are exclusive to
 *  which outgoing edge (loop-backs excluded). */
function branchFootprints(steps: Step[]): Array<{
  stepId: string
  branches: Array<{ to: string; exclusive: Set<string> }>
}> {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const order = new Map(steps.map((s, i) => [s.id, i]))
  const reach = (from: string, acc: Set<string>) => {
    if (acc.has(from)) return
    acc.add(from)
    for (const e of byId.get(from)?.next ?? []) {
      if ((order.get(e.to) ?? 0) > (order.get(from) ?? 0)) reach(e.to, acc)
    }
  }
  const out: Array<{ stepId: string; branches: Array<{ to: string; exclusive: Set<string> }> }> = []
  for (const d of steps.filter((s) => (s.next?.length ?? 0) > 1)) {
    const dIdx = order.get(d.id) ?? 0
    const forward = (d.next ?? []).filter((e) => (order.get(e.to) ?? 0) > dIdx)
    if (forward.length < 2) continue
    const per = forward.map((e) => {
      const set = new Set<string>()
      reach(e.to, set)
      return { to: e.to, set }
    })
    const common = per.map((b) => b.set).reduce((a, b) => new Set([...a].filter((x) => b.has(x))))
    out.push({
      stepId: d.id,
      branches: per.map((b) => ({ to: b.to, exclusive: new Set([...b.set].filter((x) => !common.has(x))) })),
    })
  }
  return out
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
  // Resolved decisions activate their chosen branch (steps leave the
  // conditional set) and deactivate the branches not taken (not_applicable).
  const choice = new Map<string, string>()
  for (const d of map.decisions ?? []) if (!d.invalidated) choice.set(d.stepId, d.to)
  const inactive = new Set<string>()
  for (const fp of branchFootprints(map.steps)) {
    const chosen = choice.get(fp.stepId)
    if (!chosen) continue
    const chosenIsForward = fp.branches.some((b) => b.to === chosen)
    if (!chosenIsForward) continue
    for (const b of fp.branches) {
      for (const id of b.exclusive) {
        if (b.to === chosen) conditional.delete(id)
        else inactive.add(id)
      }
    }
  }
  for (const id of inactive) conditional.delete(id)
  const actionable = map.steps.filter((s) => s.type !== 'decision')
  // Not-applicable steps count as handled for ordering purposes.
  // The ordering baseline counts only steps on the ACTIVE path: a completed
  // step sitting on a now-inactive/conditional branch (e.g. the dry-run that
  // just triggered a retry loop) must not make reopened earlier steps read
  // as 'skipped' — they are the live work again.
  const lastHandledIdx = actionable.reduce(
    (acc, s, i) =>
      (s.done || s.naReason) && !conditional.has(s.id) && !inactive.has(s.id) ? i : acc,
    -1,
  )
  // Any step with 2+ outgoing edges needs its outcome resolved — including the
  // common fail-loops-back / pass-goes-forward shape (1 forward + 1 back edge).
  const hasBranching = (s: Step) => (s.next?.length ?? 0) >= 2
  let gateAssigned = false
  let aIdx = -1
  for (const s of map.steps) {
    if (s.type === 'decision') {
      // Only a LIVE decision gates: one on a branch that was not taken (or
      // still conditional) cannot hold the run hostage.
      if (inactive.has(s.id)) {
        statuses.set(s.id, 'not_applicable')
        continue
      }
      if (conditional.has(s.id)) {
        statuses.set(s.id, 'conditional')
        continue
      }
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
    else if (inactive.has(s.id)) statuses.set(s.id, 'not_applicable')
    else if (conditional.has(s.id)) statuses.set(s.id, 'conditional')
    else if (aIdx < lastHandledIdx) statuses.set(s.id, 'skipped')
    else if (!gateAssigned) {
      const reason = s.action && preconditionFor ? preconditionFor(s.action) : null
      statuses.set(s.id, reason ? 'blocked' : 'ready')
      gateAssigned = true
    } else statuses.set(s.id, 'pending')
    // A completed TASK that branches also needs its outcome resolved before
    // anything later runs (e.g. verification done — passed or failed?).
    // An excused (N/A) or not-taken/conditional branching step never gates.
    if (
      s.done &&
      hasBranching(s) &&
      !gateAssigned &&
      !forwardResolved(s, order) &&
      !inactive.has(s.id) &&
      !conditional.has(s.id)
    ) {
      lastPendingDecision = s
      gateAssigned = true
    }
  }
  return statuses
}

/** The decision that still describes the run's current route.
 *
 * Decisions remain in `map.decisions` as an audit trail after a later branch
 * makes their step conditional or not applicable. Agent-facing current-state
 * views must not present those historical records as the active choice.
 */
export function currentDecision(
  stepId: string,
  statuses: Map<string, StepStatus> = progress(),
): NonNullable<ProcessMap['decisions']>[number] | null {
  const status = statuses.get(stepId)
  if (status === 'conditional' || status === 'not_applicable') return null
  return map?.decisions?.filter((d) => d.stepId === stepId && !d.invalidated).slice(-1)[0] ?? null
}

export function editsSince(cursor = 0): MapEdit[] {
  return edits.filter((e) => e.id > cursor)
}

export function orderedSteps(): Step[] {
  return map ? map.steps : []
}
