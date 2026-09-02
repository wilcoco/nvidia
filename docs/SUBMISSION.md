# Devpost submission — Understudy

*(Paste-ready text for the submission form. Update the video URL before submitting.)*

## Elevator pitch (short)

Understudy is a drop-in WebMCP layer that lets an AI agent learn how your
experts actually work — by watching them do it. The human works; the agent
maps the process beside them; the human corrects the map and teaches it the
organization's judgment; the playbook then guides the next worker, catches
skipped steps before they happen, and executes fixes with human approval.

## What it does

Understudy works with an active WebMCP agent session — you invite the agent
once ("work along this with me"), and from then on it reads, asks and acts on
the same page; the playbook-suggestion cards and the live NEXT/SKIPPED map
colors are page-side and always on, agent or not. Ask ChatGPT, on any
Understudy-enabled page: *"Work along this incident with me, following our
process."* The agent reads the page's structured state,
finds the matching playbook (with confidence and reasons), and joins the run:

- **Capture** — while an expert handles a paint-shop defect, the agent reads
  the action journal and drafts a step-by-step response playbook, live, next
  to their work.
- **Teach** — the human edits the map in place: renames steps, fixes branch
  conditions, writes judgment rules ("lower viscosity to 17s only above 18
  after a color change"). The agent reads the edits (`get_map_edits`) — they
  outrank its inference — and its questions and next actions change.
- **Guide** — when a similar incident starts, condition-based matching (no
  LLM) surfaces the playbook: *92% match — incident type, color change,
  urgent*. Following it turns the map into a live guide: the next required
  step glows yellow, a jumped step turns red — page-side, instantly.
- **Protect** — `run_action` refuses to jump past required steps: *"Process
  violation prevented"*, before anything runs. The agent explains, offers
  one-click fixes (executable ask-cards), and proceeds only with human
  approval — or an explicit human override.
- **Remember** — every execution persists as a run record (who, when, which
  steps, deviations). Improvement stays human-verified: the agent proposes a
  revision from what the runs show, and confirming it saves a new version.

## Why WebMCP makes this possible

This product cannot exist as a chatbot or a server-side integration:

- The agent must see what the human is doing *right now* — the journal and
  live form context are page state, exposed as tools instead of guessed from
  pixels.
- The human must correct the agent's output *in place* — the map lives next
  to the work, and the agent reads those edits back.
- Execution means operating *the same page the human sees*, behind per-action
  approval cards.

Human and agent share one surface and one login. Understudy computes the
process state (steps, branches, deviations); WebMCP is the channel through
which the agent understands it and acts — with the human deciding.

We register 19 tools imperatively via `modelContext.registerTool()` (with
`provideContext` fallback), and the second demo page also exposes its form
through the declarative attribute API.

## How we built it

- **Understudy SDK** (TypeScript → one `understudy.js`): action journal +
  auto-capture, shadow-DOM side panel, process-map store with a run-state
  machine (done / next / skipped / blocked / conditional / not-applicable),
  branch resolution against live data, pre-execution process guard,
  session-history retro-linking, and 19 WebMCP tools.
- **Demo workspace** (React + Vite): a paint-shop incident &
  response log with reviews and a shared playbook library.
- **Server** (Express + Postgres on Railway): auth, incidents, reviews,
  playbook library with versioning, and persistent run records.

## Try it (reviewers)

- Live: https://nvidia-production-f205.up.railway.app
- Sign in: **judge / webmcp2026** (pre-filled; kim & lee / linepulse also work)
- Press **Start fresh demo** for a clean slate (playbooks are kept).
- Open the live URL using ChatGPT's in-app browser (desktop app agent), then
  say: *"Work along with me on this page — watch what I do, guide me with the
  saved playbooks, and ask questions when a process is missing knowledge."*
- Alternatively, use Chrome 149+ — the site carries a **WebMCP origin-trial
  token**, so no flags are needed for the API. Inspect and execute the
  registered tools under **DevTools → Application → WebMCP** (enable
  `chrome://flags/#devtools-webmcp-support` for that DevTools panel), or chat
  with the tools via Google's official Model Context Tool Inspector extension.
- Full walkthrough: `docs/DEMO_SCRIPT.md`. No payment or personal data; all
  scenario data is fictional.

## What's new vs. prior work

The concept distills lessons from earlier internal groupware experiments,
but **all code was written during the submission window** (see commit
history): the WebMCP layer, the process engine, both demo apps, and the
backend. What's genuinely new here is the collaboration shape — recorders
and RPA take turns with the human; Understudy works *with* them, at the same
time, on the same screen, and lets them teach it.
