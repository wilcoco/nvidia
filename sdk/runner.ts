// Shared execution pipeline for host actions: param validation → process guard
// → (async) human approval gate → handler → outcome-aware journaling →
// process-step completion. Used by the run_action WebMCP tool and executable
// ask_user options. Agent-facing calls NEVER block on the human: a gated call
// returns {status:'pending_approval', actionId} and the agent polls
// get_action_result.
import * as host from './host'
import * as journal from './journal'
import * as mapstore from './mapstore'
import { requestApproval } from './asks'
import { isAutoApprove } from './settings'
import type { HostAction } from './types'

export interface RunOutcome {
  ok: boolean
  result?: unknown
  error?: string
  denied?: boolean
  declared_params?: unknown
  note?: string
}

export type RunStart =
  | RunOutcome
  | { status: 'pending_approval'; actionId: string; note: string }

/** SDK-built-in actions, runnable like host actions. */
const BUILTIN_ACTIONS: Record<string, HostAction> = {
  resolve_decision: {
    name: 'resolve_decision',
    description:
      'Record which branch a branching step took, with the reason and evidence. Choosing a loop-back branch re-opens the loop body.',
    params: {
      stepId: { type: 'string', description: 'The branching step (has multiple next edges)', required: true },
      branchTo: { type: 'string', description: 'Target step id of the chosen edge', required: true },
      reason: { type: 'string', description: 'Why this branch — cite the branch condition', required: true },
      evidence: { type: 'string', description: 'Context backing the choice, in the workspace\'s own terms' },
    },
    handler: (p) =>
      mapstore.resolveDecision(
        String(p.stepId),
        String(p.branchTo),
        String(p.reason),
        p.evidence ? String(p.evidence) : undefined,
        'user',
        p.measurements && typeof p.measurements === 'object'
          ? (p.measurements as Record<string, unknown>)
          : undefined,
      ),
  },
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

function validateParams(
  action: HostAction,
  raw: Record<string, unknown>,
): { params: Record<string, unknown> } | { error: RunOutcome } {
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
  delete params.force
  if (problems.length > 0) {
    return {
      error: {
        ok: false,
        error: `Invalid params for ${action.name}: ${problems.join('; ')}`,
        declared_params: spec,
      },
    }
  }
  return { params }
}

/** Journal-after-outcome execution: a failed call must never read as performed work. */
async function executeCore(
  action: HostAction,
  params: Record<string, unknown>,
  actor: 'user' | 'agent',
): Promise<RunOutcome> {
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
    if (!(action.name in BUILTIN_ACTIONS)) {
      mapstore.recordActionSuccess(action.name, resultId, actor)
    }
    return { ok: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    journal.record(actor, 'action', `${action.name} FAILED: ${msg}`, params)
    return { ok: false, error: msg }
  }
}

/** Agent path: validate → guard → gate (async pending) or execute. */
function actorRole(): string | undefined {
  try {
    const st = host.getState() as {
      actingAs?: unknown
      users?: Array<{ username?: unknown; role?: unknown }>
    } | null
    const acting = typeof st?.actingAs === 'string' ? st.actingAs : undefined
    const u = Array.isArray(st?.users) ? st.users.find((x) => x?.username === acting) : undefined
    return typeof u?.role === 'string' ? u.role : undefined
  } catch {
    return undefined
  }
}

export function startHostAction(
  name: string,
  raw: Record<string, unknown>,
  opts: { force?: boolean } = {},
): RunStart | Promise<RunStart> {
  const action = resolveAction(name)
  if (!action) {
    return { ok: false, error: `Unknown action "${name}". Call describe_workspace for the list.` }
  }
  const validated = validateParams(action, raw)
  if ('error' in validated) return validated.error
  const { params } = validated

  // Role separation: an action reserved for a role refuses other personas.
  if (action.roles?.length) {
    const role = actorRole()
    if (role && !action.roles.includes(role)) {
      return {
        ok: false,
        error: 'role_mismatch',
        detail: `"${name}" is a ${action.roles.join('/')} action; the active persona's role is ${role}. Switch persona first.`,
      } as RunStart
    }
  }

  const force = opts.force === true || raw.force === true
  if (!force) {
    const gap = mapstore.prerequisiteGap(name)
    if (gap) {
      return {
        ok: false,
        error: `Process violation prevented: running ${name} now would reach "${gap.target}" while earlier required steps are not done: ${gap.missing.join('; ')}.`,
        note: 'Warn the human. Offer run-bound ask_user options to complete or excuse (resolve_deviation) the missing steps — or, only after the human explicitly agrees to proceed anyway, retry with force: true.',
      }
    }
  }

  // State-only builtins and auto-approve skip the card; everything else waits
  // for the human — WITHOUT blocking this call.
  if (isAutoApprove() || name in BUILTIN_ACTIONS) {
    return executeCore(action, params, 'agent')
  }
  const actionId = requestApproval(action.name, params, () => executeCore(action, params, 'agent'))
  return {
    status: 'pending_approval',
    actionId,
    note: `An approval card is now shown to the human. Poll get_action_result with actionId "${actionId}" — do not assume the outcome. A denial is a normal answer.`,
  }
}

/** Human path (panel run-bound option clicks): the click IS the consent — execute now. */
export async function runAsHuman(
  name: string,
  raw: Record<string, unknown>,
): Promise<RunOutcome> {
  const action = resolveAction(name)
  if (!action) return { ok: false, error: `Unknown action "${name}".` }
  const validated = validateParams(action, raw)
  if ('error' in validated) return validated.error
  return executeCore(action, validated.params, 'user')
}
