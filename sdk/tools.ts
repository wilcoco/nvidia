import * as journal from './journal'
import * as mapstore from './mapstore'
import * as host from './host'
import { askUser, getQuestionResult, getActionResult, type AskOption } from './asks'
import { setWebmcpStatus } from './panel'
import { startHostAction, preconditionFor } from './runner'
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
          criteria: {
            type: 'object',
            description:
              'Machine-checkable pass criteria from the sign-off interview, e.g. {"testPassRate": {"gte": 100}, "openCriticalIssues": {"eq": 0}} or {"contrastRatio": {"gte": 4.5}, "rollbackReady": {"eq": true}}. resolve_decision verifies measurements against these server-side — ALWAYS set criteria on pass/approve edges when the human states thresholds.',
          },
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
        applies_when: {
          type: 'object',
          description:
            "REQUIRED when creating from a live entry: the structured conditions under which this playbook applies, copied from the entry — find_relevant_processes' entering_now shows which keys this app matches on. Add finer keys when the human names them (e.g. team, artifact, system), and ALWAYS a \"keywords\" array of 3-6 distinctive words from the work itself (e.g. keywords [\"hotfix\", \"latency\", \"rollback\"] or [\"handoff\", \"contrast\", \"accessibility\"]) — a generic kind alone (routine log) scores only ~30% and will not surface as a suggestion; keywords matched in the live text are what raise it. Without applies_when the playbook can never be auto-suggested to the next worker.",
        },
        priority_when: {
          type: 'object',
          description: 'Conditions that raise the match priority, e.g. {"urgent": true}',
        },
        source_worklog_id: {
          type: 'string',
          description: 'Id of the work entry that triggered creating this playbook',
        },
        fields: {
          type: 'array',
          description:
            "The playbook's data contract: variables that must be captured when following it (from the required_context interview answer). Rendered as a form for the next worker.",
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'camelCase key, e.g. contrastRatio, testPassRate' },
              label: { type: 'string' },
              type: { type: 'string', enum: ['number', 'string', 'boolean'] },
              unit: { type: 'string' },
              required: { type: 'boolean' },
            },
            required: ['key', 'type'],
          },
        },
      },
      ['title', 'steps'],
    ),
    execute: async (args) => {
      const map = {
        title: String(args.title),
        steps: args.steps,
        appliesWhen: args.applies_when,
        priorityWhen: args.priority_when,
        sourceWorklogId: args.source_worklog_id ? String(args.source_worklog_id) : undefined,
        fields: args.fields,
      } as ProcessMap
      if (!Array.isArray(map.steps) || map.steps.length === 0) {
        return { ok: false, error: 'steps must be a non-empty array' }
      }
      mapstore.proposeMap(map)
      if (map.fields?.length) mapstore.markGapResolved('required_context')
      return {
        ok: true,
        rendered: true,
        note:
          'Map is now visible to the human, who may edit it.' +
          (map.appliesWhen ? '' : ' WARNING: no applies_when set — this playbook will not be auto-suggested later. Set it if the process is tied to entry conditions.'),
      }
    },
  },
  {
    name: 'update_map_fields',
    description:
      "Set or replace the playbook's data contract — the variables that must be captured when following it. Call this after the human answers the required_context question ('which variables must always be recorded?'), translating their answer into typed fields. The next worker gets these as a ready-made form.",
    inputSchema: schema(
      {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string', enum: ['number', 'string', 'boolean'] },
              unit: { type: 'string' },
              required: { type: 'boolean' },
            },
            required: ['key', 'type'],
          },
        },
      },
      ['fields'],
    ),
    execute: async (args) => mapstore.setMapFields(args.fields as never),
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
      "The interview agenda: what the current map does NOT yet know — missing preceding/following steps, undecided branch conditions, no final sign-off, steps without judgment rules, steps that can't be replayed. Call this right after proposing a map (and again after edits), then interview the human with ask_user, one question at a time, starting with the most important gaps. IMPORTANT: each gap gives you question_goal + missing_information — write the actual question YOURSELF in this app's own domain language (you know the domain from describe_workspace, the journal and the entry text). fallback_question exists only for when the domain is truly unknown; ask_user rejects it verbatim. Fold every answer back with update_step or a re-propose. This is how a rough draft becomes the organization's playbook.",
    inputSchema: schema(),
    execute: async () => {
      if (!mapstore.getMap()) return { gaps: [], note: 'No map yet — propose one first.' }
      const gaps = mapstore.mapGaps()
      return {
        gaps,
        note:
          gaps.length === 0
            ? 'No open gaps — the interview is complete for this map.'
            : 'Ask the 2-3 most important questions via ask_user — in your own words, using this app\'s domain language, not the generic suggested_question text. The human may also just edit the map directly (watch get_map_edits).',
      }
    },
  },
  {
    name: 'update_step',
    description:
      "Refine a single step of the current map in place — no need to re-propose the whole map. Its main purpose is knowledge capture: when the human explains a judgment rule or threshold, write it into the step's detail so the playbook carries the expertise, and tell the human you did. Can also fix a label, bind an action, or set a branch condition.",
    inputSchema: schema(
      {
        stepId: { type: 'string' },
        label: { type: 'string' },
        detail: { type: 'string', description: 'Judgment rule / note shown on the step card' },
        action: { type: 'string', description: 'Host action bound to this step for replay' },
        branch_to: { type: 'string', description: 'Target step id of an existing edge to update' },
        branch_condition: { type: 'string', description: 'New condition for that edge' },
        branch_criteria: {
          type: 'object',
          description:
            'Machine-checkable criteria for that edge, e.g. {"testPassRate": {"gte": 100}} or {"contrastRatio": {"gte": 4.5}, "openCriticalIssues": {"eq": 0}} — resolve_decision then verifies measurements against them server-side. ALWAYS encode thresholds the human states.',
        },
        humanOnly: {
          type: 'boolean',
          description: 'Mark the step as inherently manual (no host action can perform it); clears any action binding',
        },
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
          humanOnly: args.humanOnly === undefined ? undefined : args.humanOnly === true,
        },
        args.branch_to && (args.branch_condition || args.branch_criteria)
          ? {
              to: String(args.branch_to),
              condition: args.branch_condition === undefined ? undefined : String(args.branch_condition),
              criteria:
                args.branch_criteria && typeof args.branch_criteria === 'object'
                  ? (args.branch_criteria as Record<string, Record<string, number | string | boolean>>)
                  : undefined,
            }
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
      'Show the human a question card inside the page and wait for their answer. Use it to fill gaps the journal cannot answer: branch conditions, whether a skipped step was optional, who approves what. Prefer concrete options over open questions. An option may carry a "run" binding — then choosing it EXECUTES that host action on the spot (validation and approval gate included) and you receive the real outcome, not just the button label. Use a run-bound option when proposing to fix a skipped step, e.g. {"label": "Run the missing step now", "run": {"name": "<a host action from describe_workspace>", "params": {...}}}.',
    inputSchema: schema(
      {
        question: { type: 'string' },
        resolves_gap: {
          type: 'string',
          description:
            "Gap this question resolves once answered, as kind or kind:stepId from get_map_gaps (e.g. \"required_context:s1\") — answered gaps stop being listed.",
        },
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
      const q = String(args.question ?? '').trim().toLowerCase()
      const parroted = mapstore
        .knownFallbackQuestions()
        .some((f) => f.length > 25 && (q === f.toLowerCase() || q.includes(f.toLowerCase())))
      if (parroted) {
        return {
          error: 'generic_question_detected',
          note: 'That is the generic fallback wording. Rewrite the question in this workspace\'s own language, using the current entry and app context (describe_workspace, the journal, the entry text) — then call ask_user again.',
        }
      }
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
      const questionId = askUser(
        String(args.question),
        options,
        true,
        args.resolves_gap ? String(args.resolves_gap) : undefined,
      )
      return {
        questionId,
        status: 'pending',
        note: `The question card is now on screen. Humans take time — poll get_question_result with questionId "${questionId}" (their answer also appears in get_recent_actions). Never assume the answer.`,
      }
    },
  },
  {
    name: 'get_question_result',
    description: "Check whether the human answered an ask_user question yet. 'pending' means keep waiting — ask something else or check back after your next action.",
    inputSchema: schema({ questionId: { type: 'string' } }, ['questionId']),
    execute: async (args) => getQuestionResult(String(args.questionId)),
  },
  {
    name: 'get_action_result',
    description: "Check the outcome of a run_action call that returned pending_approval: still pending, denied by the human (a normal answer, not an error), or complete with the action's result.",
    inputSchema: schema({ actionId: { type: 'string' } }, ['actionId']),
    execute: async (args) => getActionResult(String(args.actionId)),
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
      const gate = mapstore.pendingDecision()
      const branchingSteps = map.steps
        .filter((s) => (s.next?.length ?? 0) > 1)
        .map((s) => ({
          id: s.id,
          label: s.label,
          type: s.type,
          branches: s.next,
          chosen: map.decisions?.filter((d) => d.stepId === s.id).slice(-1)[0] ?? null,
          note: 'Resolve with resolve_decision before moving past this step; loop-back choices re-open the loop body.',
        }))
      return {
        active: true,
        process: map.title,
        steps: view,
        branching_steps: branchingSteps,
        decisions_taken: map.decisions ?? [],
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
        awaiting_decision: gate
          ? {
              id: gate.id,
              label: gate.label,
              branches: gate.next,
              note: 'This decision must be resolved (resolve_decision) before anything after it can run.',
            }
          : null,
        suggestedAction: gate
          ? { name: 'resolve_decision', params: { stepId: gate.id } }
          : ready?.action
            ? { name: ready.action }
            : null,
        branch_conditions: map.steps
          .filter((s) => (s.next?.length ?? 0) > 1)
          .map((s) => ({ at: s.label, branches: s.next })),
      }
    },
  },
  {
    name: 'resolve_decision',
    description:
      'Record the outcome of a branching step: which edge was taken and why. REQUIRED before moving past a step with branches — get_process_progress will not offer anything beyond an unresolved decision. If the chosen edge carries criteria, you MUST pass structured measurements (e.g. {"testPassRate": 100, "openCriticalIssues": 0} or {"contrastRatio": 4.7, "approvalsReceived": 4}); the engine verifies them and REFUSES the branch on any violation (evidence_conflict) — then ask the human whether the measurements are wrong or whether to take the failure branch, never how to override. Choosing a loop-back branch re-opens those steps.',
    inputSchema: schema(
      {
        stepId: { type: 'string' },
        branchTo: { type: 'string' },
        reason: { type: 'string' },
        evidence: { type: 'string', description: 'Free-text context (optional)' },
        measurements: {
          type: 'object',
          description: 'Structured measured values checked against the edge criteria, e.g. {"testPassRate": 100, "openCriticalIssues": 0, "rollbackReady": true}',
        },
      },
      ['stepId', 'branchTo', 'reason'],
    ),
    execute: async (args) =>
      startHostAction('resolve_decision', {
        stepId: args.stepId,
        branchTo: args.branchTo,
        reason: args.reason,
        evidence: args.evidence,
        measurements: args.measurements,
      }),
  },
  {
    name: 'resolve_deviation',
    description:
      'Resolve a skipped or pending step without running its action: mark it "completed" (it was done outside the app) or "not_applicable" for this run, with a reason. Prefer offering this to the human as a run-bound ask_user option — e.g. {"label": "Mark not applicable", "run": {"name": "resolve_deviation", "params": {"stepId": "s1", "resolution": "not_applicable", "reason": "not required in this run"}}} — so their click applies it directly.',
    inputSchema: schema(
      {
        stepId: { type: 'string', description: 'Step id from get_process_progress' },
        resolution: { type: 'string', enum: ['completed', 'not_applicable'] },
        reason: { type: 'string', description: 'Why — recorded in the journal' },
      },
      ['stepId', 'resolution'],
    ),
    execute: async (args) =>
      startHostAction('resolve_deviation', {
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
      "Saved playbooks that match what the human is entering RIGHT NOW, tiered: 'strong' matches (structured conditions plus keywords from the live text) also appear as an on-page card; 'candidate' matches (e.g. only the generic work-log kind matches) are shown to you alone — mention a candidate only if the text genuinely supports it. Explain WHY a match applies and offer load_process — suggest, never force. No match is a normal answer and often the moment to create a playbook.",
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
      'Execute one of the host app\'s actions (see describe_workspace) — this is how you replay a confirmed process: walk the map and run each step\'s action, asking the human at decision points. Unless the human enabled auto-approve, the call returns {status:"pending_approval", actionId} while an approval card is shown — poll get_action_result for the outcome; a denial is a normal answer, not an error.',
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
      startHostAction(String(args.name), (args.params ?? {}) as Record<string, unknown>, {
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
