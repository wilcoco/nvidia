# 🎭 Understudy

> **Turn everyday work into a process your team can reuse.**

Understudy is a WebMCP layer for turning everyday work into a process that
people can review and reuse. Adding the SDK script gives a web app an action
journal, an in-page process panel and an agent tool surface. Host actions,
shared persistence and governed execution are explicit integration tiers;
the demo workspace includes those adapters and its server enforcement module.

1. **The human just works.** Every meaningful action — clicks, form submissions,
   app-level events — lands in an action journal.
2. **The agent watches and structures.** Through WebMCP tools, the agent reads
   the journal and drafts a **live process map** beside the person's work:
   tasks, decisions, approvals, branch conditions.
3. **The human corrects the map in place.** Rename steps, change types, fix
   branch conditions, delete noise — the agent reads those edits back and asks
   follow-up questions ("You skipped approval this time — is it optional?").
   It focuses on one high-value judgment point by default; the human explicitly
   chooses whether to explore another point.
   The panel distinguishes registered browser tools from an agent that has
   actually invoked them, and offers an on-page evidence-only interview when a
   chat is not attached. That source capture cannot be saved as a runnable
   playbook until its placeholders are structured and reviewed.
4. **The agent runs the process.** Once confirmed, the agent replays the
   process using the same page's actions, through assigned task forms, evidence checks, and review steps defined in
   the playbook. Every host-app mutation requested by the agent waits for an
   explicit on-page approval.

5. **Processes become shared assets when a store is connected.** A confirmed
   process can be saved to a shared library so another worker can choose and
   follow a reviewed version.

Many organizations already have SOPs, ERP workflows and explicitly programmed
processes. Daily execution still contains gaps between those formal steps:
weak signals, exceptions, recovery choices and handoff judgment. Understudy
helps a team surface those gaps during real work, review them, and turn the
confirmed result into guided execution without asking the expert to begin with
a blank SOP.

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

Each production HTML shell loads `/understudy.js?v=<build>` and the workspace
footer shows that SDK build. This keeps an already-open browser's registered
tool provider on the same release as the reloaded app after a deployment.

## Live demo

Two host apps are included to prove the layer is app-agnostic:

- `/` — **the Understudy demo workspace**, a generic work-log & review app
  (contributors log work of any kind, team leads review it, and a
  **Playbooks** tab lists the shared library so anyone can follow a proven
  process). Integrated the "rich" way:
  semantic logs + registered actions + a process-store adapter.
- `/plain.html` — a deliberately plain, framework-free purchase-request page.
  One script tag and `autoCapture: 'full'` demonstrate observation, the panel
  and the WebMCP surface. It does not by itself provide the demo workspace's
  shared database, account model or server enforcement.

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
3. Answer one focused question at a time. Around judgment-heavy steps the
   interview moves from a real incident to observable cues, the tempting novice
   mistake, boundaries/exceptions, and failure/recovery. The source answers stay
   visible as draft evidence; the existing **Save as vN** action confirms them
   with the full playbook. Also define owners, required numbers, dropdown
   choices and routing rules. Review the map beside your work. For an existing confirmed playbook,
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
| `navigate_workspace` | Opens Create process, saved playbooks, assigned tasks, reviews, or source work records when the visitor asks. |
| `get_recent_actions` | The action journal (cursor-based). Human answers to agent questions surface here too. |
| `get_page_state` | Host-provided business state (records, statuses). |
| `propose_process_map` | Draw/replace the draft process map rendered in the panel. |
| `get_process_map` | Current map including human edits, elicitation source evidence, confirmed flag, and per-step `done` flags. |
| `get_process_progress` | Run-state of the loaded process: done / next-up / skipped steps, plus a suggested next action — the missed-step coach. |
| `list_my_tasks` | The active persona's worklist: their ready steps (with required fields) and what the run is waiting on from other roles. |
| `get_map_edits` | Human corrections to the map (cursor-based) — they outrank agent inference. |
| `get_map_gaps` | Adaptive agenda for structural gaps and expert judgment: incident → observable cues → novice mistake → boundary → failure/recovery. |
| `update_step` | Refine one step in place and encode the reviewed operational meaning; raw interview prose never becomes an executable rule automatically. |
| `ask_user` | Shows one question card and returns a pending id immediately. With a gap key, the page preserves the source question, answer, time and disposition on the relevant step. Options can carry a `run` binding. |
| `get_question_result` | Poll a question: pending, or answered with the human's answer. |
| `get_action_result` | Poll a gated run_action: pending, denied, or complete with the result. |
| `update_map_fields` | Set the playbook's data contract — typed fields (from the variables interview) rendered as a form for the next worker. |
| `resolve_deviation` | Mark a skipped step completed-outside-the-app or not-applicable, with a reason. |
| `resolve_decision` | Record which branch a branching step took, with reason and evidence; a loop-back choice re-opens the loop body. |
| `find_relevant_processes` | Playbooks matching what the human is entering right now, with confidence and reasons. |
| `list_saved_processes` | Shared process library — including processes other people confirmed. |
| `load_process` | Start a saved playbook as a fresh run with no imported results. Resume specific earlier work with the on-page run picker. |
| `run_action` | Execute a host action behind an in-page approval card. Refuses to jump past required undone steps; there is no agent-controlled override. |

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

