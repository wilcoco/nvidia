# Understudy — Shooting Cuesheet
## Recording cut: 2:55 · English on-screen chat, cards, captions, and narration

Updated: 2026-09-03
Intended repository path: docs/SHOOTING_CUESHEET.md
References: docs/KEY_STRENGTHS.md (12 differentiators), docs/DEMO_SCRIPT.md.
This file is the revised shooting plan; it does not certify that every shot has been recorded or passed.

## 1. Story and production rules

**Understudy turns everyday work into processes a team can actually run.**
The product is process creation and execution; everyday work is the starting point.
The agent observes work context, asks the expert for missing judgment, and helps the
human build or improve an executable playbook through WebMCP. The team then works
through assigned tasks, evidence gates, recovery, and human approval.
A work log is one input mechanism used in this demo, not the product category or
a requirement that every workflow must begin with logging. The staging migration
is the example; the reusable process is the outcome.

Narrative hierarchy: everyday work → expert judgment → shared process asset →
team execution. Do not introduce Understudy as a work-log app, or imply that
turning text into a diagram is the final outcome.

The three essential proofs:
1. A human correction causes an actual map change.
2. The newly taught dry-run requirement appears in the next run and gates retry.
3. The engine refuses a pass decision that contradicts the evidence.

Behind-the-scenes coaching may be Korean. Recorded prompts, agent responses, question
cards, narration, and captions are English. An agent response need not match a
script word for word; a different accurate response is not a failed take.

Record long takes. Edit pauses to fit 2:55; do not attempt to perform the whole workflow
live in that time. Keep 2–3 seconds of handles around important results. Speed-ups
and cuts must not hide a failed gate, substitute another run's evidence, or invent success.

Use synthetic demo values. This video demonstrates assignment, recorded results,
decision gates, and approvals—not a real database migration performed by Understudy.

## 2. Preflight — off camera

- Check the live build ID and record it in the take notes. aa86a35 was observed earlier;
  recheck before recording rather than assuming it is still current.
- Check the current worklog/run counts. The reported overnight cleanup was a starting
  state, not a guarantee: subsequent rehearsal work may have added records.
- Do not reset, delete history, or duplicate a work log automatically.
- Preserve the existing unsaved draft before changing the filming baseline.
- The migration library already contains a playbook. Do not say “no playbook covers this”
  unless an actual new matching check supports that statement.
- Verify the expected map, owners, inputs, and action bindings. The recording must
  start from a known baseline and execute the exact revised version saved in T1.
- Canonical new key: dryRunPassed. If a rehearsal used backfillDryRunPassed, migrate
  the draft's field definition, step fields, and branch criteria together. Do not
  leave both keys or rewrite historical run evidence.
- Preserve existing constraints, especially restoreResult's true-confirmation
  requirement, original health criteria, approval bindings, and role assignments.
- Keep auto-approve off for the consent story. Human saves and final approval are
  visibly performed by the human operator.
- Hide private chat titles, account details, notifications, and unrelated tabs.
- Identify the actual browser/app truthfully. Do not label Codex footage “ChatGPT.”
  Separately verify the live URL in a judging-supported environment.
- The human starts/stops the Mac recording. The agent does not claim to have started
  the recorder or verified an OS recording indicator it cannot inspect.

## 3. Master edit timeline — exactly 175 seconds

