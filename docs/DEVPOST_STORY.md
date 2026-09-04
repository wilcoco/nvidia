# Devpost "Project story" — paste-ready (Markdown)

Copy everything below the line into the Devpost story field.

---

## Inspiration

Organizations already run on SOPs, ERP workflows, and explicitly programmed
processes. Daily execution still depends on tacit judgment that rarely fits
inside those systems: which weak signal means stop, which exception justifies
a detour, how to recover, and when a handoff is actually safe. These gaps sit
between formally defined steps. The operational record may say only *"ran the
schema migration on staging,"* while the expert's real decision process goes
unrecorded. When that person is unavailable, the official process remains but
its practical judgment layer disappears.

We first tried the usual answer: put an LLM inside the app and ask it
questions. WebMCP reverses that relationship: **the page provides the tools,
and the visitor brings a compatible agent.** That made a different kind of
collaboration possible — an agent apprenticed to the worker. It observes the
work, asks for the judgment that is missing, and helps turn that knowledge
into something the team can run. That is why it is called Understudy.

## What it does

Understudy is a WebMCP layer that helps teams surface missing judgment through
structured questions during real work, then encode the reviewed answers as a
reusable process. It can start from an
undocumented work event or an existing procedure, look for the gaps around the
current task, and capture them as required evidence, decision criteria,
recovery loops, ownership, and approval rules. One SDK script supplies
observation, interviews, the process panel, and 20 WebMCP tools. Registered
host actions add operation; the included process store and authenticated
server guard add shared, governed execution.

- **Capture.** A worker saves an ordinary work entry. The agent reads the
  action journal, drafts the process *around* that event, and asks one focused
  question card at a time. For judgment-heavy steps the interview adapts from
  a real incident to observable cues, the tempting novice mistake,
  boundaries/exceptions, and failure/recovery. Questions, raw answers and
  timestamps stay attached to the relevant step as non-executable source
  evidence.
- **Teach.** The worker corrects the map directly — rename a step, adjust a
  branch, or explain a missing rule in chat. The agent reads those edits with
  `get_map_edits`, updates its next question, and leaves the revised map for
  human review. The existing **Save as vN** action confirms the whole map and
  its captured judgment together; there is no confirmation click after every
  answer. Saving a revision creates a new version with lineage. Older saved
  playbooks without elicitation metadata remain valid as previously reviewed
  versions.
- **Operate.** A saved playbook becomes assigned work. Contributor,
  Operations, and Reviewer roles receive their next task in order. Task cards
  render the playbook's typed data contract, including required numbers,
  booleans, acknowledgements, and dropdowns. Failure can route recovery work;
  reaching sign-off creates a review; the run survives reload.
- **Enforce.** The map is executable state, not a diagram. The page gives
  immediate guidance, while the server rechecks persisted transitions inside
  the storage transaction. It rejects work completed by the wrong role or out
  of order, branches that conflict with submitted evidence, forged approval
  completion, stale decisions after evidence changes, and edits to signed
  work.
- **Reuse.** When someone describes similar work later, Understudy explains
  which saved playbook matches and lets the person choose whether to start a
  new run. Execution evidence and new exceptions can inform a human-reviewed
  revision instead of silently changing the approved process.

No site-owned LLM API key is required for these WebMCP interactions. The
visitor's agent uses its own account, limits, and cost.

## How we built it

- **Understudy SDK** (TypeScript → bundled `understudy.js`): an action journal,
  adaptive expert-interview state machine, question and approval cards, a
  shadow-DOM process panel with a mini flowchart, and the WebMCP tool surface.
- **Process engine:** typed fields, role ownership, branch criteria,
  loop-backs that reopen the loop body, invalidation of superseded decisions,
  per-attempt audit events, review snapshots, and version lineage.
- **Async human interaction:** agent calls cannot wait indefinitely for a
  person. `ask_user`, `run_action`, and agent-requested deviations return a
  pending id; the agent polls for the real answer or approval outcome.
- **Trust boundary:** host and user text returned by read tools is labeled as
  untrusted data. Agent-requested host mutations have no `force` or global
  auto-approve path and wait for an on-page approval card. Normal accounts are
  bound to their authenticated session; only the disclosed judge account may
  switch among demo personas.
- **Server guard** (Express + Postgres on Railway): run updates are checked
  under the same lock used to persist them. The server derives actor and role
  from the session, recomputes order and branch evidence, owns approval
  completion, stamps attribution, and derives the run's active/completed
  status instead of trusting a browser claim.
