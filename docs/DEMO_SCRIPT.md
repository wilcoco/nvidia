# Understudy — 3-minute demo script (v2, operations cut)

**Environment**: ChatGPT's in-app browser (desktop app, ⌘⇧B), signed in as `judge`.
Before recording: **Start fresh demo** (playbooks kept), fresh ChatGPT conversation,
English prompts only, **Demo mode ON** for Scene 3.
Screen layout: demo app left, Understudy panel right, ChatGPT chat visible.

**The two things this video must prove**
1. *The human corrects the agent's understanding, and the agent's behavior
   changes because of it* (teach).
2. *The playbook then runs real work across real people — assigned, gated,
   evidenced, signed off* (operate).

---

## 0:00–0:15 — Cold open

> "In every team, how the work is really done lives in one veteran's head.
> When they're away, steps get skipped — and skipped steps become incidents.
> This is Understudy: a WebMCP layer that lets the agent you already use
> learn how your experts work — and then run that knowledge as a process."

*Screen: workspace + panel + chat, empty state visible ("the agent drafts the
process around each event").*

## 0:15–0:50 — Scene 1: Capture (raw log → living map)

*Kim saves a one-line work log: "Ran the customer-table schema migration on
the staging copy…". Send the invite, then the interview prompt.*

> "One raw sentence. The agent reads the journal, drafts the process around
> the event — and interviews me for what I'd never write down: what to
> prepare before, the warning signs, the pass thresholds, who signs off."

*Show: question card answered on the page → map grows → criteria chip
appears → Captures line (data contract).*

## 0:50–1:20 — Scene 2 ★ Teach (the human corrects the agent)

*Click-rename a step on the panel. Then in chat: restructure the failure
path (remediation branch). Show the amber "unsaved draft" pill → Save as vN.*

> "The map is mine to correct — by click, or by telling the agent. It reads
> my edits back, and its questions and judgments change. Every save is an
> immutable version of the team's knowledge."

*Optional flash: "Compare with v(N-1)" diff card.*

## 1:20–2:20 — Scene 3 ★★ Operate (the playbook runs real work)

*Demo mode ON — the role relay strip appears. New entry → suggestion card
(90%, reasons) → ▶ Run this playbook → run-start popup.*

> "Now the playbook operates. Each step belongs to a role — the relay shows
> whose turn it is."

*Fast relay, following the strip's cues:*
- Kim completes prep → **switch to Park (Operations)**: snapshot card asks
  only for `snapshotId` — required, submit locked until filled.
- **Kim**: migration card — enter `rowCountDelta 12`, verification false.
- Agent resolves the health decision: **refused for the pass branch,
  rerouted to remediation** (worklog shows the amber "Verification failed —
  rerouted" note).
- **Park** restores (must confirm "restore verified" — a required
  confirmation), **Kim** diagnoses, **Lee** decides "no redesign" → the
  migration step **reopens**; the old decision is marked *superseded by
  retry* on the timeline.
- Retry with `rowCountDelta 0`, verification true → passes → **the pending
  review appears in Lee's inbox automatically**.
- **Lee approves** → 🏁 run-complete summary: who did what, the values, the
  decisions, the sign-off.
- **⌘R** — everything comes back: same run, same roles, same history.

> "Assigned by role, gated by evidence, recovered through the failure path,
> signed off by a human — and it survives a reload."

## 2:20–2:40 — Scene 4: The map is a runtime

*Quick montage of refusals (pre-recorded moments are fine):*
- checking a later step → red skip-confirm strip
- resolving a decision early → `out_of_sequence` naming the live gate
- approving an unfinished run → `process_incomplete`
- editing an approved record → `approved_immutable`

> "AI diagram tools draw the process you can already describe — and a
> diagram can't refuse a bad pass decision. This playbook was captured from
> real work, and it just did."

## 2:40–3:00 — Scene 5: A layer, not an app

*Cuts: plain.html one script tag (view-source flash) → the 20-tool list →
mini flowchart close-up.*

> "The work-log app is just a demo workspace. Understudy itself is one
> script tag — twenty WebMCP tools, an action journal, a live process panel.
> No API keys: the page ships the stage and the hands, and every visitor
> brings their own brain. Capture the knowledge once — then it assigns,
> gates, and signs off the real work, forever."

---

### Recording notes
- Record long takes per scene (⌘⇧5, selected area); dead air is cut in edit.
- Personas: Kim=Contributor, Park=Operations, Lee=Reviewer (switcher top-left).
- Playbook: "Customer-table staging migration with remediation" latest version.
- Keep the build id visible once (header) for authenticity.
- One DevTools/Site-tools flash showing the tools list is worth 3 seconds.
