// Shared execution pipeline for host actions: param validation → human approval
// gate → handler → outcome-aware journaling → process-step completion.
// Used by both the run_action WebMCP tool and executable ask_user options.
import * as host from './host'
import * as journal from './journal'
import * as mapstore from './mapstore'
import { requestApproval } from './asks'
import { isAutoApprove } from './settings'

export interface RunOutcome {
  ok: boolean
  result?: unknown
  error?: string
  denied?: boolean
  declared_params?: unknown
  note?: string
}

export function preconditionFor(actionName: string): string | null {
  const action = host.getAction(actionName)
  if (!action) return `unknown action "${actionName}"`
  return action.precondition?.() ?? null
}

export async function runHostAction(
  name: string,
  raw: Record<string, unknown>,
): Promise<RunOutcome> {
  const action = host.getAction(name)
  if (!action) {
    return { ok: false, error: `Unknown action "${name}". Call describe_workspace for the list.` }
  }

  // Validate against the declared params: agents sometimes omit fields or
  // send numbers as strings.
  const spec = action.params ?? {}
  const params: Record<string, unknown> = {}
  const problems: string[] = []
  for (const [key, def] of Object.entries(spec)) {
    let value = raw[key]
    if (value === undefined || value === null || value === '') {
      if (def.required) problems.push(`missing required param "${key}" (${def.type})`)
      continue
    }
    if (def.type === 'number' && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      value = Number(value)
    }
    if (def.type === 'boolean' && (value === 'true' || value === 'false')) {
      value = value === 'true'
    }
    if (typeof value !== def.type) {
      problems.push(`param "${key}" must be a ${def.type}`)
      continue
    }
    params[key] = value
  }
  for (const key of Object.keys(raw)) if (!(key in spec)) params[key] = raw[key]
  if (problems.length > 0) {
    return {
      ok: false,
      error: `Invalid params for ${action.name}: ${problems.join('; ')}`,
      declared_params: spec,
    }
  }

  if (!isAutoApprove()) {
    const approved = await requestApproval(action.name, params)
    if (!approved) {
      journal.record('agent', 'action', `${action.name} — denied by the human`, params)
      return { ok: false, denied: true, note: 'The human denied this action.' }
    }
  }

  // Journal only after the outcome is known: a failed call must never read
  // as performed work, or it pollutes process inference downstream.
  try {
    const result = await action.handler(params)
    const errorMsg =
      result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)
        ? String((result as Record<string, unknown>).error)
        : null
    if (errorMsg) {
      journal.record('agent', 'action', `${action.name} FAILED: ${errorMsg}`, params)
      return { ok: false, error: errorMsg }
    }
    journal.record('agent', 'action', `ran ${action.name}`, params)
    const resultId =
      result && typeof result === 'object' && 'id' in (result as Record<string, unknown>)
        ? String((result as Record<string, unknown>).id)
        : undefined
    mapstore.markActionDone(action.name, resultId)
    return { ok: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    journal.record('agent', 'action', `${action.name} FAILED: ${msg}`, params)
    return { ok: false, error: msg }
  }
}