| Time | Story / screen action | Main English caption |
| --- | --- | --- |
| 00:00–00:12 | Product title and everyday-work context. Establish that expert judgment needs to become a shared process; do not open on a work-log product pitch. | The process lives in experts' heads. → Make it something the whole team can run. |
| 00:12–00:25 | Introduce process creation and execution, then the bring-your-own-agent architecture. Keep the app and WebMCP panel visible. | Everyday work → executable team processes. / No site-side LLM API key. |
| 00:25–00:44 | Use the migration entry as one source of work context. Agent reads the tool interface, finds the relevant playbook, and asks a domain-specific question. Human answers. Open a draft before any map write. | Tool descriptions guide the agent. Domain questions, not copied templates. |
| 00:44–01:04 | Human edits a step; agent reads it back, inserts the dry-run task, encodes the retry gate, and leaves the draft for human review and save. | Teach it once. Change the actual process. |
| 01:04–01:20 | Verify and run the saved version. Kim completes preparation; Park supplies snapshotId. Show role-scoped My tasks and required inputs. Include a human-only UI interval with no agent call. | The agent is the door; the page is the house. / Page-side guidance and gates keep working. |
| 01:20–01:40 | Kim submits 12 / false. Agent takes the failure branch. Operations receives the restoration task. | Failed checks route the work to recovery. |
| 01:40–02:06 | Park restores; Kim diagnoses, corrects the filter, and records the new dry-run result. Lee decides whether redesign is needed; the gated retry becomes available. | The newly taught step now governs the retry. |
| 02:06–02:23 | Kim submits retry measurements 0 / true. Agent evaluates them. Show the automatically created run-linked review. | Passing checks lead to evidence-based review. |
| 02:23–02:40 | Lee checks evidence and approves. Show Completed, run identity, and history; refresh and verify the same completed run. | Human approval closes the loop. |
| 02:40–02:50 | Separate test-run montage: sequence refusal and, at the correct decision point, a pass attempt with failing evidence. The punchline must sit over the evidence-conflict refusal. | A diagram can't refuse a bad pass decision. This playbook just did. |
| 02:50–02:55 | Briefly show the purchase-request page with the same layer, then close on the team's process. | Everyday work → the team's operating process. |

The final five seconds return to the opening mission: everyday work becomes the
team's operating process. The door/house metaphor and agent-independent page
behavior move to 01:04; description-driven onboarding remains at 00:25.
Do not squeeze those explanations into the ending.

## 4. English narration — editorial target, not recorded audio

### 00:00–00:12
Everyday work depends on judgment: when to stop, how to recover, who must approve.
Too often, that process lives only in an expert's head.

### 00:12–00:25
Understudy turns everyday work into executable team processes. Through WebMCP,
the page provides the tools and visitors bring their own agent—no site-side LLM API key.

### 00:25–00:44
Here, a migration entry provides the context. Tool descriptions guide the agent.
It asks a domain-specific question, not a copied template. I explain the missing
rule: correct the filter and verify a dry run before retrying.

### 00:44–01:04
I can edit the map directly or teach it in chat. The agent reads my correction
and adds a required dry-run check. That condition becomes a runtime gate,
and I save the revised playbook as a new version.

### 01:04–01:20
The saved process assigns work to Kim and Park. Suggestions, inputs, and gates keep
working in the page and server. The agent is the door; the page is the house.

### 01:20–01:40
The first check fails: a row-count delta of twelve, and verification queries do not
pass. The agent resolves the decision from those measurements. The process routes
recovery to Operations instead of advancing to sign-off.

### 01:40–02:06
Park restores staging. Kim records the cause and completes the filter correction
and dry-run check we just added. Lee reviews whether schema redesign is needed.
The retry edge requires a passing dry run and a no-redesign decision.
The lesson has become executable work.

### 02:06–02:23
The retry reports zero row-count difference and passing verification. The agent
takes the pass branch. A review appears automatically for Lee, linked to this run
and its evidence.

### 02:23–02:40
Lee checks the evidence and approves. The run completes with its history, owners,
and submitted values. After a refresh, we verify the same run is still there.

### 02:40–02:50
The agent cannot simply declare success. A diagram can't refuse a bad pass decision.
This playbook just did.

### 02:50–02:55
It starts with everyday work—and becomes the team's operating process.

Read naturally and measure the actual voice recording before locking the edit.
The time windows are production targets, not a claim that audio has been generated
or synchronized. Use success narration only where the corresponding recorded
screen result proves it.

## 5. T1 — introduce, capture, teach, save

### Operator sequence

1. Start recording; establish the product and everyday-work context first.
   Introduce the migration entry only as the demo's source of context.
2. Save one synthetic migration work log if the take requires a new entry.
   Do not confuse the initial log with the separate future run's results.
