# Devpost "Project story" — paste-ready (Markdown)

Copy everything below the line into the Devpost story field.

---

## Inspiration

Every team runs on processes that exist only in experts' heads — when to
stop, what to check first, how to recover, who must sign off. All that ever
gets written down is a one-line work log: *"ran the schema migration on
staging."* When the veteran is away, steps get skipped, and skipped steps
become incidents.

We had tried the usual answer — put an LLM inside the app and ask it
questions. WebMCP inverts that: **the page ships the tools, and every
visitor brings their own agent.** That inversion made a new collaboration
shape possible for the first time: an agent that doesn't operate the page
*for* you, but is **apprenticed to you** — it watches you work, asks what's
missing, and turns your judgment into something the whole team can run.
That's why it's called Understudy.

## What it does

Understudy is a WebMCP layer that turns a web work-app into an
agent-observable workspace. One SDK script supplies observation, the process
panel and tools; registered actions and a store/enforcement adapter close the
full operational loop:

- **Capture.** You save an ordinary work log. The agent reads the action
  journal, drafts the process *around* the event, and interviews you with
  question cards on the page: what must be prepared before, the early
  warning signs, the machine-checkable pass thresholds, who approves.
- **Teach.** The map is yours to correct — click a step to rename it, or
  tell the agent in chat to restructure a branch. It reads your edits back
  (`get_map_edits`) and its next questions and judgments change. Every save
  is an immutable version of the team's knowledge.
- **Operate.** The playbook runs as real work: each step belongs to a role
  (Contributor / Operations / Reviewer), the assignee's **My tasks** card
  shows exactly the inputs that step must capture, failure branches
  re-assign recovery work automatically, reaching sign-off creates the
  pending review by itself, and a human approval closes the run — with the
  whole state surviving a page reload.
- **Enforce.** The map is a runtime, not a picture. Out-of-order decisions
  are refused (`out_of_sequence`), pass choices that contradict the
  assignee's submitted measurements are refused (`evidence_conflict`), the
  server independently refuses reviews of unfinished runs
  (`process_incomplete`) and edits to approved records
  (`approved_immutable`). Even the agent's own instructions must pass.

No site-owned LLM API key is required: the page registers 20 tools via
`document.modelContext.registerTool()`, and the brain is whatever agent the
visitor already uses.

## How we built it

- **Understudy SDK** (TypeScript → one bundled `understudy.js`): an action
  journal, a shadow-DOM process panel (mini flowchart + step cards), and a
  process engine — branch footprints, loop-back retries that reopen the loop
  body and invalidate stale decisions, role/order/evidence gates, and an
  interview engine that hands the agent question *goals* and rejects
  verbatim template questions (anti-parrot by design).
- **Async by contract**: agent runtimes time out tool calls, so `ask_user`
  and gated `run_action` return pending ids the agent polls — consent
  is requested through on-page confirmation controls. Server role and
  evidence gates separately protect review operations; a UI click is not
  cryptographic proof of human identity.
- **Two host apps** show the integration tiers: a React work-log workspace
  with actions, persistence and enforcement, and a deliberately plain,
  framework-free `plain.html` showing the one-script observation/tool tier.
- **Server** (Express + Postgres on Railway): auth, worklogs, reviews, a
  versioned playbook library with lineage, persistent runs, and a reusable
  transition guard that rechecks actor role, order, branch evidence and
  server-owned approvals inside the storage transaction.

```js
document.modelContext.registerTool({
  name: "resolve_decision",
  description: "Record which branch was taken — measurements are verified
    against the edge's criteria; violations are refused.",
  inputSchema: { /* stepId, branchTo, reason, measurements */ },
  execute: async (input) => engine.resolveDecision(input),
})
```

## Challenges we ran into

- **Agent runtimes hang up.** Tool calls that wait for a human die at ~20s.
  We redesigned every human interaction as a pending-id + polling pair.
- **An agent will cheerfully lie for you.** Early on, an agent could claim
  `rowCountDelta: 0` while the assignee had submitted `12`. Now the
  submitted step values are the record; contradicting claims are refused
  with both numbers named.
- **Retries are where process engines go to die.** Loop-backs (both
  decision-edges and task-edges) had to reopen the loop body, clear
  attribution, invalidate superseded decisions, and re-arm the gates — we
  found and fixed several ways a stale success could survive a retry.
- **Native dialogs freeze agent browsers.** A single `window.confirm`
  hung automated sessions; every confirmation became a two-click pattern.
- **We were our own harshest judges**: we ran repeated adversarial AI
  audits (mock judging panels attacking order, evidence, roles, persistence,
  concurrency, even crash-inputs) and fixed what they found. The R3 audit
  verified four earlier P1 fixes and six completed runs on the live build.
  Recovery from lost responses and several safety variants were tested
  locally; they were not production fault-injection experiments.

## Accomplishments that we're proud of

- A **full multi-role relay on a live deployment**: Kim logs and migrates,
  Park snapshots and restores, Lee decides and signs off — assigned, gated,
  evidenced, approved, and intact after a reload.
- A playbook that **refused a bad pass decision** with the assignee's real
  numbers in the refusal message. A diagram can't do that.
- **Self-onboarding**: agents compose correct workflows from tool
  descriptions alone — Google's Inspector generated a usable prompt for our
  app without any instruction from us.
- The host needs no site-owned LLM API key for these WebMCP interactions. The
  visitor's agent still has its own account, limits and cost. A second app
  demonstrates the one-script observation/tool tier.

## What we learned

- WebMCP's real gift isn't remote control — it's **structured eyes**.
  Once a page can be *watched* safely, "agent as apprentice" becomes
  possible, and that's a bigger idea than "agent as operator."
- Chat carries intent; **the page must carry evidence and consent.**
  Anything that matters to the next person has to land in page/server
  state, not in a private conversation.
- Trust is an architecture, not a promise: submitted values as the record,
  server-revalidated run transitions, review roles and evidence gates,
  immutable versions, and honest scope statements. Personas are a demo
  device: normal accounts are session-bound, while the disclosed `judge`
  account alone may switch demo roles. Process design and
  branch decisions use a desktop WebMCP agent; small-screen testing covered
  assigned inputs and reviews at 375px, not physical-device or mobile-agent
  compatibility.

## What's next for Understudy

- **Cross-app runs** — WebMCP can standardize the tool surface a playbook binds
  to. Production identity, reliability and data mapping still need adapters;
  the goal is to reduce custom connector surface, not claim it disappears.
- **Operations depth**: deadlines, notifications, reassignment, per-attempt
  audit timelines, and real multi-account authorization (today's personas
  are a declared demo device).
- **Capture at scale**: richer auto-capture so the interview starts from
  even thinner signals, and analytics on where playbooks catch skipped
  steps — measuring the incidents that never happened.
