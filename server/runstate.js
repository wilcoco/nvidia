// Approval outcomes are server-owned, even when the reviewer uses another login.
export function applySignoff(run, approval) {
  if (!run || run.status === 'abandoned') return null
  const steps = (run.steps ?? []).map((s) => ({ ...s }))
  const step = steps.find((s) => s.type === 'approval' &&
    (approval.stepId ? s.id === approval.stepId : !['done', 'not_applicable', 'conditional'].includes(s.status)))
  if (!step) return null
  Object.assign(step, {
    status: 'done', resultId: String(approval.id), completedBy: approval.approver,
    authenticatedBy: approval.decidedBySession ?? approval.approver, completedAt: Date.now(),
  })
  const events = mergeRunEvents(run.events, [{ id: `approval:${approval.id}`, ts: Date.now(), kind: 'approval',
    stepId: step.id, label: step.label, actor: approval.approver,
    authenticatedBy: approval.decidedBySession ?? approval.approver,
    note: approval.comment ?? 'Approved', resultId: String(approval.id) }])
  return { steps, events, status: finished(steps) ? 'completed' : 'active' }
}

function finished(steps) {
  return steps.length > 0 && steps.every((s) => ['done', 'not_applicable', 'conditional'].includes(s.status))
}

// A browser's delayed snapshot cannot undo a sign-off already accepted by the server.
export function preserveSignoffs(run, patch) {
  if (!Array.isArray(patch.steps)) return patch
  const signed = new Map((run.steps ?? [])
    .filter((s) => s.type === 'approval' && s.status === 'done' && s.resultId)
    .map((s) => [s.id, s]))
  const steps = patch.steps.map((s) => signed.has(s.id) ? { ...signed.get(s.id) } : s)
  return { ...patch, steps, ...(signed.size && finished(steps) ? { status: 'completed' } : {}) }
}

export function reviewFingerprint(run, scope) {
  if (!run) return null
  return JSON.stringify(canonical({
    steps: (run.steps ?? []).filter((s) => (!scope || scope.includes(s.id)) && s.type !== 'approval' && s.action !== 'request_review')
      .map((s) => ({ id: s.id, status: s.status, completedBy: s.completedBy, completedAt: s.completedAt, resultId: s.resultId, resultData: s.resultData })),
    decisions: (run.decisions ?? []).filter((d) => !d.invalidated && (!scope || scope.includes(d.stepId))),
  }))
}

// PostgreSQL JSONB and browser objects can have different key order while
// containing identical evidence. Compare their values, not serialization order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

export function matchesReviewFingerprint(stored, run, scope) {
  if (!stored || !run) return false
  try { return JSON.stringify(canonical(JSON.parse(stored))) === reviewFingerprint(run, scope) }
  catch { return false }
}

export function evidencePatch(run, scope) {
  const values = {}
  for (const s of run.steps ?? []) if ((!scope || scope.includes(s.id)) && s.status === 'done' && s.resultData) Object.assign(values, s.resultData)
  return { ...values, verification: null, verifiedRoute: null, verifiedAt: null, reviewContext: null }
}

function primitiveValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const reserved = ['runId', 'approvalStepId', 'systemGenerated', 'verification', 'verifiedRoute', 'verifiedAt', 'reviewContext']
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => !reserved.includes(key) &&
    (['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v)))))
}

function criteriaResult(criteria, values) {
  const rules = Object.entries(criteria ?? {})
  if (!rules.length) return null
  if (rules.some(([key]) => values[key] == null)) return null
  return rules.every(([key, rule]) => Object.entries(rule).every(([op, t]) => {
    const v = values[key]
    return op === 'eq' ? v === t : op === 'ne' ? v !== t : typeof v === 'number' &&
      (op === 'gt' ? v > t : op === 'gte' ? v >= t : op === 'lt' ? v < t : op === 'lte' ? v <= t : false)
  }))
}

// Only persisted, non-superseded decisions and the saved approval definition
// establish review meaning. Source-log verification is never copied back in.
function reviewMeaning(run, map, scope, taskValues) {
  const design = map?.steps ?? []
  const target = design.find(s => s.id === approvalGate(run, map).stepId)
  if (!target) return {}
  const current = new Map()
  for (const d of run.decisions ?? []) if (!d.invalidated && (!scope || scope.includes(d.stepId))) current.set(d.stepId, d)
  const decisions = [], workChecks = []
  for (let i = 0; i < design.length; i++) {
    const step = design[i], d = current.get(step.id)
    const edge = step.next?.find(e => e.to === d?.to)
    if (!d || !edge) continue
    let measured = d.measurements
    if (!measured && d.evidence) { try { measured = JSON.parse(d.evidence) } catch { /* prose remains in the decision */ } }
    const values = primitiveValues(measured)
    const measurementSources = Object.fromEntries(Object.keys(values).map(key => [key, 'decision-provided']))
    // A decision cannot replace the values the assignee actually submitted.
    for (const prior of design.slice(0, i + 1)) {
      const recorded = run.steps?.find(s => s.id === prior.id && s.status === 'done')
      const submitted = primitiveValues(recorded?.resultData)
      Object.assign(values, submitted)
      for (const key of Object.keys(submitted)) measurementSources[key] = 'task-submitted'
    }
    const checked = criteriaResult(edge.criteria, values)
    decisions.push({stepId: step.id, label: step.label ?? step.id, to: d.to,
      targetLabel: design.find(s => s.id === d.to)?.label ?? d.to, reason: d.reason,
      measurements: values, measurementSources, criteria: edge.criteria ?? {}, criteriaMet: checked, ts: d.ts ?? null})
    // Compare current evidence with saved work-signoff rules as well as the
    // chosen remediation rule. Passing a redesign criterion is not a work pass.
    for (const candidate of step.next ?? []) {
      const approval = design.find(s => s.id === candidate.to && s.type === 'approval')
      if (!approval || approval.approvalPurpose === 'plan' ||
        (!approval.approvalPurpose && /re-?plan|escalat|redesign/i.test(approval.label ?? ''))) continue
      const result = criteriaResult(candidate.criteria, values)
      if (result !== null) workChecks.push(result)
    }
  }
  const leadsToTarget = id => {
    const visited = new Set()
    while (id && !visited.has(id)) {
      if (id === target.id) return true
      visited.add(id)
      const i = design.findIndex(s => s.id === id), step = design[i]
      if (!step) return false
      const edges = step.next ?? (design[i + 1] ? [{to: design[i + 1].id}] : [])
      const chosen = current.get(id)
      id = edges.length === 1 ? edges[0].to : edges.find(e => e.to === chosen?.to)?.to
    }
    return false
  }
  const route = [...decisions].reverse().find(d => d.criteriaMet !== false && leadsToTarget(d.to))
  const legacyPlan = !target.approvalPurpose && route && /re-?plan|escalat|redesign/i.test(target.label ?? '')
  const purpose = target.approvalPurpose ?? (legacyPlan ? 'plan' : 'unspecified')
  const verification = primitiveValues(taskValues)
  return { ...taskValues,
    verification: decisions.length ? verification : null,
    verifiedRoute: route ? {label: target.label, pass: true, checked: route.criteriaMet === true, purpose} : null,
    verifiedAt: route?.ts && Number.isFinite(route.ts) ? new Date(route.ts).toISOString() : null,
    reviewContext: {approvalStepId: target.id, approvalLabel: target.label ?? target.id, purpose,
      purposeSource: target.approvalPurpose ? 'declared' : legacyPlan ? 'legacy-label' : 'unspecified',
      workChecks: workChecks.includes(false) ? 'failed' : workChecks.length ? 'passed' : 'unverified', decisions},
  }
}

// Freeze the values a reviewer saw. A source log is history, while completed
// task inputs are the current measurements. Omitted task inputs stay omitted.
export function reviewEvidence(run, map, scope, data = {}) {
  const values = structuredClone(data)
  if (!run) return values
  for (const step of map?.steps ?? [])
    if (!scope || scope.includes(step.id))
      for (const key of step.fields ?? []) delete values[key]
  const patch = evidencePatch(run, scope)
  const meaning = reviewMeaning(run, map, scope, patch)
  return { ...values, ...patch, ...meaning,
    ...(run.id != null ? {runId: String(run.id)} : {}),
    ...(meaning.reviewContext ? {approvalStepId: meaning.reviewContext.approvalStepId} : {}),
  }
}

/** The SDK executes the saved step order, excluding inactive branches. A review
 * signs off the work before its own step, never work that follows it. */
export function approvalGate(run, map, requestedStepId, requesting = false) {
  if (!run || run.status === 'abandoned') return { open: ['linked run is unavailable or abandoned'] }
  const steps = run.steps ?? []
  const design = map?.steps ?? steps
  const target = design.find((s) => s.type === 'approval' &&
    !['done', 'not_applicable', 'conditional'].includes(steps.find((r) => r.id === s.id)?.status))
  if (requestedStepId && target?.id !== requestedStepId)
    return { open: ['this approval is not the next required sign-off'] }
  const before = target ? design.slice(0, design.findIndex((s) => s.id === target.id)) : design
  const scope = before.flatMap((s) => [s.id, `gate:${s.id}`])
  // POST /submit is the operation that performs request_review. Exempt only
  // that administrative step, never its required inputs or another task.
  const request = requesting ? before.find(s => s.type === 'task' && s.action === 'request_review' &&
    steps.some(r => r.id === s.id && !['done', 'not_applicable', 'conditional'].includes(r.status)) &&
    !(map?.fields ?? []).some(f => s.fields?.includes(f.key) && (f.required || f.confirm)) &&
    !s.next?.some(edge => Object.keys(edge.criteria ?? {}).length)) : undefined
  const open = steps.filter((s) => scope.includes(s.id) && s.id !== request?.id &&
    !['done', 'not_applicable', 'conditional'].includes(s.status))
  // Initial or partial snapshots must not make absent work look completed.
  const missing = before.filter((s) => s.type !== 'decision' && !steps.some((r) => r.id === s.id))
  return { stepId: target?.id, scope, open: steps.length ? [...open, ...missing].map((s) => s.label || s.id) : ['run has not synced yet'] }
}

export function mergeRunEvents(previous = [], incoming = []) {
  const all = new Map(previous.map((e) => [e.id, e]))
  for (const event of incoming) if (!all.has(event.id)) all.set(event.id, event)
  return [...all.values()].sort((a, b) => a.ts - b.ts)
}

/** Run writes and approvals hold the same DB lock. Checks at the HTTP handler
 * alone are insufficient: a review can be accepted while a write is waiting. */
export function guardRunUpdate(run, patch, design) {
  const fail = (message) => { throw Object.assign(new Error(message), {status: 409}) }
  if (patch.steps) {
    const fixed = (run.steps ?? []).filter(s => s.type !== 'gate')
    if (fixed.some(s => !patch.steps.some(n => n.id === s.id && n.type === s.type)) ||
      patch.steps.some(n => !fixed.some(s => s.id === n.id && s.type === n.type) &&
        !(n.type === 'gate' && (design?.steps ?? []).some(s => s.type === 'decision' && `gate:${s.id}` === n.id))))
      fail('run_design_mismatch')
  }
  const next = {...run, ...patch, events: mergeRunEvents(run.events, patch.events ?? [])}
  // Omitted patch properties do not clear recorded state.
  for (const key of Object.keys(patch)) if (patch[key] === undefined) next[key] = run[key]
  if (run.status === 'completed' || run.status === 'abandoned') {
    const content = r => canonical({steps: r.steps, decisions: r.decisions, events: r.events, status: r.status, deviations: r.deviations})
    if (JSON.stringify(content(next)) !== JSON.stringify(content(run))) fail('finished_run_immutable')
    return false // exact retry: return the existing row without changing its timestamp
  }
  const steps = design?.steps ?? run.steps
  const lastSigned = steps.reduce((last, s, i) => s.type === 'approval' &&
    run.steps.some(r => r.id === s.id && r.status === 'done' && r.resultId) ? i : last, -1)
  if (lastSigned >= 0) {
    const scope = steps.slice(0, lastSigned).flatMap(s => [s.id, `gate:${s.id}`])
    if (reviewFingerprint(run, scope) !== reviewFingerprint(next, scope)) fail('signed_work_immutable')
  }
  return true
}
