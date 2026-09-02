# 🎭 Understudy

> **You did it once. The agent can do it forever.**

Understudy is a **drop-in WebMCP layer** that turns any web work-app into an
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

5. **Processes become shared assets.** A confirmed process is saved to a
   team-wide library — anyone (or their agent) can pull up a process a
   colleague refined and work along it.

Company processes live in people's habits, not in documents. Understudy turns
**doing** into **documentation** into **automation** — without anyone ever
writing a process down.

The point is not "AI automates your work" — recorders, task miners, and
computer-use agents already chase that, all of them turn-taking: the human
records, then the tool takes over. Understudy's claim is different:
**automation becomes something the human and the agent do together, at the
same time, on the same screen.** The human keeps working while the map grows
beside them; the human touches the map and the agent's next question changes.
That simultaneity is exactly what WebMCP makes possible — and what nothing
else provides.

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
`provideContext()`, and the agent in the browser (ChatGPT's in-app browser)
calls them directly. In Chrome 149+ you can also inspect and execute the
registered tools yourself: enable `chrome://flags/#enable-webmcp-testing` and
`chrome://flags/#devtools-webmcp-support`, then open
**DevTools → Application → WebMCP**.

## Live demo

Two host apps are included to prove the layer is app-agnostic:

- `/` — **the Understudy demo workspace**, a paint-shop incident & response log (automotive
  manufacturing scenario: line workers log defects like orange peel with the
  line conditions — viscosity, booth temperature, spray pressure — team leads
  review corrective actions, and a **Playbooks** tab lists the shared library
  so anyone can follow a proven response process). Integrated the "rich" way:
  semantic logs + registered actions + a process-store adapter.
- `/plain.html` — a deliberately plain, framework-free purchase-request page.
  Integrated with **one script tag** and `autoCapture: 'full'`.

All demo data is fictional. The demo workspace uses a small Express + Postgres backend
so worklogs, approvals, and the process library are shared across users.

**Reviewer accounts** (shown on the login screen as well):

| Username | Password | Role |
| --- | --- | --- |
| `judge` | `webmcp2026` | Reviewer (acts through the personas below) |
| `kim` | `linepulse` | Line worker |
| `lee` | `linepulse` | Team lead |

One login is enough: the persona switcher in the top bar lets a single
reviewer play both sides of the flow (worker files, lead approves).

### Try the collaboration loop

1. Open the app in ChatGPT's browser (or Chrome with the WebMCP flag) and ask
   the agent: *"Watch how I handle this incident and turn it into a playbook."*
2. As Kim (line worker): log an **orange peel** defect right after a color
   change — enter viscosity, booth temp, spray pressure — mark it urgent, and
   send it to the lead. Switch to Lee (team lead) and approve the corrective
   action.
3. Ask the agent to draft the response process. Edit its map in the Understudy
   panel — rename a step, fix the branch condition (e.g. *urgent entries
   only*) — and watch its follow-up questions change.
4. Press **Confirm & save to library**, then open **Playbooks → Follow this
   playbook** as a "new worker". The map now guides the run in real time:
   the next required step glows yellow, and a step you jumped past turns
   red — page-side, instantly, no agent call needed. Ask the agent and it
   reads the same state via `get_process_progress`, then *coaches* rather
   than polices: "This urgent entry moved forward without supervisor
   approval — want me to request it from Lee now?" One click on its
   approval card, and the step goes green.

## WebMCP tools registered

| Tool | What it does |
| --- | --- |
| `describe_workspace` | App description, available host actions, map status. |
| `get_recent_actions` | The action journal (cursor-based). Human answers to agent questions surface here too. |
| `get_page_state` | Host-provided business state (records, statuses). |
| `propose_process_map` | Draw/replace the draft process map rendered in the panel. |
| `get_process_map` | Current map including human edits, confirmed flag, and per-step `done` flags. |
| `get_process_progress` | Run-state of the loaded process: done / next-up / skipped steps, plus a suggested next action — the missed-step coach. |
| `get_map_edits` | Human corrections to the map (cursor-based) — they outrank agent inference. |
| `get_map_gaps` | The interview agenda: what the map does not yet know — missing before/after steps, undecided branches, no sign-off, steps without judgment rules. |
| `update_step` | Refine one step in place — the agent writes the human's explained judgment rules into step notes. |
| `ask_user` | Shows a question card and returns a pending id immediately (humans take longer than tool timeouts). Options can carry a `run` binding that executes an action on the human's click. |
| `get_question_result` | Poll a question: pending, or answered with the human's answer. |
| `get_action_result` | Poll a gated run_action: pending, denied, or complete with the result. |
| `update_map_fields` | Set the playbook's data contract — typed fields (from the variables interview) rendered as a form for the next worker. |
| `resolve_deviation` | Mark a skipped step completed-outside-the-app or not-applicable, with a reason. |
| `resolve_decision` | Record which branch a branching step took, with reason and evidence; a loop-back choice re-opens the loop body. |
| `find_relevant_processes` | Playbooks matching what the human is entering right now, with confidence and reasons. |
| `list_saved_processes` | Shared process library — including processes other people confirmed. |
| `load_process` | Load a saved process for a new run; work already done this session is auto-linked as done. |
| `run_action` | Execute a host action behind an in-page approval card. Refuses to jump past required undone steps ("Process violation prevented") unless the human explicitly overrides. |

## Attach Understudy to your own app

```html
<script src="/understudy.js"></script>
<script>
  Understudy.init({
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
  // Optional richer journal: Understudy.log('closed ticket #42', {...})
</script>
```

No framework requirements. The panel renders in shadow DOM, so host styles and
panel styles cannot collide.

## Run locally

```bash
npm install
npm run dev:server # API on :8787 (in-memory store when DATABASE_URL is unset)
npm run dev        # builds sdk → public/understudy.js, starts Vite on :5173 (proxies /api)
npm run build      # production build to dist/
npm start          # serves dist/ + API from one process (production mode)
```

## Deploy (Railway)

1. New Project → **Deploy from GitHub repo** → this repository. Nixpacks runs
   `npm install && npm run build` and starts `npm start` automatically.
2. **+ New → Database → Add PostgreSQL** in the same project, and give the
   service the `DATABASE_URL` variable (Railway offers the reference:
   `${{Postgres.DATABASE_URL}}`). Tables and demo accounts are created
   automatically on first boot.
3. Optionally set `SESSION_SECRET` (any random string) so logins survive
   redeploys. **Settings → Networking → Generate Domain** for the public URL.

Without `DATABASE_URL` the server still runs with an in-memory store, so
nothing else is required to try it.

To exercise the tools without an agent, open the console:
`__understudy.call('describe_workspace')`,
`__understudy.call('propose_process_map', {...})`, etc.

## Repository layout

```
sdk/        Understudy itself (TypeScript → bundled to a single understudy.js)
  index.ts    entry & public API (init / log / registerAction)
  capture.ts  automatic action capture (clicks, submits, navigation)
  journal.ts  the action journal
  mapstore.ts process map state + human-edit tracking
  asks.ts     agent→human questions & action-approval gates
  panel.ts    the in-page side panel (shadow DOM)
  tools.ts    WebMCP tool definitions & registration
src/        paint-shop demo workspace (React)
server/     Express API + Postgres/in-memory storage (auth, worklogs, approvals, process library)
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
