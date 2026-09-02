# Understudy — 3-minute demo script

**Environment**: ChatGPT's in-app browser (desktop app agent), signed in as `judge`.
Before recording press **Start fresh demo** (playbooks are kept).
Screen layout: demo app left, Understudy panel right, ChatGPT visible.

**The one thing this video must prove** (this is the winning scene, not the
compliance features): *the human corrects the agent's understanding of the
process, and the agent's behavior changes because of it.*

---

## 0:00–0:15 — Cold open: the problem

> "In a paint shop, the response to a defect lives in one veteran's head.
> When they're off shift, steps get skipped — and skipped steps stop lines.
> This is Understudy: a drop-in layer that lets an AI agent learn how your
> experts actually work — on the same page, through WebMCP. Not to log the
> event — to capture the process around it: what to prepare and prevent
> before, what to verify and sign off after."

*Screen: the demo workspace open, Understudy panel on the right, ChatGPT alongside.
Briefly hover the "WebMCP connected" dot and ChatGPT's Site tools list (19
tools).*

## 0:15–0:45 — Scene 1: The expert just works; the agent watches and maps

*Type to ChatGPT:* **"Watch how I handle this incident and turn it into a playbook."**

*As Kim: log an orange-peel incident — type `orange peel`, check "right after
a color change", viscosity 18.5, booth 23°C, urgent. Save. Send to Lee.
Switch persona to Lee, approve.*

> "Kim just handles the defect the way he always does. Every action lands in
> a journal the agent can read — no screenshots, no guessing at pixels.
> Watch the right side."

*Agent calls get_recent_actions → propose_process_map. The map appears
beside the work.*

> "The agent turned ten minutes of real work into a five-step response
> playbook — decision branch, approval line and all."

## 0:45–1:30 — Scene 2 ★ THE CENTERPIECE: the human teaches the agent

> "But the agent's draft is a guess. The expertise belongs to the human —
> so the map is editable, live."

*Kim clicks the branch condition and tightens it. Click the step note and
type the judgment rule:*
**"Lower viscosity to 17s only when it reads above 18 after a color change."**

*Agent (having called get_map_edits) reacts — its follow-up question changes.
It asks something like "Should the playbook treat readings under 18 as
no-adjustment-needed?" and writes the confirmed rule into the step via
update_step. Show the note appearing on the step card.*

> "The agent reads the correction — the human's edit outranks its inference —
> and its next question changes. The rule Kim just explained is now written
> into the playbook itself. This is the part that wasn't possible before
> WebMCP: the human works, the agent learns the organization's judgment,
> on the same screen, in real time."

*Press **Confirm & save to library**. Show "saved v1 to the shared library".*

## 1:30–2:00 — Scene 3: The knowledge finds the next worker

*Start fresh-ish: switch persona to Kim, start typing a new incident —
`orange peel` + color change + urgent.*

> "A week later, a different worker hits the same defect. They don't search
> for a manual — the moment the conditions match, the playbook finds them."

*The suggestion card appears: 92% match, with reasons. Click **Follow this
playbook**. Save the incident log — step 1 checks itself off.*

> "Ninety-two percent match, and it says why. The worker's own form entry
> just completed step one — human work and agent work advance the same run."

## 2:00–2:40 — Scene 4: Skip a step — and get caught before it matters

*Skip the lead review. Ask ChatGPT to give final approval.*

> "Now watch what happens when the final sign-off is attempted while the
> corrective action was never logged."

*Show the tool result: **"Process violation prevented: … earlier required
steps are not done."** The agent explains and offers run-bound options; the
skipped step is red in the panel.*

*Click the agent's fix option → approval card shows the exact params →
Approve → the red step turns green; corrective action attaches to the SAME
incident. Then final approval card → Approve → "✓ Playbook run complete".*

> "The layer refused to let the agent jump the process — before anything ran.
> The agent proposes the fix, the human decides, one click repairs the run.
> Coach, not enforcer."

## 2:40–3:00 — Scene 5: This is a layer, not an app

*Quick cuts: Playbooks tab (run history strip, version badges) →
plain.html with its one script tag (view-source flash) → the tools list.*

> "The paint-shop app is just a demo workspace. Understudy itself is one script tag —
> nineteen WebMCP tools, an action journal, and a live process panel that any
> web app can adopt. Your team already knows how the work is done.
> Understudy is how the agent learns it. You did it once — the agent can
> do it forever, and it asks before it acts."

---

### Recording notes
- Narrate in English, unhurried; the centerpiece (Scene 2) may take the most
  screen time — protect it.
- Keep ChatGPT's tool-call chips visible when it calls get_map_edits /
  update_step — that's the WebMCP evidence.
- No copyrighted music. Total under 3:00.
