# Trust-boundary hardening — 2026-09-04

This change follows the independently qualified `7acbc29` release. That
release remains the last external PASS; this document describes the next
candidate and must not be presented as independently qualified until its LIVE
build has been retested.

## Changes

- Removed the global auto-approve control and the agent `force` input. Every
  agent-requested host mutation and deviation override now waits for an
  on-page approval card.
- Marked host state, work text, process labels, notes and related read-tool
  results as untrusted content. Onboarding no longer embeds a user's raw text
  inside trusted agent instructions.
- Bound normal demo accounts to their authenticated session. Only the
  disclosed `judge` account may delegate to seeded demo personas, and records
  retain both the accountable persona and authenticating session.
- Added `server/enforcement.js`, invoked inside the memory update and the
  PostgreSQL row-lock transaction. It rechecks the next live step, role,
  required branch evidence, decision history, approval ownership and final run
  status instead of accepting those claims from a browser snapshot.
- Branch-presentation states (`conditional` and unattributed
  `not_applicable`) no longer satisfy work. A reasoned task deviation is
  attributed and journaled by the server, while approval steps remain
  server-owned. Explicit `next: []` terminals and the persisted decision path
  determine which approval is reachable.
- Made approval completion and approval audit events server-owned.
- Restricted verification, corrective-action and playbook-deletion writes to
  their authenticated/delegated owner.
- Added regression coverage for impersonation, direct API jumps, conflicting
  decision evidence, stale decisions after evidence changes, approval forgery,
  owner-only changes and removal of the agent bypass controls.

## Integration boundary

The SDK script supplies observation, interviews, the process panel and WebMCP
tools. Registered actions add host operation. Shared governed execution needs
the process-store and authenticated enforcement adapter described in
[`ENFORCEMENT_INTEGRATION.md`](ENFORCEMENT_INTEGRATION.md). The plain HTML demo
proves the first tier; it does not claim to add an arbitrary application's
server authorization through a script tag.

## Remaining scope

This is a public shared demo with seeded users. It is not production SSO,
tenant isolation, physical-device certification or a multi-client WebMCP
compatibility matrix. Prompt-injection labels reduce instruction/data
confusion; authorization still comes from the approval UI and authenticated
server checks. A real expert pilot remains necessary to validate the product's
behavioral assumption that workers answer short process questions during or
soon after their work.
