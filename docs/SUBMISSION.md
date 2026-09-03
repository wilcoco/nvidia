# Devpost submission — Understudy

*(Paste-ready text for the submitted project. Public links verified on 2026-09-04.)*

- Demo video: https://youtu.be/kKhdmuNePNM
- Source repository: https://github.com/wilcoco/nvidia

## Elevator pitch (short)

Understudy is a drop-in WebMCP layer that lets an AI agent learn how your
experts actually work — by watching them do it. The human works; the agent
maps the process beside them; the human corrects the map and teaches it the
organization's judgment; the playbook then guides the next worker, catches
skipped steps before they happen, and executes fixes with human approval.
The point is bigger than logging the event: around every work event,
Understudy captures what must be prepared and prevented *before* it and what
must be verified and signed off *after* it — and makes that surrounding
process enforceable.

**At a glance — what makes it stand out**

- Raw one-line work log → interviewed into an established process (the
  before/prevention and after/verification the expert never writes down).
- Bidirectional teaching: edit the map by click or by chat — the agent reads
  the edits back and changes its behavior.
- The map is a runtime: the engine refuses out-of-order decisions and
  evidence-contradicting passes (`out_of_sequence` / `evidence_conflict`),
  and the server independently refuses reviews/approvals of unfinished runs
  and edits to approved records (`process_incomplete` /
  `approved_immutable`).
- No site-owned LLM API key: the page ships tools; visitors use their own agent, with its own limits and costs.
- Agents self-onboard from tool descriptions alone; the interview is
  anti-parrot by design.
- Playbooks are versioned assets with lineage, a data contract that becomes
  real form fields, and explained suggestions (confidence + reasons).
- Everything the next worker needs — suggestions, NEXT/SKIPPED guidance,
  task cards, approvals, server gates — also works with **no agent at all**;
  only resolving a decision branch goes through the agent, deliberately,
  because that call is the evidence-checking gate itself. This is also the
  mobile scope: processes are created and decisions handled with the agent
  on desktop — while assignees' input,
  handoffs and reviews still work on a phone's plain browser.
- Explicit review controls: persona-scoped approval UI, role-gated actions,
  UI-confirmed saves, and an auto-approve option. See the demo trust model below.
- It is a layer: one script tag attaches it to a second, framework-free page.

(Full list with proof points: `docs/KEY_STRENGTHS.md`.)

## What it does

Understudy works with an active WebMCP agent session — you invite the agent
("work along this with me"); during that conversation it reads, asks and acts on
the same page; the playbook-suggestion cards and the live NEXT/SKIPPED map
colors are computed by the page. Ask a compatible WebMCP agent on an
Understudy-enabled page: *"Work along this incident with me, following our
process."* The agent reads the page's structured state,
finds the matching playbook (with confidence and reasons), and joins the run:

- **Capture** — while an expert handles real work (a staging schema
  migration, an incident), the agent reads
  the action journal and drafts a step-by-step response playbook, live, next
  to their work.
