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

import type { HostAction } from './types'

/** SDK-built-in actions, runnable like host actions (run_action tool, ask_user run bindings). */
const BUILTIN_ACTIONS: Record<string, HostAction> = {
  resolve_deviation: {
    name: 'resolve_deviation',
    description:
      'Resolve a process deviation: mark a skipped/pending step as completed (done outside the app) or as not applicable for this run, with a reason.',
    params: {
      stepId: { type: 'string', description: 'Step id from get_process_progress', required: true },
      resolution: { type: 'string', description: '"completed" or "not_applicable"', required: true },
      reason: { type: 'string', description: 'Why — recorded in the journal' },
    },
    handler: (p) => {
      const resolution = String(p.resolution)
      if (resolution !== 'completed' && resolution !== 'not_applicable') {
        return { error: 'resolution must be "completed" or "not_applicable"' }
      }
      return mapstore.resolveDeviation(
        String(p.stepId),
        resolution,
        p.reason ? String(p.reason) : undefined,
        'user',
      )
    },
  },
}

function resolveAction(name: string): HostAction | undefined {
  return host.getAction(name) ?? BUILTIN_ACTIONS[name]
}

export function preconditionFor(actionName: string): string | null {
  const action = resolveAction(actionName)
  if (!action) return `unknown action "${actionName}"`
  return action.precondition?.() ?? null
}

export async function runHostAction(
  name: string,
  raw: Record<string, unknown>,
  opts: { humanInitiated?: boolean } = {},
): Promise<RunOutcome> {
  const action = resolveAction(name)
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

  // A human clicking a run-bound option IS the consent for a state-only
  // builtin like resolve_deviation; real host actions still show the
  // approval card so the human sees the exact params before they run.
  const skipGate = opts.humanInitiated && name in BUILTIN_ACTIONS
  const actor = opts.humanInitiated ? 'user' : 'agent'
  if (!skipGate && !isAutoApprove()) {
    const approved = await requestApproval(action.name, params)
    if (!approved) {
      journal.record(actor, 'action', `${action.name} — denied by the human`, params)
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
      journal.record(actor, 'action', `${action.name} FAILED: ${errorMsg}`, params)
      return { ok: false, error: errorMsg }
    }
    journal.record(actor, 'action', `ran ${action.name}`, params)
    const resultId =
      result && typeof result === 'object' && 'id' in (result as Record<string, unknown>)
        ? String((result as Record<string, unknown>).id)
        : undefined
    mapstore.markActionDone(action.name, resultId)
    return { ok: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    journal.record(actor, 'action', `${action.name} FAILED: ${msg}`, params)
    return { ok: false, error: msg }
  }
}
