import * as journal from './journal'
import * as mapstore from './mapstore'
import * as host from './host'
import { askUser, getQuestionResult, getActionResult, type AskOption } from './asks'
import { setWebmcpStatus, openUsageGuide } from './panel'
import { startHostAction, preconditionFor } from './runner'
import { startRunTracking } from './runsync'
import type { ProcessMap } from './types'
import { describeOnboarding } from './onboarding'
import { validateFields } from '../shared/fields'

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

const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    key: {type: 'string', description: 'Unique camelCase input key'},
    label: {type: 'string', description: 'Label shown to the worker'},
    type: {type: 'string', enum: ['number', 'string', 'boolean', 'select']},
    options: {type: 'array', items: {type: 'string'}, description: 'Required for select: the human-approved dropdown choices. No default is selected.'},
    unit: {type: 'string'},
    required: {type: 'boolean'},
    confirm: {type: 'boolean', description: 'Boolean acknowledgment that must be checked true, not a pass/fail measurement.'},
  },
  required: ['key', 'type'],
}

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Short unique id, e.g. "s1"' },
    label: { type: 'string', description: 'Human-readable step name' },
    type: { type: 'string', enum: ['task', 'decision', 'approval'] },
    approvalPurpose: {type: 'string', enum: ['work', 'plan'], description: 'For approval steps, ask whether the person approves completed work (work) or only a remediation/redesign plan (plan). Plan approval never certifies that failed work checks passed.'},
    detail: { type: 'string', description: 'Optional one-line explanation' },
    role: {type: 'string', description: 'Owner role from describe_workspace'},
    humanOnly: {type: 'boolean'},
    fields: {type: 'array', items: {type: 'string'}, description: 'Input keys this task collects. Every declared input must be assigned to a task; ask the human who records it and when.'},
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
              'Machine-checkable routing rules from the human: numbers use e.g. {"testPassRate":{"gte":100}}; dropdowns use exact choices e.g. {"shippingMethod":{"eq":"Courier"}} and {"shippingMethod":{"eq":"Pickup"}} on the respective edges. Always set criteria when the human states thresholds or choice-based routes. resolve_decision checks submitted task values and refuses a contradictory route. A prose condition alone does not enforce the dropdown choice.',
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
      'Start here for introductory or help questions. Interpret intent, not exact wording: "What is this?", "What does this service do?", "Who is it for?", "What can I do here?", "이게 뭐야?", "뭐 하는 서비스야?", "어떤 도움이 돼?" request guide_topic:"overview". "How do I use it?", "Where do I start?", "어떻게 써?", "사용법 알려줘" request guide_topic:"usage". Set show_guide:true for these requests so the web page responds with the relevant guide; use guide_language:"ko" for Korean, otherwise "en". For routine context reads, omit show_guide so the page is not interrupted. Returns a plain-language introduction, creating vs running guidance and current context. Answer the actual question in the visitor’s language, then offer one relevant next step. No records, drafts or runs are changed; opening help preserves their work. Visitors do not need tool names or a magic phrase. Also lists available actions and process status for continuing with WebMCP.',
    inputSchema: schema({show_guide: {type: 'boolean', description: 'Open on-page usage instructions when the visitor asks for help. Default false.'},
      guide_language: {type: 'string', enum: ['en', 'ko'], description: 'Language of the on-page guide. Match the visitor; default en.'},
      guide_topic: {type: 'string', enum: ['overview', 'usage'], description: 'overview for purpose, benefits and audience; usage for how to start and operate. Default usage.'}}),
    execute: async (args) => {
      const guideOpened = args.show_guide === true && openUsageGuide(args.guide_language === 'ko' ? 'ko' : 'en', args.guide_topic === 'overview' ? 'overview' : 'usage')
      return {
        guide_opened: guideOpened,
        app: host.getAppName(),
        url: location.href,
        onboarding: describeOnboarding(),
        how_this_works:
          'The human works in the app; every meaningful action is journaled. Read the journal with get_recent_actions, infer the workflow, and propose_process_map to render it beside their work. The human edits your map directly in the page (read edits via get_map_edits, and their answers via get_recent_actions). Once the map is confirmed, replay it with run_action step by step — and while a confirmed process is loaded, get_process_progress tells you what is done, what comes next, and what was skipped, so you can coach the human through it. When the human starts an entry that matches NO saved playbook (find_relevant_processes), that is the capture moment: draft a map immediately and interview them with get_map_gaps while they work — the process takes shape on their screen as they answer.',
        available_actions: host.listActions(),
        process_map_exists: mapstore.getMap() !== null,
        process_map_confirmed: mapstore.getMap()?.confirmed ?? false,
        process_library_available: host.getProcessStore() !== null,
        journal_entries: journal.all().length,
      }
    },
  },
  {
    name: 'get_recent_actions',
    description:
      "Recent page actions and persistent run_events (completed attempts, retries and reported problems). Page entries use the numeric cursor; run_events are the loaded run's recent durable history and remain available after reload. Use their stable ids to deduplicate. Read reported problems before proposing a draft revision.",
    inputSchema: schema({
      since: { type: 'number', description: 'Return entries with id greater than this (default 0)' },
      limit: { type: 'number', description: 'Max entries (default 50)' },
    }),
    execute: async (args) => {
      const entries = journal.since(Number(args.since ?? 0), Number(args.limit ?? 50))
      return {
        entries,
        run_events: (mapstore.getMap()?.events ?? []).slice(-Number(args.limit ?? 50)),
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
          items: FIELD_SCHEMA,
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
      const invalid = validateFields(map.fields ?? [])
      if (invalid) return {ok: false, error: invalid}
      mapstore.proposeMap(map)
      return {
        ok: true,
        rendered: true,
        note:
          'Map is now visible to the human, who may edit it. Ask which numbers and dropdown choices each task must record, their units/options, required status and owner. Bind every input to a task. When a choice controls routing, ask what each choice leads to and encode exact equality criteria on the branches.' +
          (map.appliesWhen ? '' : ' WARNING: no applies_when set — this playbook will not be auto-suggested later. Set it if the process is tied to entry conditions.'),
      }
    },
  },
  {
    name: 'update_map_fields',
    description:
      'After asking what each task must record, define its numbers (including units), text, booleans or dropdowns (type select with options). Ask which are required, who records them and any pass thresholds; never invent measurements or choices. Then bind every key to its collecting task using update_step.fields and set the owner role. Inputs appear on that owner’s My tasks form and must pass validation before completion. Collect evidence in a task before a decision or approval. Set branch criteria separately for thresholds; an input being filled does not mean it passed.',
    inputSchema: schema(
      {
        fields: {
          type: 'array',
          items: FIELD_SCHEMA,
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
            : 'Ask the 2-3 most important questions via ask_user — in your own words, using this app\'s domain language, not the generic fallback_question text. The human may also just edit the map directly (watch get_map_edits).',
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
        approvalPurpose: {type: 'string', enum: ['work', 'plan'], description: 'Approval scope confirmed by the human: completed work or a remediation plan only.'},
        branch_to: { type: 'string', description: 'Target step id of an existing edge to update' },
        branch_condition: { type: 'string', description: 'New condition for that edge' },
        branch_criteria: {
          type: 'object',
          description:
            'Machine-checkable criteria for that edge, e.g. {"testPassRate": {"gte": 100}} or {"contrastRatio": {"gte": 4.5}, "openCriticalIssues": {"eq": 0}} — resolve_decision then verifies measurements against them in the process engine (outside your control) before any branch is taken. ALWAYS encode thresholds the human states.',
        },
        humanOnly: {
          type: 'boolean',
          description: 'Mark the step as inherently manual (no host action can perform it); clears any action binding',
        },
        role: {
          type: 'string',
          description:
            "Role responsible for this step. Read get_page_state.users for this workspace’s actual roles. Only that role's persona can complete it or resolve its decision. Set it when the human names who does a step.",
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Keys of the playbook's data-contract fields (update_map_fields) this step must capture — the assignee's task card then shows exactly those inputs (e.g. the snapshot step captures only snapshotId).",
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
          role: args.role === undefined ? undefined : String(args.role),
          fields: Array.isArray(args.fields) ? args.fields.map(String) : undefined,
          approvalPurpose: args.approvalPurpose === undefined ? undefined : String(args.approvalPurpose) as 'work' | 'plan',
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
    name: 'list_my_tasks',
    description:
      "The active persona's worklist for the running playbook: steps that are ready and belong to their role (or to anyone), plus what the run is waiting on from other roles. Use it to answer 'do I have anything to do?' / 'who is blocked?'. Completing work happens via the page (task cards / run_action), not by editing state directly.",
    inputSchema: schema(),
    execute: async () => {
      const map = mapstore.getMap()
      if (!map?.confirmed) return { active: false, note: 'No confirmed process is running.' }
      const statuses = mapstore.progress(preconditionFor)
      const role = host.actorRole()
      const gate = mapstore.pendingDecision()
      const ready = map.steps.filter((s) => statuses.get(s.id) === 'ready' || s.id === gate?.id)
      const mine = ready.filter((s) => !s.role || !role || s.role === role)
      const waiting = ready.filter((s) => s.role && role && s.role !== role)
      return {
        active: true,
        persona_role: role ?? 'unknown',
        my_tasks: mine.map((s) => ({
          stepId: s.id,
          label: s.label,
          type: s.type,
          detail: s.detail,
          required_fields: s.fields,
          how_to_complete:
            s.type === 'decision'
              ? 'Use the desktop WebMCP agent and resolve_decision with the submitted evidence. This is not a task-card completion.'
              : s.type === 'approval'
              ? 'Decide it in the Reviews screen (or approve/reject_review action).'
              : s.action
                ? `Run or perform the bound action \"${s.action}\".`
                : 'The assignee completes it from their My-tasks card.',
        })),
        waiting_on: waiting.map((s) => ({ label: s.label, role: s.role })),
      }
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
          role: s.role,
          status: statuses.get(s.id),
          resultId: s.resultId,
          blockedReason:
            statuses.get(s.id) === 'blocked' && s.action ? preconditionFor(s.action) : undefined,
        }))
      const activeRole = host.actorRole()
      const ready = view.find((s) => s.status === 'ready')
      const assignment = ready
        ? {
            step: ready.label,
            assigned_role: ready.role ?? 'anyone',
            is_active_personas_turn: !ready.role || !activeRole || ready.role === activeRole,
            note: ready.role && activeRole && ready.role !== activeRole
              ? `Waiting on the ${ready.role} role — the active persona (${activeRole}) cannot complete it. Suggest switching persona or notifying that role.`
              : undefined,
          }
        : undefined
      const blocked = view.find((s) => s.status === 'blocked')
      const gate = mapstore.pendingDecision()
      const branchingSteps = map.steps
        .filter((s) => (s.next?.length ?? 0) > 1)
        .map((s) => ({
          id: s.id,
          label: s.label,
          type: s.type,
          branches: s.next,
          // `decisions_taken` below is the durable audit trail. `chosen` is
          // deliberately narrower: only the decision on the current active
          // route, never a superseded choice from an inactive branch.
          chosen: mapstore.currentDecision(s.id, statuses),
          note: 'Resolve with resolve_decision before moving past this step; loop-back choices re-open the loop body.',
        }))
      return {
        active: true,
        assignment,
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
      'Record the outcome of a branching step: which edge was taken and why. REQUIRED before moving past a step with branches — get_process_progress will not offer anything beyond an unresolved decision. The engine uses the assignee’s submitted task values for branch criteria, including dropdown choices (e.g. shippingMethod equals Courier). Read get_process_map first. Only pass measurements when you have additional real evidence; never replace submitted values. For example, numeric measurements may be {"testPassRate": 100, "openCriticalIssues": 0}; the engine verifies them and REFUSES the branch on any violation (evidence_conflict) — then ask the human whether the measurements are wrong or whether to take the failure branch, never how to override. Choosing a loop-back branch re-opens those steps.',
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
      return {
        processes: await store.list(),
        versioning_note:
          'Versions are immutable rows: saving an update creates a NEW id under the SAME title, and this list shows only the latest version per title. A new id after a save is the same playbook, revised — not a separate playbook.',
      }
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
      const result = (await store.findRelevant()) as {
        matches?: unknown[]
        entering_now?: { hasInput?: boolean }
        system_generated?: boolean
      } & Record<string, unknown>
      const hasInput = result?.entering_now?.hasInput !== false
      if (result?.system_generated) {
        result.capture_opportunity = null
        return result
      }
      if (Array.isArray(result?.matches) && result.matches.length === 0 && hasInput) {
        result.capture_opportunity =
          'No saved playbook covers what the human is entering right now. This is the moment to CREATE one: draft an initial map from the entry and the journal (propose_process_map), then interview via get_map_gaps — which variables must be captured, what precedes and follows, warning signs, who approves. The map grows beside their work as they answer.'
      }
      return result
    },
  },
  {
    name: 'load_process',
    description:
      'Start a fresh execution of a saved playbook from the shared library. It renders in the panel, already confirmed, with every task unfinished and no previous result IDs or evidence. Earlier session actions are never imported automatically. To continue existing work, ask the human to select it in Choose an existing run. For a new execution, work along it with run_action, asking the human at decision points.',
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
