import * as journal from './journal'
import * as mapstore from './mapstore'
import * as host from './host'
import { askUser, requestApproval } from './asks'
import { isAutoApprove, setWebmcpStatus } from './panel'
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
      'Start here. Describes this web app: what it is, what actions the agent can run on it, and whether a process map already exists. FlowCatch is a layer that lets you (the agent) watch what the human does in this app, structure their work into a business process, and later execute that process for them.',
    inputSchema: schema(),
    execute: async () => ({
      app: host.getAppName(),
      url: location.href,
      how_this_works:
        'The human works in the app; every meaningful action is journaled. Read the journal with get_recent_actions, infer the workflow, and propose_process_map to render it beside their work. The human edits your map directly in the page (read edits via get_map_edits, and their answers via get_recent_actions). Once the map is confirmed, replay it with run_action following the map, step by step.',
      available_actions: host.listActions(),
      process_map_exists: mapstore.getMap() !== null,
      process_map_confirmed: mapstore.getMap()?.confirmed ?? false,
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
      'Draw or replace the draft process map shown beside the human\'s work. Derive it from the journal: one step per meaningful unit of work, "decision" steps where the flow branched, "approval" steps where sign-off happened. Where a step corresponds to a host action, set its "action" field so the process can be replayed later. The human will edit your draft directly — check get_map_edits afterwards.',
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
      'The current process map, including any edits the human made (renames, type changes, removed steps, branch conditions) and whether they confirmed it.',
    inputSchema: schema(),
    execute: async () => mapstore.getMap() ?? { exists: false },
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
      'Show the human a question card inside the page and wait for their answer. Use it to fill gaps the journal cannot answer: branch conditions, whether a skipped step was optional, who approves what. Prefer concrete options over open questions.',
    inputSchema: schema(
      {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, description: 'Optional quick-answer buttons' },
      },
      ['question'],
    ),
    execute: async (args) => {
      const options = Array.isArray(args.options) ? args.options.map(String) : undefined
      const answer = await askUser(String(args.question), options)
      return { answer }
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
      },
      ['name'],
    ),
    execute: async (args) => {
      const action = host.getAction(String(args.name))
      if (!action) {
        return { ok: false, error: `Unknown action "${args.name}". Call describe_workspace for the list.` }
      }
      const params = (args.params ?? {}) as Record<string, unknown>
      if (!isAutoApprove()) {
        const approved = await requestApproval(action.name, params)
        if (!approved) return { ok: false, denied: true, note: 'The human denied this action.' }
      }
      journal.record('agent', 'action', `ran ${action.name}`, params)
      try {
        const result = await action.handler(params)
        return { ok: true, result }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
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
  ;(window as any).__flowcatch = {
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
    console.warn('[FlowCatch] WebMCP registration failed:', err)
    setWebmcpStatus('error')
  }
}
