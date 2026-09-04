import {routeProgress} from './route.js'

function refuse(error, detail, status = 409) {
  throw Object.assign(new Error(error), { status, code: error, detail })
}

function sameValue(a, b) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null))
}

function primitiveRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, v]) =>
    ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v))))
}

export function criteriaResult(criteria, values) {
  const rules = Object.entries(criteria ?? {})
  if (!rules.length) return true
  if (rules.some(([key]) => values[key] == null)) return null
  return rules.every(([key, rule]) => Object.entries(rule).every(([op, target]) => {
    const value = values[key]
    if (op === 'eq') return value === target
    if (op === 'ne') return value !== target
    if (typeof value !== 'number' || typeof target !== 'number') return false
    return op === 'gt' ? value > target : op === 'gte' ? value >= target :
      op === 'lt' ? value < target : op === 'lte' ? value <= target : false
  }))
}

/** Return the next task/approval or unresolved decision on the persisted route.
 * The target task is treated as unfinished, even when the submitted snapshot
 * marks it done, so a direct jump cannot make itself look eligible. */
function liveGate(map, steps, decisions, targetId) {
  return routeProgress(map, steps, decisions, targetId).next
}

function evidenceForDecision(map, steps, decision) {
  const design = map?.steps ?? []
  const decisionIndex = design.findIndex((step) => step.id === decision.stepId)
  const submitted = {}
  for (const designStep of design.slice(0, Math.max(0, decisionIndex + 1))) {
    const runtime = steps.find((step) => step.id === designStep.id)
    if (runtime?.status === 'done') Object.assign(submitted, primitiveRecord(runtime.resultData))
  }
  const claimed = primitiveRecord(decision.measurements)
  for (const [key, value] of Object.entries(submitted)) {
    if (key in claimed && !sameValue(claimed[key], value))
      refuse('evidence_conflict', `Decision evidence for ${key} conflicts with the assignee's submitted value.`)
  }
  return { ...claimed, ...submitted }
}

function isNewDecision(decision, previous = []) {
  return !previous.some((old) => old?.stepId === decision.stepId && old?.to === decision.to &&
    old?.ts === decision.ts && Boolean(old?.invalidated) === Boolean(decision.invalidated))
}

/**
 * Revalidate a browser run snapshot inside the storage transaction.
 * `authority` must be derived from the authenticated session, never request
 * text alone. The returned patch is safe to persist.
 */