3. Send the opening prompt below.
4. Agent discovers the interface, reads the journal, and identifies the matching playbook.
5. Load that playbook.
6. Human clicks **Propose changes (new draft)**.
7. Verify the draft indicator before proposing or updating steps. A loaded confirmed
   map is read-only; do not repeatedly retry a rejected write.
8. Agent asks a domain-specific question through ask_user; human answers on the page.
   Agent polls get_question_result and reads the actual answer.
9. Human directly renames a step, for example “Diagnose root cause” to
   “Diagnose root cause and record evidence.”
10. Send the modification prompt.
11. Agent reads get_map_edits, updates the actual draft, and shows the new task and gate.
12. Human reviews the result and clicks Save as vN. Record the returned version and ID.

Optional pickup: show one confirmed_readonly refusal, then the human opens a draft.
This is not required in the main edit and does not replace the failed-evidence shot.

### Opening prompt — high-level intent, not an app manual

> Show me how Understudy turns everyday work into a process our team can run.
> First, briefly explain what this app does. Then use WebMCP to inspect my
> migration work log and find the relevant playbook. Ask about missing judgment
> rules using question cards on the page. Keep everything in English.
> If the loaded map is confirmed, wait for me to open a new draft before changing it.
> Leave changes for me to review before saving.

The agent can start with describe_workspace and discover the remaining workflow
from the available descriptions. A fresh agent session is required if the video
claims a genuinely fresh, description-only onboarding test. This existing
conversation has prior app context; it does not prove that stronger claim.

### Interview answer — sample expert rule for this demonstration

> Kim corrects the filter and checks a dry run against the expected customer rows.
> Lee confirms the schema itself is unchanged before permitting a retry.

This is human input, not an answer the agent supplies for the human. Other actual
answers must be honored rather than silently replaced to match the shooting plan.

### Modification prompt — after Propose changes

> Read my edit with get_map_edits. Add a separate task for Kim to correct the
> backfill filter and verify a dry run before Lee decides whether schema redesign
> is needed. Preserve the existing owners, inputs, action bindings, recovery path,
> and health checks.
>
> Give the new task a required boolean field named dryRunPassed, scoped to that task.
> Make the retry edge require dryRunPassed equal to true and schemaRedesignNeeded
> equal to false using machine-checkable criteria, not just a text label.
> Ensure schemaRedesignNeeded is represented as a boolean decision measurement
> supplied by Lee. Use the same field keys everywhere; if the draft has the earlier
> name backfillDryRunPassed, replace its definition and references without changing
> historical run evidence.
>
> Use update_step for owners, step-scoped inputs, and branch criteria. If adding a
> node requires propose_process_map, preserve and reapply all existing step metadata
> and field constraints. Leave the revised draft for me to review before saving.

### Expected contract and topology

- New task: Contributor / Kim, before the redesign decision.
- Task input: dryRunPassed, boolean, required, scoped to the new task.
- Unanswered must not be silently treated as a passing result.
- A false dry-run result must never enable the retry edge.
- Reviewer / Lee supplies the redesign judgment.
- The no-redesign retry edge has both criteria below:
  - dryRunPassed: eq true
  - schemaRedesignNeeded: eq false
- The yes-redesign edge retains escalation to Lee for re-planning.
- Existing health success remains rowCountDelta eq 0 AND verificationQueriesPassed eq true.
- Failure remains restoration → diagnosis → new corrective/dry-run task → redesign decision.
- Every outgoing edge has a meaningful condition.
- A changed label alone is not proof of enforcement.

## 6. T2 — execute the exact saved version

Human enables Demo mode and sends:

> Run the version we just saved. Before starting, use list_saved_processes to identify
> the highest saved version of this migration playbook. Load that exact process ID
> and verify its version, owners, fields, and retry criteria.
> If the highest version is not the version we just saved, stop and explain the
> mismatch rather than running a different draft.
>
> Use list_my_tasks and get_process_progress to guide the role handoffs. Tell me the
> next persona and required inputs, then wait for each submission. Resolve decisions
> from the recorded evidence. Check for the automatically created review rather
> than requesting a duplicate. Leave final approval to the human reviewer.

