/** Runtime state that can satisfy work on the persisted active route.
 * `conditional` and branch-derived `not_applicable` are client presentation
 * hints. A real deviation is attributable and carries a reason. */
export function accountableTerminal(step) {
  if (step?.status === 'done') return true
  return step?.status === 'not_applicable' &&
    typeof step.naReason === 'string' && Boolean(step.naReason.trim()) &&
    typeof step.completedBy === 'string' && Boolean(step.completedBy) &&
    Number.isFinite(step.completedAt)
}

function currentDecisions(decisions = []) {
  const result = new Map()
  for (const decision of decisions) {
    if (!decision?.invalidated) result.set(decision.stepId, decision)
    else result.delete(decision.stepId)
  }
  return result
}

function outgoing(design, index) {
  const step = design[index]
  // Omitted `next` keeps the concise implicit sequence. An explicit empty
  // array is a terminal by contract, even when later steps exist in storage.
  if (Array.isArray(step?.next)) return step.next
  return design[index + 1] ? [{to: design[index + 1].id}] : []
}

/**
 * Derive progress from the saved playbook and persisted decisions. Runtime
 * `not_applicable` flags are presentation state, so they are never trusted to
 * decide which branch counts. A completed route has no remaining reachable
 * work, decision, or approval even if an unchosen branch is still `pending`.
 */
export function routeProgress(map, steps = [], decisions = [], targetId) {
  const design = map?.steps ?? []
  if (!design.length) {
    const next = steps.find(step => step?.type !== 'gate' && !accountableTerminal(step))
    return {completed: steps.length > 0 && !next, next: next ? {id: next.id, type: next.type} : null, reachable: []}
  }
  const byId = new Map(steps.map(step => [step.id, step]))
  const chosen = currentDecisions(decisions)
  const reachable = []
  let id = map.entry && design.some(step => step.id === map.entry) ? map.entry : design[0].id
  const visits = new Map()
  for (let guard = 0; id && guard < design.length * 4 + 4; guard++) {
    const index = design.findIndex(step => step.id === id)
    if (index < 0) return {completed: false, next: {id, type: 'invalid'}, reachable}
    const step = design[index]
    reachable.push(id)
    visits.set(id, (visits.get(id) ?? 0) + 1)
    if ((visits.get(id) ?? 0) > 2)
      return {completed: false, next: {id, type: 'cycle'}, reachable}

    const edges = outgoing(design, index)
    if (step.type === 'decision') {
      if (!edges.length) return {completed: false, next: {id, type: 'invalid'}, reachable}
      if (edges.length > 1) {
        const decision = chosen.get(id)
        const edge = edges.find(candidate => candidate.to === decision?.to)
        if (!edge) return {completed: false, next: {id, type: 'decision'}, reachable}
        id = edge.to
      } else id = edges[0].to
      continue
    }

    const runtime = byId.get(id)
    if (id === targetId || !accountableTerminal(runtime))
      return {completed: false, next: {id, type: step.type}, reachable}
    if (!edges.length) return {completed: true, next: null, reachable}
    if (edges.length > 1) {
      const decision = chosen.get(id)
      const edge = edges.find(candidate => candidate.to === decision?.to)
      if (!edge) return {completed: false, next: {id, type: 'decision'}, reachable}
      id = edge.to
    } else id = edges[0].to
  }
  return id ? {completed: false, next: {id, type: 'cycle'}, reachable} : {completed: true, next: null, reachable}
}
