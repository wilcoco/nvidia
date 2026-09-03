# Understudy — shooting cue sheet (final)

Target edit: 2:55. Record long, cut later. Personas: Kim=Contributor,
Park=Operations, Lee=Reviewer. Playbook: latest migration version.
Before each take: sidebar closed, notifications off, build id visible once.

## The story
Every team runs on processes that exist only in experts' heads. All that
ever gets written down is a work log. Understudy starts from that line:
an agent interviews the expert, builds the process around the event, and
the team runs it — assigned, gated, approved.

Three proofs:
1. Human answers and edits change the actual process map.
2. A newly taught step governs the next run (dryRunPassed gates the retry).
3. Even the agent's own instructions must pass order, evidence and approval.

## Timeline & captions

| Edit time | Beat | Screen | Caption |
|---|---|---|---|
| 0:00–0:12 | Problem | App + work-log screen, no clicks | **Every team runs on processes that exist only in experts' heads.** → *All that's ever written down is a work log.* |
| 0:12–0:25 | Product | Send opening chat; agent intro + panel | **Understudy turns expert know-how into living playbooks.** |
| 0:25–0:44 | Interview | Agent reads log, question cards answered | **The agent reads the work — and asks what's missing.** |
| 0:44–1:04 | Teach | Rename a step; **click "Propose changes" first**; agent adds dry-run task; Save as vN | **Teach it once. Change the actual process.** |
| 1:04–1:20 | Assign | ▶ Run new version; Kim prep → Park snapshot; My tasks fields | **The playbook becomes assigned work.** |
| 1:20–1:40 | Fail | Kim submits 12/false; failure branch; Park's recovery task appears | **Failed checks route the work to recovery.** |
| 1:40–2:06 | Taught step governs | Park restore → Kim root cause → **new dry-run task** → Lee decision → retry | **The newly taught step now governs the retry.** |
| 2:06–2:23 | Pass & review | Kim 0/true; pass branch; auto review with evidence | **Passing checks lead to evidence-based review.** |
| 2:23–2:40 | Approve & survive | Lee approves; run complete summary; ⌘R restore | **Human approval closes the loop.** |
| 2:40–2:50 | Refusals | Separate test run: out-of-order + contradicting evidence | **A diagram can't refuse a bad pass decision. This playbook just did.** |
| 2:50–2:55 | Layer | plain.html flash → logo | **Capture judgment. Share the process. Run it together.** |

## Narration (AI voice, added in edit)
Opening (0:00–0:25):
> Every team has processes that live only in one veteran's head — when to
> stop, how to recover, who must approve. All that ever gets written down is
> a one-line work log. Understudy starts from that line: through WebMCP, an
> agent learns from people, updates a shared playbook, and helps the team
> carry it through to completion — no API keys: the page ships the tools,
> and every visitor brings their own agent.

Closing (2:40–2:55):
> The agent cannot simply declare success — order, evidence and human
> approval gate every run. The agent is the door; the page is the house:
> capture happens at the desk with your agent, but the work travels — task
> cards, approvals and every gate run in any plain browser, on any device,
> no agent required. It starts from an ordinary work log — and ends as the
> team's operating process.

## Chat prompts (English, verbatim)

**Opening:**
> Show me how Understudy turns a work log into a process our team can run.
> First, briefly explain what this app does. Then use WebMCP to inspect my
> migration work log and the relevant playbook. Ask about missing judgment
> rules using question cards on the page. Keep everything in English, and
> leave changes for me to review before saving.

**After my manual edit (click "Propose changes (new draft)" FIRST):**
> Read my edit with get_map_edits. Add a separate task for Kim to correct
> the backfill filter and verify a dry run before Lee decides whether schema
> redesign is needed. Give the new task a required boolean field
> dryRunPassed, and make the retry edge require dryRunPassed equal to true.
> Preserve the existing owners, inputs, recovery path, and health checks.
> Leave the revised map for me to review.

**Run (after Save as vN):**
> Run the version we just saved — confirm with list_saved_processes that you
> loaded the highest version before starting. Use list_my_tasks and
> get_process_progress to guide the role handoffs. Tell me the next persona
> and required inputs, then wait for submission. Resolve decisions from the
> recorded evidence. Leave final approval to the human reviewer.

**After failing values:**
> Evaluate the migration using the submitted measurements: rowCountDelta is
> 12 and verificationQueriesPassed is false.

**After recovery + dry run, as Lee:**
> The corrected-filter dry run passed, and no schema redesign is needed.
> Record that decision using the evidence and route the retry.

**After retry values:**
> Evaluate the new measurements: rowCountDelta is 0 and
> verificationQueriesPassed is true. Check whether the review was created
> automatically.

**Refusal test (separate run, AFTER the main run is fully complete):**
> In this separate test run, try resolving migration health before its
> prerequisites are complete. Show the actual refusal. Do not bypass the gate.
Then, with failing values submitted:
> Attempt the pass branch with rowCountDelta 12 and verificationQueriesPassed
> false. Show the engine's actual response. Do not change the evidence or
> criteria.

## Takes
- **T1** intro → interview → manual edit → Propose changes → agent adds
  dry-run step → Save as vN
- **T2** the full relay (fail → recover → dry run → Lee → retry → review →
  approve → reload) — one take, Demo mode ON
- **T3** refusal test (separate run, labeled as such)
- **T4** plain.html + tool list + mini flowchart close-up

## Rules
- Don't say "no playbooks exist" (library has 13) — the story is refining
  existing knowledge and governing the next run.
- The run must use the version saved on camera, not a fixed v6.
- Demo data only — never claim a real database changed.
- Don't start another run while a review is pending (a confirm dialog will
  warn; during filming, avoid it entirely).
- Captions claiming success/restore only over frames that show it.
- Sidebar, account info, notifications out of frame.
