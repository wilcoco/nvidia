# Understudy — key strengths (canonical list)

The differentiators we must never omit from any intro material (submission,
video, Q&A). Each entry: the claim, the one-liner, and where it is proven.

## 1. The essence: raw log → established process
A worker leaves one as-is sentence ("ran the schema migration on staging").
The agent interviews out what they never think to write down — what to
prepare and prevent **before**, what to verify and sign off **after**, the
warning signs, the pass thresholds, the approver — and the process takes
shape beside their work.
> *Not a record of the event — the process around it.*
Proof: live interview cards → map growing in the panel (demo Scenes 1–2).

## 2. The teaching loop (bidirectional)
The human corrects the map — by clicking the text or by telling the agent in
chat — and the agent reads those edits back (`get_map_edits`); its next
questions and judgments change because of them.
> *Chat carries intent; the page carries evidence and consent.*
Proof: rename a step / restructure by chat, then ask the agent what changed.

## 3. Enforcement — the map is a runtime, not a picture
Not decoration: in the page engine (outside the agent's control), decisions
out of order are refused
(`out_of_sequence` names the live gate and unfinished steps), review requests
and approvals on unfinished runs are refused (`process_incomplete`), pass
choices that contradict measurements are refused (`evidence_conflict`), and
skipping ahead in the UI demands an explicit, recorded confirmation — and
the server independently refuses reviews/approvals of unfinished runs,
non-approver decisions, and edits to approved records.
> *A diagram can't refuse a bad pass decision. This playbook does.*
Evidence: automated regression tests and the documented browser E2E scenarios exercise these refusals.

## 4. Zero-API-key architecture
The page ships tools without requiring a site-owned LLM API key or LLM
backend. The visitor uses their own agent (ChatGPT, Gemini), whose usage
limits and costs still apply.
> *We built the stage and the hands. WebMCP lets every visitor bring their
> own brain.*
Evidence: registered tools were discovered and invoked in the Codex desktop app’s browser. Other clients need separate verification.

## 5. Self-onboarding agents
Tool descriptions are the manual: agents compose correct workflows from
discovery alone (Google's Inspector auto-generated a usable prompt from our
descriptions). The interview is anti-parrot by design — the SDK hands the
agent question *goals*, refuses verbatim template questions, so question
quality scales with the agent, not with our hardcoded strings.

## 6. Playbooks are versioned organizational assets
Immutable revisions under one identity (a new save = same playbook, new
version; lineage tracked via `sourceProcessId`, ancestors never compete with
their successors in suggestions), a per-playbook **data contract** that
renders as real form fields, and applies-when matching that explains every
suggestion (confidence + reasons).

## 7. Works without an agent, too (one honest boundary)
Suggestions, NEXT/SKIPPED guidance, task cards, approvals and every server
gate run page/server-side — in any plain browser. The one thing that
requires an agent is resolving a DECISION branch: that goes through
`resolve_decision` on purpose, through the implementation’s evidence-checking interface.
> *The agent is the door; the page is the house — and the branch points are
> the doors.*

The supported mobile workflow is:
**processes are created and judged with the agent on desktop; assignees'
input, handoffs and reviews also work on a phone's plain browser.** Decision
branches stay agent-lane even on mobile — by design, not omission.

## 8. Explicit review and consent controls
The WebMCP toolset exposes proposals and pending approval cards; confirming
a map or approving an action happens in the page UI. Auto-approve is an
explicit UI option. These are interaction boundaries, not proof of human
identity: browser automation can operate the same controls, and the demo
persona switcher is not production authorization.

## 9. A drop-in layer, not an app
One script tag + `Understudy.init()` gives any web app the journal, the
panel, and 20 WebMCP tools (imperative `registerTool` plus a declarative
form). The second demo page (`plain.html` — no framework, no build step)
proves the layer travels.

## 10. Versus AI diagram generators (Eraser, Whimsical, Miro AI)
They draw the process you can already describe, and the picture is the end.
We capture the process from observed work, and the map is an enforced
runtime.
> *A picture of the process vs. an operating system for the process.*

## 11. Honest scope, seeded roadmap
This build = capture, teach, and a working operations core: per-step owner
roles, role-scoped My-tasks worklists, automatic handoffs across three
personas, and auto-created sign-off reviews. Deliberately roadmap:
deadlines, notifications, reassignment — and cross-app runs, which is where
WebMCP shines next: every adopting app exposes standard tools, so a playbook
step can bind to *another app's* tool the same
way `runs:` binds to this one's — the classic BPM connector problem
dissolves into tool bindings.

## 12. Legible process UI
Overview mini-flowchart (true 2D: branches fan right, loop-backs curve left,
statuses color the nodes, click scrolls to the step) above guided step cards
— structure as a map, execution as directions.
