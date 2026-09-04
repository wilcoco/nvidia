# Governed execution integration

The SDK and the enforcement backend solve different parts of the product.
Loading `understudy.js` adds the journal, question cards, process panel and
WebMCP tools. A host that wants shared, durable and accountable execution must
also connect authenticated actions, a process store and a server transition
guard.

## Three integration tiers

| Tier | Required host work | Boundary |
| --- | --- | --- |
| Observe and teach | Load the script and call `Understudy.init()` | Browser-local observation, interviews and process map. |
| Operate | Register narrowly scoped actions and a state provider | Every host mutation waits for an on-page human approval. |
| Govern and share | Implement the process-store adapter and run writes through an authenticated server | Shared versions and runs, session-derived attribution, server checks and immutable sign-off. |

The framework-free `plain.html` demonstrates the first tier. The React demo
workspace demonstrates the full reference integration. The SDK alone does not
turn an arbitrary host database into a governed workflow system.

## Server contract

`server/enforcement.js` exports `enforceRunUpdate(run, patch, map, authority)`.
Call it while holding the same storage lock used to update the run. The
`authority` object must come from the authenticated session:

```js
{
  actor: 'kim',             // accountable workflow actor
  role: 'Contributor',      // server-resolved role
  authenticatedAs: 'kim',  // session subject
  canAdmin: false
}
```

The guard:

- refuses a task that is not the next task on the persisted route;
- checks a saved step's role against the authenticated authority;
- recomputes branch criteria from persisted task values and rejects missing or
  contradictory evidence;
- overwrites client-provided completion attribution with the session-derived
  actor and records the authenticating subject;
- keeps approval completion server-owned;
- derives `active` or `completed` instead of trusting the client's status;
- stamps new audit events with the same authority.

The reference database calls the guard inside both its in-memory critical
section and PostgreSQL `SELECT ... FOR UPDATE` transaction. Review acceptance
uses the same row lock and freezes a fingerprint of the evidence shown to the
reviewer.

## Identity boundary

Normal accounts cannot use `actingAs` to impersonate another user. The public
demo's `judge` account is an explicit exception so one evaluator can show a
multi-role handoff on one screen; both the delegated persona and the
authenticated judge subject are retained. A production integration should
replace this exception with its own SSO, tenant membership and authorization
policy.

## Untrusted agent context

Work-log text, process titles, step labels, notes and form values are untrusted
content. Read tools label or wrap that content and tell the agent not to treat
embedded text as instructions. This reduces instruction/data ambiguity, while
the actual security boundary remains the action approval UI and the
authenticated server checks. Prompt wording is not an authorization control.

