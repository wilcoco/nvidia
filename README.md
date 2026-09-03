# 🎭 Understudy

> **Turn everyday work into a process your team can reuse.**

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
   process using the same page's actions, through assigned task forms, evidence checks, and review steps defined in
   the playbook. Agent actions request UI approval unless auto-approve is enabled.

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
WebMCP gives this shared-page interaction an explicit tool contract.

## Why WebMCP

WebMCP supports this product's shared-page interaction directly:

- The agent must **see what the human is doing right now** in the UI — the
  journal is page state.
- The human must **edit the agent's output in place** (the process map lives
  next to their work), and the agent must read those edits back.
- Replay means the agent **operates the same page the human sees**, with the
  human approving each step on screen.

Human and agent share one surface. The page registers tools via
`modelContext.registerTool()` / `provideContext()`, and a compatible browser
agent discovers and invokes them. The current E2E evidence covers the Codex
desktop app’s built-in browser; other clients require their own compatibility
checks. No site-owned LLM key is needed; the visitor’s agent may have its own
subscription, usage limits and costs.

## Live demo

Two host apps are included to prove the layer is app-agnostic:

- `/` — **the Understudy demo workspace**, a generic work-log & review app
  (contributors log work of any kind, team leads review it, and a
  **Playbooks** tab lists the shared library so anyone can follow a proven
  process). Integrated the "rich" way:
  semantic logs + registered actions + a process-store adapter.
- `/plain.html` — a deliberately plain, framework-free purchase-request page.
  Integrated with **one script tag** and `autoCapture: 'full'`.

All demo data is fictional. The demo workspace uses a small Express + Postgres backend
so worklogs, approvals, and the process library are shared across users.

**Reviewer accounts** (shown on the login screen as well):

| Username | Password | Role |
| --- | --- | --- |
| `judge` | `webmcp2026` | Reviewer (acts through the personas below) |
| `kim` | `linepulse` | Contributor |
| `park` | `linepulse` | Operations |
| `lee` | `linepulse` | Reviewer |

One login is enough: the **Working as** selector lets a judge act as Kim,
Park and Lee. These are demo personas, not separate authenticated identities.
Saved records are shared. **Workspace settings → Start a new work item**
clears only the current tab’s unsaved workspace and keeps shared records.

### Try the collaboration loop

1. Open the app with a desktop WebMCP-capable agent. Ask “What is this, and
   how do I use it?” to see the introduction on the page.
2. As Kim, describe a task such as “I’m preparing a customer order for delivery.”
   Choose to create a playbook and answer what must happen before and after it.
3. Answer questions about owners, required numbers, dropdown choices and routing
   rules. Review the map beside your work. For an existing confirmed playbook,
   use **Propose changes (new draft)** before editing. Ask the agent to read your
   corrections, then save the reviewed version.
4. Run that saved version. Kim’s preparation leads to Park’s task form. Enter
   the required values; ask the agent to check decision branches against those
   submissions. Lee reviews the evidence when the approval step is reached.
5. For similar new work, find the related playbook and choose whether to reuse it.

Desktop WebMCP handles creation, revision and decisions. Mobile is for assigned
input and review/approval; it is not a claim of agent-free completion for every
process. Browser viewport tests are separate from physical-device testing.

## WebMCP tools registered

| Tool | What it does |
| --- | --- |
| `describe_workspace` | App description, available host actions, map status. |
| `get_recent_actions` | The action journal (cursor-based). Human answers to agent questions surface here too. |
| `get_page_state` | Host-provided business state (records, statuses). |
| `propose_process_map` | Draw/replace the draft process map rendered in the panel. |
| `get_process_map` | Current map including human edits, confirmed flag, and per-step `done` flags. |
| `get_process_progress` | Run-state of the loaded process: done / next-up / skipped steps, plus a suggested next action — the missed-step coach. |
| `list_my_tasks` | The active persona's worklist: their ready steps (with required fields) and what the run is waiting on from other roles. |
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
| `load_process` | Start a saved playbook as a fresh run with no imported results. Resume specific earlier work with the on-page run picker. |
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

Run `npm run check` for TypeScript and `npm test` for SDK, memory-store and
HTTP regression tests. Set `TEST_DATABASE_URL` to a separate local test
PostgreSQL database to run the same storage and HTTP checks against Postgres.
The tests create records; do not point them at a production database.

Run `npm run test:browser` for the rendered Chrome journey: keyboard-edit a
draft, save v1 and v2, start a run, complete the Contributor and Operations
task forms at 375×768, approve as Reviewer, reload, and verify that the exact
completed run returns. It uses `CHROME_PATH` when set and otherwise looks for
the standard Chrome installation path; when Chrome is unavailable, the
browser test reports as skipped.

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
src/        demo workspace (React)
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