### Integration tiers and trust boundary

| Tier | Host integration | What it provides |
| --- | --- | --- |
| Observe and teach | Script + `Understudy.init()` | Journal, interview cards, local map and WebMCP tools. |
| Operate | Registered actions + state provider | Human-approved host actions and task forms in that page. |
| Govern and share | Process-store adapter + authenticated server enforcement | Shared versions/runs, session-bound attribution, server revalidation of order, roles, evidence and approvals. |

The one-script example proves the first tier. A production claim about shared
workflow enforcement requires the third tier or an equivalent host backend;
the reference contract is documented in
[`docs/ENFORCEMENT_INTEGRATION.md`](docs/ENFORCEMENT_INTEGRATION.md).

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
Use `npm run test:postgres` for the required PostgreSQL lane: it fails before
testing when `TEST_DATABASE_URL` is absent or equals `DATABASE_URL`. GitHub
Actions runs this lane against an isolated PostgreSQL service; configure its
status as a required branch check if merges must be blocked on it.

Run `npm run test:browser` for the rendered Chrome journey: enter the Shadow
DOM with natural Tab/Shift+Tab navigation, keyboard-edit a
draft, save v1 and v2, start a run, complete the Contributor and Operations
task forms at 375×768, approve as Reviewer, reload, and verify that the exact
completed run returns. It uses `CHROME_PATH` when set and otherwise looks for
the standard Chrome installation path; when Chrome is unavailable, the
browser test reports as skipped locally. Set `BROWSER_E2E_REQUIRED=1` (or run
under `CI=true`) to make a missing Chrome installation fail this required gate.

The adaptive interview's methodology, compatibility contract and clean-room
implementation boundary are documented in
[`docs/ELICITATION_ENGINE.md`](docs/ELICITATION_ENGINE.md).

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

### Verify a deployed revision

1. Hard reload the live page (or open a fresh private tab). A tab opened before
   deployment keeps executing its old JavaScript runtime.
2. Compare the seven-character build shown in Settings with `git rev-parse
   HEAD`. Do not run acceptance scenarios until they match.
3. For an exact-build audit, download the live `index.html`, its referenced app
   bundle, and `/understudy.js`, then compare their SHA-256 hashes with a local
   production build made from that full commit.
4. Start a new synthetic run only after those checks. Record the build, run and
   review ids with the result so evidence from an older open tab is not mixed
   into the new deployment.

The automated memory/Chrome gates do not claim coverage of the conditional
PostgreSQL suite, a physical phone, or an external WebMCP client. Report those
only when they have been run separately.

Evidence procedures: [external WebMCP client](docs/EXTERNAL_WEBMCP_QA.md),
[physical mobile](docs/PHYSICAL_MOBILE_QA.md), and
[release manifest / Devpost checklist](docs/RELEASE_EVIDENCE.md).

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
public/plain.html   second host app (vanilla, one-script observation/tool tier)
```

## Prior work

The concept distills lessons from earlier internal groupware experiments
(worklog/approval/process-template systems). **All code in this repository is
new and was written during the challenge submission window** — the WebMCP
layer, the panel, and both demo apps; see the commit history. No company data
is included; all scenarios are fictional.

## License

[MIT](./LICENSE)
