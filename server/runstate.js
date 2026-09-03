// Approval outcomes are server-owned, even when the reviewer uses another login.
export function applySignoff(run, approval) {
  if (!run || run.status === 'abandoned') return null
  const steps = (run.steps ?? []).map((s) => ({ ...s }))
  const step = steps.find((s) => s.type === 'approval' && !['done', 'not_applicable'].includes(s.status))
  if (!step) return null
  Object.assign(step, {
    status: 'done', resultId: String(approval.id), completedBy: approval.approver,
    completedAt: Date.now(),
  })
  return { steps, status: finished(steps) ? 'completed' : 'active' }
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

export function reviewFingerprint(run) {
  if (!run) return null
  return JSON.stringify({
    steps: (run.steps ?? []).filter((s) => s.type !== 'approval' && s.action !== 'request_review')
      .map((s) => ({ id: s.id, status: s.status, completedAt: s.completedAt, resultData: s.resultData })),
    decisions: (run.decisions ?? []).filter((d) => !d.invalidated),
  })
}

export function evidencePatch(run) {
  const values = {}
  for (const s of run.steps ?? []) if (s.status === 'done' && s.resultData) Object.assign(values, s.resultData)
  return { ...values, verification: null, verifiedRoute: null, verifiedAt: null }
}
