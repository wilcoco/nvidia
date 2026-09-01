# ⚡ FlowCatch

> **You did it once. The agent can do it forever.**

FlowCatch is a **drop-in WebMCP layer** that turns any web work-app into an
agent-readable, agent-operable workspace. Add one script tag, and:

1. **The human just works.** Every meaningful action — clicks, form submissions,
   app-level events — lands in an action journal.
2. **The agent watches and structures.** Through WebMCP tools, the agent reads
   the journal and drafts a **live process map** beside the person's work:
   tasks, decisions, approvals, branch conditions.
3. **The human corrects the map in place.** Rename steps, change types, fix
   branch conditions, delete noise — the agent reads those edits back and asks
   follow-up questions ("You skipped approval this time — is it optional?").
4. **The agent runs the process.** Once confirmed, the agent replays the
   process using the same page's actions, with a human approval gate on every
   step (or auto-approve, if the human enables it).

Company processes live in people's habits, not in documents. FlowCatch turns
**doing** into **documentation** into **automation** — without anyone ever
writing a process down.

## Why WebMCP

This product cannot exist as a chatbot or a server-side MCP integration:

- The agent must **see what the human is doing right now** in the UI — the
  journal is page state.
- The human must **edit the agent's output in place** (the process map lives
  next to their work), and the agent must read those edits back.
- Replay means the agent **operates the same page the human sees**, with the
  human approving each step on screen.

Human and agent share one surface. That is exactly the collaboration WebMCP
enables: the page registers tools via `modelContext.registerTool()` /
`provideContext()`, and the agent in the browser (ChatGPT's in-app browser, or
Chrome 149+ with `chrome://flags/#enable-webmcp-testing`) calls them directly.

## Live demo

Two host apps are included to prove the layer is app-agnostic:

- `/` — **LinePulse**, a shift worklog & approvals mini-groupware
  (manufacturing scenario: line workers file worklogs, team leads approve).
  Integrated the "rich" way: semantic logs + registered actions.
- `/plain.html` — a deliberately plain, framework-free purchase-request page.
  Integrated with **one script tag** and `autoCapture: 'full'`.

All demo data is fictional and lives in `localStorage` (no backend, no
accounts — reviewers need no credentials).

### Try the collaboration loop

1. Open the app in ChatGPT's browser (or Chrome with the WebMCP flag) and ask
   the agent: *"Watch what I do and turn it into a process."*
2. As Kim (line worker): write a worklog, mark it urgent, request approval.
   Switch to Lee (team lead) and approve it.
3. Ask the agent to draft the process. Edit its map in the FlowCatch panel —
   rename a step, fix a branch condition — and watch its follow-ups change.
4. Press **Confirm process**, then ask the agent to *run* it (e.g. "file
   today's worklog for booth 2 and route it for approval"). Approve each agent
   action in the panel.

## WebMCP tools registered

| Tool | What it does |
| --- | --- |
| `describe_workspace` | App description, available host actions, map status. |
| `get_recent_actions` | The action journal (cursor-based). Human answers to agent questions surface here too. |
| `get_page_state` | Host-provided business state (records, statuses). |
| `propose_process_map` | Draw/replace the draft process map rendered in the panel. |
| `get_process_map` | Current map including human edits + confirmed flag. |
| `get_map_edits` | Human corrections to the map (cursor-based) — they outrank agent inference. |
| `ask_user` | In-page question card; resolves with the human's answer. |
| `run_action` | Execute a host action (replay), gated by an in-page human approval card. |

## Attach FlowCatch to your own app

```html
<script src="/flowcatch.js"></script>
<script>
  FlowCatch.init({
    appName: 'My CRM',
    autoCapture: 'full',              // or 'min' if you emit semantic logs
    stateProvider: () => ({ ... }),   // what the agent sees via get_page_state
    actions: [{                        // what the agent may do via run_action
      name: 'create_ticket',
      description: 'Create a support ticket.',
      params: { title: { type: 'string', required: true } },
      handler: (p) => createTicket(p),
    }],
  })
  // Optional richer journal: FlowCatch.log('closed ticket #42', {...})
</script>
```

No framework requirements. The panel renders in shadow DOM, so host styles and
panel styles cannot collide.

## Run locally

```bash
npm install
npm run dev        # builds sdk → public/flowcatch.js, starts Vite on :5173
npm run build      # production build to dist/
```

To exercise the tools without an agent, open the console:
`__flowcatch.call('describe_workspace')`,
`__flowcatch.call('propose_process_map', {...})`, etc.

## Repository layout

```
sdk/        FlowCatch itself (TypeScript → bundled to a single flowcatch.js)
  index.ts    entry & public API (init / log / registerAction)
  capture.ts  automatic action capture (clicks, submits, navigation)
  journal.ts  the action journal
  mapstore.ts process map state + human-edit tracking
  asks.ts     agent→human questions & action-approval gates
  panel.ts    the in-page side panel (shadow DOM)
  tools.ts    WebMCP tool definitions & registration
src/        LinePulse demo host app (React)
public/plain.html   second host app (vanilla, one-script-tag attach)
```

## Prior work

The concept distills lessons from earlier internal groupware experiments
(worklog/approval/process-template systems). **All code in this repository is
new and was written during the challenge submission window** — the WebMCP
layer, the panel, and both demo apps; see the commit history. No company data
is included; all scenarios are fictional.

## License

[MIT](./LICENSE)