export function enforceRunUpdate(run, patch, map, authority) {
  if (!authority) return patch // trusted internal storage maintenance/tests
  const design = map?.steps ?? []
  const incoming = Array.isArray(patch.steps) ? structuredClone(patch.steps) : structuredClone(run.steps ?? [])
  const previous = run.steps ?? []
  const decisions = Array.isArray(patch.decisions) ? structuredClone(patch.decisions) : structuredClone(run.decisions ?? [])
  const byDesign = new Map(design.map((step) => [step.id, step]))
  const oldById = new Map(previous.map((step) => [step.id, step]))
  const now = Date.now()

  if (patch.decisions) {
    for (const old of run.decisions ?? []) {
      const current = decisions.find(item => item?.stepId === old?.stepId && item?.to === old?.to && item?.ts === old?.ts)
      if (!current) refuse('decision_history_immutable', 'Past decisions cannot be deleted from the run audit trail.')
      // Older/open browser tabs do not know server-stamped attribution. Preserve
      // it rather than treating omission as an attempted rewrite.
      if (current.decidedBy === undefined) current.decidedBy = old.decidedBy
      if (current.authenticatedBy === undefined) current.authenticatedBy = old.authenticatedBy
      if (!old.invalidated && current.invalidated) {
        const expected = {...old, invalidated:true}
        if (!sameValue(current, expected)) refuse('decision_history_immutable', 'Invalidating a decision cannot rewrite its evidence or attribution.')
      } else if (!sameValue(current, old)) {
        refuse('decision_history_immutable', 'Past decision evidence and attribution are immutable.')
      }
    }
  }

  for (const decision of decisions.filter((item) => item && !item.invalidated)) {
    const step = byDesign.get(decision.stepId)
    const edge = step?.next?.find((candidate) => candidate.to === decision.to)
    if (!step || step.type !== 'decision' || !edge)
      refuse('invalid_decision', 'The decision or selected branch is not part of the saved playbook.', 400)
    if (isNewDecision(decision, run.decisions) && step.role && authority.role !== step.role)
      refuse('role_mismatch', `The ${step.role} role must resolve ${step.label || step.id}.`, 403)
    const withoutCurrent = decisions.filter((item) => item !== decision &&
      (item.stepId !== decision.stepId || item.invalidated))
    const gate = liveGate(map, incoming, withoutCurrent)
    if (!gate || gate.type !== 'decision' || gate.id !== decision.stepId)
      refuse(isNewDecision(decision, run.decisions) ? 'out_of_sequence' : 'stale_decision',
        `${step.label || step.id} no longer has complete prerequisite evidence; invalidate it before changing that evidence.`)
    const values = evidenceForDecision(map, incoming, decision)
    const result = criteriaResult(edge.criteria, values)
    if (result === null) refuse('evidence_missing', 'The selected branch requires measurements that have not been submitted.')
    if (result === false) refuse('evidence_conflict', 'The selected branch contradicts the persisted task evidence.')
    if (isNewDecision(decision, run.decisions)) {
      decision.decidedBy = authority.actor
      decision.authenticatedBy = authority.authenticatedAs
      decision.ts = Number.isFinite(decision.ts) ? decision.ts : now
    }
  }

  const substantive = []
  for (const step of incoming) {
    if (step.type === 'gate') continue
    const saved = oldById.get(step.id)
    const definition = byDesign.get(step.id)
    if (!saved || !definition) continue
    step.label = definition.label
    step.type = definition.type
    step.action = definition.action
    step.role = definition.role
    // `conditional` and branch-derived `not_applicable` are routing output,
    // not work performed by that step's assignee. A human deviation carries
    // naReason and remains accountable; a real completion is `done`.
    const newlyTerminal = (step.status === 'done' && saved.status !== 'done') ||
      (step.status === 'not_applicable' && Boolean(step.naReason) &&
        (saved.status !== 'not_applicable' || !saved.naReason))
    const changedEvidence = step.status === 'done' && saved.status === 'done' &&
      (!sameValue(step.resultData, saved.resultData) || !sameValue(step.resultId, saved.resultId))
    const reopened = saved.status === 'done' && step.status !== 'done'
    if (definition.type === 'approval' && step.status === 'done' && saved.status !== 'done')
      refuse('approval_server_owned', 'Approval steps can only be completed by the server after the assigned review is accepted.', 403)
    if (!newlyTerminal && !changedEvidence && !reopened) {
      if (step.status === 'done' && saved.status === 'done') {
        step.completedBy = saved.completedBy
        step.authenticatedBy = saved.authenticatedBy
        step.completedAt = saved.completedAt
      }
      continue
    }
    if (definition.role && authority.role !== definition.role)
      refuse('role_mismatch', `The ${definition.role} role must complete ${definition.label || definition.id}.`, 403)
    if (newlyTerminal) {
      const gate = liveGate(map, incoming, decisions, step.id)
      if (!gate || gate.type === 'decision' || gate.id !== step.id)
        refuse('out_of_sequence', `${definition.label || definition.id} is not the next required step.`)
    }
    step.completedBy = authority.actor
    step.authenticatedBy = authority.authenticatedAs
    step.completedAt = now
    if (reopened) {
      delete step.completedBy
      delete step.authenticatedBy
      delete step.completedAt
      delete step.resultId
      delete step.resultData
    }
    substantive.push(step.id)
  }
  if (substantive.length > 1)
    refuse('multiple_step_transition', 'Complete one assigned step per server update so each transition has a single accountable actor.')

  if (patch.status === 'abandoned' && authority.authenticatedAs !== run.startedBy && !authority.canAdmin)
    refuse('not_run_owner', 'Only the run owner may abandon this execution.', 403)

  const events = Array.isArray(patch.events) ? patch.events.map((event) => {
    if ((run.events ?? []).some((old) => old.id === event.id)) return event
    if (event.kind === 'approval')
      refuse('approval_server_owned', 'Approval audit events are written only by the server.', 403)
    const definition = byDesign.get(event.stepId) ??
      (event.stepId?.startsWith('gate:') ? byDesign.get(event.stepId.slice(5)) : undefined)
    if (!definition) refuse('invalid_event_step', 'Audit events must reference a saved playbook step.', 400)
    return { ...event, label: definition.label || definition.id, actor: authority.actor, authenticatedBy: authority.authenticatedAs }
  }) : patch.events
  const completed = routeProgress(map, incoming, decisions).completed
  const status = patch.status === 'abandoned' ? 'abandoned' : completed ? 'completed' : 'active'
  return { ...patch, steps: patch.steps ? incoming : undefined, decisions: patch.decisions ? decisions : undefined, events, status }
}
