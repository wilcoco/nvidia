import * as journal from './journal'
import * as mapstore from './mapstore'
import * as host from './host'
import { askUser, type AskOption } from './asks'
import { setWebmcpStatus } from './panel'
import { runHostAction, preconditionFor } from './runner'
import { startRunTracking } from './runsync'
import type { ProcessMap } from './types'

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

function schema(
  properties: Record<string, unknown> = {},
  required: string[] = [],
): Record<string, unknown> {
  return { type: 'object', properties, required }
}

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Short unique id, e.g. "s1"' },
    label: { type: 'string', description: 'Human-readable step name' },
    type: { type: 'string', enum: ['task', 'decision', 'approval'] },
    detail: { type: 'string', description: 'Optional one-line explanation' },
    action: {
      type: 'string',
      description:
        'Optional: name of a host action (from describe_workspace) that performs this step when replaying',
    },
    next: {
      type: 'array',
      description: 'Outgoing edges. Omit on the last step. Multiple edges = a branch; give each a condition.',
      items: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'id of the next step' },
          condition: { type: 'string', description: 'When this edge is taken, e.g. "urgent == true"' },
        },
        required: ['to'],
      },
    },
  },
  required: ['id', 'label', 'type'],
}

const tools: ToolDef[] = [
  {
    name: 'describe_workspace',
    description:
      'Start here. Describes this web app: what it is, what actions the agent can run on it, and whether a process map already exists. Understudy is a layer that lets you (the agent) watch what the human does in this app, structure their work into a business process, and later execute that process for them.',
    inputSchema: schema(),
    execute: async () => ({
      app: host.getAppName(),
      url: location.href,
      how_this_works:
        'The human works in the app; every meaningful action is journaled. Read the journal with get_recent_actions, infer the workflow, and propose_process_map to render it beside their work. The human edits your map directly in the page (read edits via get_map_edits, and their answers via get_recent_actions). Once the map is confirmed, replay it with run_action step by step — and while a confirmed process is loaded, get_process_progress tells you what is done, what comes next, and what was skipped, so you can coach the human through it. When the human starts an entry that matches NO saved playbook (find_relevant_processes), that is the capture moment: draft a map immediately and interview them with get_map_gaps while they work — the process takes shape on their screen as they answer.',
      available_actions: host.listActions(),
      process_map_exists: mapstore.getMap() !== null,
      process_map_confirmed: mapstore.getMap()?.confirmed ?? false,
      process_library_available: host.getProcessStore() !== null,
      journal_entries: journal.all().length,
    }),
  },
  {
    name: 'get_recent_actions',
    description:
      "The action journal: what the human (and you) did in this app, in order — clicks, form submissions, app-level events, and the human's answers to your questions. Pass the cursor from the previous call to get only new entries.",
    inputSchema: schema({
      since: { type: 'number', description: 'Return entries with id greater than this (default 0)' },
      limit: { type: 'number', description: 'Max entries (default 50)' },
    }),
    execute: async (args) => {
      const entries = journal.since(Number(args.since ?? 0), Number(args.limit ?? 50))
      return {
        entries,
        cursor: entries.length ? entries[entries.length - 1].id : Number(args.since ?? 0),
      }
    },
  },
  {
    name: 'get_page_state',
    description:
      'Current business data of the app (as provided by the app), e.g. existing records and their statuses. Use it to ground the process map in what actually exists.',
    inputSchema: schema(),
    execute: async () => host.getState(),
  },
  {
    name: 'propose_process_map',
    description:
      'Draw or replace the draft process map shown beside the human\'s work. Derive it from the journal: one step per meaningful unit of work, "decision" steps where the flow branched, "approval" steps where sign-off happened. Where a step corresponds to a host action, set its "action" field so the process can be replayed later. Then call get_map_gaps for the interview agenda and question the human with ask_user like a knowledge engineer — what has to happen BEFORE the first step, what must FOLLOW, who gives the FINAL sign-off, under what conditions does the flow branch, what would make an expert deviate — and fold the answers back via update_step or a re-propose. Capture judgment rules (thresholds, conditions, the WHY) in each step\'s "detail" field so the playbook carries the expert\'s knowledge, not just the click sequence. The human also edits your draft directly — check get_map_edits afterwards; their edits outrank your inference.',
    inputSchema: schema(
      {
        title: { type: 'string', description: 'Short name of the process' },
        steps: { type: 'array', items: STEP_SCHEMA },
      },
      ['title', 'steps'],
    ),
    execute: async (args) => {
      const map = { title: String(args.title), steps: args.steps } as ProcessMap
      if (!Array.isArray(map.steps) || map.steps.length === 0) {
        return { ok: false, error: 'steps must be a non-empty array' }
      }
      mapstore.proposeMap(map)
      return { ok: true, rendered: true, note: 'Map is now visible to the human, who may edit it.' }
    },
  },
  {
    name: 'get_process_map',
    description:
      'The current process map, including any edits the human made (renames, type changes, removed steps, branch conditions) and whether they confirmed it. On a confirmed map each step carries a "done" flag (auto-set when its action runs, or checked off by the human) — use it to spot skipped steps and warn the human: if a later step is done while an earlier required step is not, the process is being violated.',
    inputSchema: schema(),
    execute: async () => mapstore.getMap() ?? { exists: false },
  },
  {
    name: 'get_map_gaps',
    description:
      "The interview agenda: what the current map does NOT yet know — missing preceding/following steps, undecided branch conditions, no final sign-off, steps without judgment rules, steps that can't be replayed. Call this right after proposing a map (and again after edits), then interview the human with ask_user, one question at a time, starting with the most important gaps. Fold every answer back with update_step or a re-propose. This is how a rough draft becomes the organization's playbook.",
    inputSchema: schema(),
    execute: async () => {
      const gaps = mapstore.mapGaps()
      return {
        gaps,
        note:
          gaps.length === 0
            ? 'No map yet — propose one first.'
            : 'Ask the 2-3 most important questions via ask_user; the human may also just edit the map directly (watch get_map_edits).',
      }
    },
  },
  {
    name: 'update_step',
    description:
      "Refine a single step of the current map in place — no need to re-propose the whole map. Its main purpose is knowledge capture: when the human explains a judgment ('we lower viscosity to 17s when it reads over 18 after a color change'), write that rule into the step's detail so the playbook carries the expertise, and tell the human you did. Can also fix a label, bind an action, or set a branch condition.",
    inputSchema: schema(
      {
        stepId: { type: 'string' },
        label: { type: 'string' },
        detail: { type: 'string', description: 'Judgment rule / note shown on the step card' },
        action: { type: 'string', description: 'Host action bound to this step for replay' },
        branch_to: { type: 'string', description: 'Target step id of an existing edge to update' },
        branch_condition: { type: 'string', description: 'New condition for that edge' },
      },
      ['stepId'],
    ),
    execute: async (args) =>
      mapstore.agentUpdateStep(
        String(args.stepId),
        {
          label: args.label === undefined ? undefined : String(args.label),
          detail: args.detail === undefined ? undefined : String(args.detail),
          action: args.action === undefined ? undefined : String(args.action),
        },
        args.branch_to && args.branch_condition
          ? { to: String(args.branch_to), condition: String(args.branch_condition) }
          : undefined,
      ),
  },
  {
    name: 'get_map_edits',
    description:
      'Edits the human made to your process map, oldest first. Treat these as corrections from the person who actually does this work — they outrank your inference. Pass the cursor from the previous call to get only new edits.',
    inputSchema: schema({
      since: { type: 'number', description: 'Return edits with id greater than this (default 0)' },
    }),
    execute: async (args) => {
      const edits = mapstore.editsSince(Number(args.since ?? 0))
      return { edits, cursor: edits.length ? edits[edits.length - 1].id : Number(args.since ?? 0) }
    },
  },
  {
    name: 'ask_user',
    description:
      'Show the human a question card inside the page and wait for their answer. Use it to fill gaps the journal cannot answer: branch conditions, whether a skipped step was optional, who approves what. Prefer concrete options over open questions. An option may carry a "run" binding — then choosing it EXECUTES that host action on the spot (validation and approval gate included) and you receive the real outcome, not just the button label. Use a run-bound option when proposing to fix a skipped step, e.g. {"label": "Request approval from Lee now", "run": {"name": "request_review", "params": {"worklogId": "4"}}}.',
    inputSchema: schema(
      {
        question: { type: 'string' },
        options: {
          type: 'array',
          description: 'Quick-answer buttons: plain strings, or objects with an executable binding',
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  run: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Host action to execute when chosen' },
                      params: { type: 'object' },
                    },
                    required: ['name'],
                  },
                },
                required: ['label'],
              },
            ],
          },
        },
      },
      ['question'],
    ),
    execute: async (args) => {
      const options: AskOption[] | undefined = Array.isArray(args.options)
        ? args.options.map((o): AskOption => {
            if (typeof o === 'string') return { label: o }
            const obj = o as { label?: unknown; run?: { name?: unknown; params?: unknown } }
            return {
              label: String(obj.label ?? ''),
              run: obj.run?.name
                ? {
                    name: String(obj.run.name),
                    params: (obj.run.params ?? {}) as Record<string, unknown>,
                  }
                : undefined,
            }
          })
        : undefined
      const answer = await askUser(String(args.question), options)
      return { answer }
    },
  },
  {
    name: 'get_process_progress',
    description:
      "Run-state of the confirmed process: which steps are done, which single step is 'ready' (its turn now — a guide, not a violation), and which are 'skipped' (still not done although a later step already ran — a deviation worth raising). Includes a suggested next action when the ready step is bound to one. Caveats: steps on an untaken branch may legitimately never run — check the branch conditions and the page state before calling something skipped, and when unsure ask the human instead of asserting. You are a coach here, not an enforcer: propose the fix (e.g. offer to run the missed step via run_action) and let the human decide.",
    inputSchema: schema(),
    execute: async () => {
      const map = mapstore.getMap()
      if (!map?.confirmed) {
        return { active: false, note: 'No confirmed process is loaded — nothing to track.' }
      }
      const statuses = mapstore.progress(preconditionFor)
      const view = map.steps
        .filter((s) => s.type !== 'decision')
        .map((s) => ({
          id: s.id,
          label: s.label,
          action: s.action,
          status: statuses.get(s.id),
          resultId: s.resultId,
          blockedReason:
            statuses.get(s.id) === 'blocked' && s.action ? preconditionFor(s.action) : undefined,
        }))
      const ready = view.find((s) => s.status === 'ready')
      const blocked = view.find((s) => s.status === 'blocked')
      return {
        active: true,
        process: map.title,
        steps: view,
        completed: view.filter((s) => s.status === 'done').map((s) => s.label),
        produced_ids: view
          .filter((s) => s.resultId)
          .map((s) => ({ step: s.label, action: s.action, id: s.resultId })),
        ready: ready ?? null,
        blocked: blocked ?? null,
        skipped: view.filter((s) => s.status === 'skipped'),
        conditional: view
          .filter((s) => s.status === 'conditional')
          .map((s) => ({
            ...s,
            note: 'On an undecided branch — required only if its condition turns out true. Judge from the branch conditions and page state; ask the human when unsure.',
          })),
        not_applicable: map.steps
          .filter((s) => s.naReason && !s.done)
          .map((s) => ({ id: s.id, label: s.label, reason: s.naReason })),
        suggestedAction: ready?.action ? { name: ready.action } : null,
        branch_conditions: map.steps
          .filter((s) => (s.next?.length ?? 0) > 1)
          .map((s) => ({ at: s.label, branches: s.next })),
      }
    },
  },
  {
    name: 'resolve_deviation',
    description:
      'Resolve a skipped or pending step without running its action: mark it "completed" (it was done outside the app) or "not_applicable" for this run, with a reason. Prefer offering this to the human as a run-bound ask_user option — e.g. {"label": "Mark not applicable", "run": {"name": "resolve_deviation", "params": {"stepId": "s1", "resolution": "not_applicable", "reason": "not required for this incident"}}} — so their click applies it directly.',
    inputSchema: schema(
      {
        stepId: { type: 'string', description: 'Step id from get_process_progress' },
        resolution: { type: 'string', enum: ['completed', 'not_applicable'] },
        reason: { type: 'string', description: 'Why — recorded in the journal' },
      },
      ['stepId', 'resolution'],
    ),
    execute: async (args) =>
      runHostAction('resolve_deviation', {
        stepId: args.stepId,
        resolution: args.resolution,
        reason: args.reason,
      }),
  },
  {
    name: 'list_saved_processes',
    description:
      'Processes previously confirmed and saved to the shared library — including ones other people created. Use load_process to bring one into this session and replay it.',
    inputSchema: schema(),
    execute: async () => {
      const store = host.getProcessStore()
      if (!store) return { available: false, note: 'This app has no shared process library.' }
      return { processes: await store.list() }
    },
  },
  {
    name: 'find_relevant_processes',
    description:
      "Saved playbooks that match what the human is entering RIGHT NOW (matched on structured conditions like incident type, not guesswork), with confidence and reasons. Call it when the human starts a new piece of work. If there's a good match, explain WHY it matches and offer to load it (load_process) — suggest, never force; the human decides. No match is a normal answer.",
    inputSchema: schema(),
    execute: async () => {
      const store = host.getProcessStore()
      if (!store?.findRelevant) {
        return { available: false, note: 'This app does not provide contextual matching. Use list_saved_processes instead.' }
      }
      const result = (await store.findRelevant()) as { matches?: unknown[] } & Record<string, unknown>
      if (Array.isArray(result?.matches) && result.matches.length === 0) {
        result.capture_opportunity =
          'No saved playbook covers what the human is entering right now. This is the moment to CREATE one: draft an initial map from the entry and the journal (propose_process_map), then interview via get_map_gaps — which variables must be captured, what precedes and follows, warning signs, who approves. The map grows beside their work as they answer.'
      }
      return result
    },
  },
  {
    name: 'load_process',
    description:
      'Load a saved process from the shared library into this session (it renders in the panel, already confirmed). Work already done this session is automatically linked: steps whose actions were performed earlier start as done. Then work along it with run_action, asking the human at decision points.',
    inputSchema: schema({ id: { type: 'string', description: 'Process id from list_saved_processes' } }, ['id']),
    execute: async (args) => {
      const store = host.getProcessStore()
      if (!store) return { ok: false, error: 'This app has no shared process library.' }
      try {
        const { map, createdBy } = await store.load(String(args.id))
        mapstore.loadSavedMap(map, { id: String(args.id), createdBy })
        startRunTracking(String(args.id))
        return { ok: true, map }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  },
  {
    name: 'run_action',
    description:
      'Execute one of the host app\'s actions (see describe_workspace) — this is how you replay a confirmed process: walk the map and run each step\'s action, asking the human at decision points. Unless the human enabled auto-approve, each call shows them an approval card first; a denial is a normal answer, not an error.',
    inputSchema: schema(
      {
        name: { type: 'string', description: 'Action name from describe_workspace' },
        params: { type: 'object', description: 'Parameters for the action' },
        force: {
          type: 'boolean',
          description:
            'Set true ONLY after the human explicitly agreed to proceed although earlier required steps of the loaded process are not done. Never set it on your own judgment.',
        },
      },
      ['name'],
    ),
    execute: async (args) =>
      runHostAction(String(args.name), (args.params ?? {}) as Record<string, unknown>, {
        force: args.force === true,
      }),
  },
]

function wrap(tool: ToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(args: Record<string, unknown>) {
      const result = await tool.execute(args ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  }
}

/** Register tools on whichever WebMCP surface the browser exposes. */
export function registerWebmcpTools(): void {
  const surfaces = [document, navigator, window] as Array<Record<string, any>>
  const ctx = surfaces.map((s) => s.modelContext).find(Boolean)

  const wrapped = tools.map(wrap)
  // Always expose a dev handle for manual testing from the console.
  ;(window as any).__understudy = {
    tools: wrapped,
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const t = tools.find((x) => x.name === name)
      if (!t) throw new Error(`no such tool: ${name}`)
      return t.execute(args)
    },
  }

  if (!ctx) {
    setWebmcpStatus('not detected')
    return
  }
  try {
    if (typeof ctx.registerTool === 'function') {
      for (const t of wrapped) ctx.registerTool(t)
    } else if (typeof ctx.provideContext === 'function') {
      ctx.provideContext({ tools: wrapped })
    } else {
      setWebmcpStatus('unsupported API')
      return
    }
    setWebmcpStatus('connected')
  } catch (err) {
    console.warn('[Understudy] WebMCP registration failed:', err)
    setWebmcpStatus('error')
  }
}
