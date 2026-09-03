// Approval outcomes are server-owned, even when the reviewer uses another login.
export function applySignoff(run, approval) {
  if (!run || run.status === 'abandoned') return null
  const steps = (run.steps ?? []).map((s) => ({ ...s }))
  const step = steps.find((s) => s.type === 'approval' &&
    (approval.stepId ? s.id === approval.stepId : !['done', 'not_applicable', 'conditional'].includes(s.status)))
  if (!step) return null
  Object.assign(step, {
    status: 'done', resultId: String(approval.id), completedBy: approval.approver,
    completedAt: Date.now(),
  })
  const events = mergeRunEvents(run.events, [{ id: `approval:${approval.id}`, ts: Date.now(), kind: 'approval',
    stepId: step.id, label: step.label, actor: approval.approver, note: approval.comment ?? 'Approved', resultId: String(approval.id) }])
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
  return { ...values, verification: null, verifiedRoute: null, verifiedAt: null }
}

// Freeze the values a reviewer saw. A source log is history, while completed
// task inputs are the current measurements. Omitted task inputs stay omitted.
export function reviewEvidence(run, map, scope, data = {}) {
  const values = structuredClone(data)
  if (!run) return values
  for (const step of map?.steps ?? [])
    if (!scope || scope.includes(step.id))
      for (const key of step.fields ?? []) delete values[key]
  return { ...values, ...evidencePatch(run, scope) }
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