| Turn | Human operation | Agent / evidence cue |
| --- | --- | --- |
| Kim | Confirm scope and rollback readiness for the demo. | Read current ready task; do not skip prerequisites. |
| Park | Submit a synthetic snapshotId, e.g. DEMO-SNAPSHOT-T2. | Show that only snapshot inputs appear; missing required input blocks submission. |
| Kim | Submit migrationVersion and affectedRows if used; rowCountDelta 12 and verificationQueriesPassed false. | Resolve the failure branch from recorded measurements; show Operations assignment. |
| Park | Complete the demo restoration and explicitly confirm restoreResult true. | Check the restoration prerequisite before diagnosis. |
| Kim | Record rootCause: “Bad backfill filter included unintended customer rows.” | Show the next task is the newly added corrective/dry-run task. |
| Kim | Record the demo filter correction and dryRunPassed true after the stipulated check. | Use the actual submitted result, not an assumed true. |
| Lee | Confirm schemaRedesignNeeded false for this sample case. | Resolve retry using both Lee's decision and the dry-run evidence. |
| Kim | Repeat migration/result submission with rowCountDelta 0 and verificationQueriesPassed true. | Resolve health to pass; verify automatic review creation and linked run evidence. |
| Lee | Inspect run identity, first failure, recovery, retry values, and review evidence; click Approve. | Verify Completed; record run identity. |
| Human | Refresh the page; wait for restoration. | Verify the same run, status, roles, and history. Do not substitute a new run. |

Health failure prompt:
> Evaluate the submitted measurements: rowCountDelta is 12 and verificationQueriesPassed is false.

Redesign prompt, while acting as Lee and after the new task:
> The corrected-filter dry run passed, and no schema redesign is needed.
> Record that decision using the submitted evidence and route the retry.

Health retry prompt:
> Evaluate the new measurements: rowCountDelta is 0 and verificationQueriesPassed is true.
> Check whether the review was created automatically.

No-agent demonstration within this take: leave the agent idle while the human uses
My tasks, switches to the task's owner, encounters the required-input gate, and submits.
This supports autonomous page/server behavior; it does not claim that human controls
can replace every AI interview or decision tool.

## 7. T3 — separate refusal tests, only AFTER T2 completes

Do not start another run while T2 awaits approval. Finish approval, completion,
and refresh verification first. Mark every safety pickup “Separate test run.”

### Sequence gate

Start a new test run but do not complete prerequisites.

> This is a separate test run. Try resolving migration health before its prerequisites
> are complete. Show the actual refusal and the unfinished prerequisite it names.
> Do not bypass the gate.

Capture the actual out_of_sequence response if that is the returned result.

### Evidence gate

Advance a test run normally to the health decision as the correct role, submitting
rowCountDelta 12 and verificationQueriesPassed false first.

> Attempt the pass branch using the submitted rowCountDelta 12 and
> verificationQueriesPassed false. Show the engine's actual response.
> Do not change the evidence or criteria.

Capture the actual evidence_conflict refusal. Put the diagram/playbook punchline
over this result—not merely over a sequence error or an assistant's own refusal.

### New dry-run gate — required rehearsal evidence

In an appropriately prepared test run, reach the redesign decision after a recorded
dryRunPassed false, with Lee supplying schemaRedesignNeeded false. Attempt retry;
verify it is refused. A separate properly prepared passing case must allow retry.
Do not replace a recorded false with true just to produce the desired shot.

Do not use force, mark prerequisites not applicable, weaken criteria, or manipulate
stored state. A missing-input test and a false-input test are distinct checks.
If an expected guard fails, retain the evidence and remove the unsupported success
claim from the edit until the product is fixed and retested.

## 8. T4 — the layer travels; short close

Open /plain.html. It is a different purchase-request app with Understudy already
attached, not a “without Understudy” baseline. Show its normal form and the shared
panel/connection. Do not submit a purchase request merely for this pickup.

Finish with:
> It starts with everyday work—and becomes the team's operating process.