- **Two host apps:** the React workspace demonstrates actions, persistence,
  role handoffs, and server enforcement. A deliberately plain, framework-free
  page demonstrates the one-script observation/tool tier. It does not pretend
  that one script can add an arbitrary application's database authorization.

```js
document.modelContext.registerTool({
  name: "resolve_decision",
  description: "Record a branch only when its saved criteria match evidence.",
  inputSchema: { /* stepId, branchTo, reason, measurements */ },
  execute: async (input) => engine.resolveDecision(input),
})
```

## Challenges we ran into

- **Human time is longer than tool-call time.** Calls that waited for a person
  timed out, so we designed question and approval flows as pending-id + polling
  protocols.
- **The agent's claim cannot be the record.** An early agent could claim
  `rowCountDelta: 0` after the assignee submitted `12`. Submitted task values
  are now authoritative; a conflicting branch is refused.
- **The browser cannot be the security boundary.** Earlier versions trusted
  browser-computed progress and persona strings too much. We moved actor,
  sequence, branch-evidence, approval, and completion checks into the server
  transaction and retain both the accountable persona and authenticating
  session.
- **Retries expose stale state.** Task and decision loop-backs must reopen the
  right work, clear current attribution, preserve historical attempts, cancel
  stale reviews, and invalidate superseded choices without erasing the audit
  trail.
- **User text and instructions must stay separate.** Work logs, labels, notes,
  and saved process content may contain instruction-like text. Read tools mark
  it as untrusted; authorization still comes from approval controls and server
  checks, never prompt wording.
- **Automatable confirmation needs page UI.** Native dialogs froze agent
  browsers, so destructive or state-changing confirmations became explicit
  page cards and two-step buttons.
- **Testing required adversarial roles.** We repeatedly attacked order,
  evidence, identity, retries, review delivery, concurrency, restoration, and
  malformed inputs. We distinguish LIVE E2E evidence from local memory,
  browser, and PostgreSQL tests instead of treating one passing suite as total
  certification.

## Accomplishments that we're proud of

- A full multi-role relay on the live deployment: one worker records and
  measures, another handles recovery or handoff, and a reviewer signs the
  exact evidence — all restored after reload.
- A playbook that refuses a false pass using the assignee's submitted values.
  A diagram cannot do that.
- A process that starts from one ordinary work entry, grows through questions
  and human correction, becomes a versioned execution, and is suggested again
  for related work.
- A reusable 20-tool WebMCP surface plus an explicit integration model: one
  script for observation and teaching, registered actions for operation, and a
  store/server adapter for governed shared execution.
- A test suite that covers repeated task and decision loops, stale-evidence
  invalidation, review delivery failures, role and sequence attacks, approval
  immutability, reload restoration, a 375px role relay, and PostgreSQL variants.

## What we learned

- WebMCP's biggest value is not remote control; it is **structured shared
  context**. The worker, page, and agent can see and change one process model
  together.
- Chat carries intent; **the page and server must carry evidence, consent, and
  authorization.** Anything needed by the next worker cannot remain only in a
  private conversation.
- Trust needs layers: untrusted-content labeling, narrow tools, per-action
  approval, session-derived identity, server-side transition checks, evidence
  snapshots, immutable sign-off, and honest statements about what was tested.
- The one-script promise has a boundary. It can add observation, interviews,
  a panel, and tools. Shared governance still requires host actions,
  persistence, identity, and a server integration.
- Our central product assumption still needs a real expert pilot: whether busy
  workers will answer short contextual questions during or soon after actual
  work, and whether the resulting playbooks reduce handoff failures.

## What's next for Understudy

- **Real-world pilot:** test question response, expert review time, unsafe or
  missing rules, reuse, and handoff outcomes with one team before making ROI
  claims.
- **Production identity and tenancy:** replace demo personas with SSO, team
  membership, tenant isolation, and deployable enforcement components.
- **Operations depth:** deadlines, notifications, reassignment, multiple
  simultaneous active runs, and richer attempt-by-attempt audit views.
- **Cross-app runs:** use WebMCP to standardize the tool surface while still
  handling production identity, reliability, and data mapping explicitly.
- **Capture at scale:** improve semantic capture beyond click labels and test
  meaning-aware anti-parrot checks without allowing captured text to become
  authority.