- **Teach** — the human edits the map in place: renames steps, fixes branch
  conditions, writes judgment rules ("lower viscosity to 17s only above 18
  after a color change"). The agent reads the edits (`get_map_edits`) — they
  outrank its inference — and its questions and next actions change.
- **Operate** — the saved playbook runs as real work: every step belongs to
  a role (Contributor / Operations / Reviewer personas), the assignee's
  **My tasks** card shows exactly the inputs that step must capture, other
  roles see "Waiting on…", failure branches re-assign recovery work
  automatically, reaching the sign-off step creates the pending review by
  itself, and the run — roles, decisions, submitted values, timeline —
  survives a page reload.
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

**What people and agents can do together:** the page gives the agent
structured observations and named actions. The human works and answers;
the agent observes, interviews, and structures; the human corrects the map;
the runtime then assigns steps, checks evidence and routes the next run
for sign-off. WebMCP makes these interactions available through the page's
explicit tool contract while both participants share the same workspace.

## Why WebMCP makes this possible

WebMCP supports this product's shared-page interaction directly:

- The agent must see what the human is doing *right now* — the journal and
  live form context are page state, exposed as tools instead of guessed from
  pixels.
- The human must correct the agent's output *in place* — the map lives next
  to the work, and the agent reads those edits back.
- Execution means operating *the same page the human sees*, behind per-action
  approval cards.

Human and agent share one surface and one login. Understudy computes the
process state (steps, branches, deviations); WebMCP is the channel through
which the agent understands it and acts. The page provides explicit review
controls; these controls do not authenticate human presence.

We register 20 tools imperatively via `modelContext.registerTool()` (with
`provideContext` fallback), and the second demo page also exposes its form
through the declarative attribute API.

## How we built it

- **Understudy SDK** (TypeScript → one `understudy.js`): action journal +
  auto-capture, shadow-DOM side panel, process-map store with a run-state
  machine (done / next / skipped / blocked / conditional / not-applicable),
  branch resolution against live data, pre-execution process guard,
  isolated executions with explicit run restoration, and 20 WebMCP tools.
- **Demo workspace** (React + Vite): a generic work-log workspace with
  reviews and a shared playbook library (incidents are one scenario).
- **Server** (Express + Postgres on Railway): auth, incidents, reviews,
  playbook library with versioning, and persistent run records.

## Try it (reviewers)

- Live: https://nvidia-production-f205.up.railway.app
- Video: https://youtu.be/kKhdmuNePNM (2:50, English narration and burned-in English captions)
- Source: https://github.com/wilcoco/nvidia (MIT)
- Sign in: **judge / webmcp2026** (pre-filled; kim & lee / linepulse also work)
- Use **Workspace settings → Start a new work item** to clear the current tab’s
  unsaved workspace while preserving saved records and other reviewers’ work.
- Tested client: the **Codex desktop app’s built-in browser** with an agent
  discovering and invoking the registered WebMCP tools. Other clients need
  separate compatibility verification.
- Ask: *“What is this, and how do I use it?”* Then describe one work activity,
  answer the on-page questions and review the process map before saving it.
- Full walkthrough: `docs/DEMO_SCRIPT.md`. No payment or personal data; all
  scenario data is fictional.

## Not a diagram generator

AI process-map generators (Eraser, Whimsical AI, Miro AI) draw a picture of
a process **you can already describe**, and the picture is where it ends.
Understudy differs on both ends of the pipeline:

- **Input**: it captures the process from *observed work plus interviews* —
  surfacing the tacit parts (early-warning signs, pass thresholds, rework
  loops, who signs off) that experts never think to write down. A prompt box
  can't start there.
- **Output**: the map is not documentation but an *enforced runtime*: it is
  suggested to the next worker automatically, renders NEXT/SKIPPED live,
  blocks skipped prerequisites server-side, refuses pass decisions that
  contradict measured evidence, and routes the final sign-off to a human.

A diagram can't refuse a bad pass decision. This playbook does.
*A picture of the process vs. an operating system for the process.*

## Scope: this build is the capture layer — operations is the layer it seeds

What this submission delivers end-to-end is **process construction,
enforcement and a working operations core**: observe → interview → map →
save as a versioned playbook → suggest to the next worker → assign steps by
role with per-persona worklists (My tasks) → gate on order, evidence and
required inputs → auto-create the sign-off review → human approval closes
the run, and it all survives a reload.

What it deliberately does **not** claim yet: deadlines, notifications and
reassignment, and runs that travel across the org's other business apps. That is the next
phase — and the reason WebMCP is the right foundation for it: every app
that adopts WebMCP exposes its actions as standard tools, so a playbook
step can bind to *another app's* tool the same way it binds to this one's
(`runs: <tool>` is already how steps replay here, and the one-script-tag
attach on plain.html shows the layer traveling to a second app). The
connector problem that makes classic BPM integrations expensive dissolves
into tool bindings. The interview already captures the seed data — owners
("who signs off"), required evidence, criteria — so the operations layer is
an extension of the same playbook format, not a rewrite.

**Trust model (stated, not discovered):** personas are a demo device — one
signed-in reviewer account acts as Kim/Park/Lee, so persona identity is a UI
assertion, not authentication. The server still fail-closes on what it can
know: unknown personas cannot write, approvers must be existing Reviewers
and never the author, runs are updated only by their owner, and run/step
payloads are shape-validated. Production hardening (real per-user sessions,
server-side progress recomputation) is the first item of the operations
roadmap above. UI approval is an interaction safeguard, not an unforgeable
human-presence check: browser automation can click the same controls.

## What's new vs. prior work

The concept distills lessons from earlier internal groupware experiments,
but **all code was written during the submission window** (see commit
history): the WebMCP layer, the process engine, both demo apps, and the
backend. What's genuinely new here is the collaboration shape — recorders
and RPA take turns with the human; Understudy works *with* them, at the same
time, on the same screen, and lets them teach it.