No new long explanation here: zero-site-key architecture appears at 00:12;
description-based onboarding and contextual questions at 00:25; autonomous
page/server behavior and the door/house metaphor at 01:04.

## 9. Twelve-strength coverage map

Coverage in a script is not the same as a verified product test.

| # | Strength | Where it appears | Proof / wording boundary |
| --- | --- | --- | --- |
| 1 | Tacit-knowledge capture | 00:25–00:44 | Actual domain question, human answer, and changed map. An existing playbook is acknowledged. |
| 2 | Bidirectional teaching loop | 00:44–01:04 and 01:40–02:06 | Human edit → get_map_edits → actual new task → that task runs. |
| 3 | Enforcement | 02:40–02:50; dry-run rehearsal | Real engine refusal at the relevant gate, not a warning invented by the agent. |
| 4 | Zero-API-key architecture | 00:12–00:25 | “No site-side LLM API key.” This does not mean the visiting agent is free, accountless, or unlimited. |
| 5 | Self-onboarding / anti-parrot | 00:25–00:44 | Descriptions explain tool use; the question is domain-specific. Do not claim every agent or this context-rich session learned from descriptions alone. |
| 6 | Versioned organizational asset | 00:44–01:04 and T2 start | Actual save, version/ID verification, matching run version. |
| 7 | Works without active agent participation | 01:04–01:20, including the door/house metaphor | Human uses page-side tasks, guidance, inputs, and gates without an agent call. Not universal parity for every AI feature. |
| 8 | Human decision and consent | T1 draft/save and 02:23–02:40 | Human opens the draft, answers, reviews, saves, and approves. Do not claim all computer agents are technically incapable of clicking UI. |
| 9 | Drop-in layer | 02:50–02:55 | Second unrelated app has the same layer. This is not a cross-app execution demonstration. |
| 10 | Beyond diagram generation | 02:40–02:50 | “A diagram can't refuse a bad pass decision. This playbook just did.” Use over an actual contradictory-pass refusal. |
| 11 | Honest scope | Take labels and submission notes | Demo measurements; no claimed DB execution. Deadlines, push notifications, reassignment, and cross-app runs remain roadmap unless separately implemented and verified. |
| 12 | Legible map UI | 00:44–01:04; failure/retry shots | Show the mini-flowchart and readable cards, branches, owner chips, and active state. |

## 10. Deliverables, continuity, and completion checklist

Save raw takes as T1, T2, T3, T4 with retake suffixes as needed. Record:
build ID; base and saved playbook IDs/versions; run IDs; worklog IDs; review IDs;
actual gate errors; and timestamps of the best visible evidence.

- [ ] Process creation is the product; everyday work is the starting point; the work log is only this demo's input.
- [ ] Title/problem understood before workflow operation.
- [ ] All on-screen dialogue and question cards are English.
- [ ] Propose changes precedes all writes to a loaded confirmed map.
- [ ] Human edit is read back and preserved.
- [ ] dryRunPassed is required, scoped, consistently named, and machine-checked.
- [ ] False dry-run retry is actually refused in rehearsal.
- [ ] Exact newest saved migration version is the one executed.
- [ ] Failure, recovery, and the newly taught task belong to the same principal run.
- [ ] Review was automatically created, is run-linked, and contains the right evidence.
- [ ] Human approval completes the run; refresh restores that run.
- [ ] Safety shots start only after the principal run completes.
- [ ] No-site-key, description-guided onboarding, and page-side operation are stated precisely.
- [ ] The diagram punchline overlays a real evidence-conflict refusal.
- [ ] No private information, fabricated results, or unsupported claims appear.
- [ ] Voice timing is measured against the footage; final export is under three minutes.

Current official rules require a sub-three-minute demonstration with audio, English
materials or English translations, and a public YouTube video link. They permit
judging access through ChatGPT's in-app browser or WebMCP-enabled Chrome. They also
restrict unpermitted third-party material; do not infer blanket trademark permission
from sponsorship. Check the current rules before submission:
[WebMCP Challenge official rules](https://webmcp.devpost.com/rules).

No recording, editing-service connection, voice generation, YouTube upload, or
submission is implied by saving this document.
