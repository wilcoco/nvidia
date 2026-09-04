# Expert pilot validation plan

The current demo proves an implemented workflow loop with synthetic scenarios.
It does not prove that busy experts will answer questions during real work or
that captured rules improve an organization. A pilot should test that behavior
before making adoption or ROI claims.

## Proposed four-week pilot

Choose one team, one recurring process and 3–5 experienced workers. Start in
shadow mode: capture and interview, but do not enforce a new playbook. An expert
reviews each draft and labels every rule as correct, incomplete or unsafe. Only
an approved version enters a limited live run; production publication remains a
human decision.

Use these lifecycle labels:

1. `draft` — generated from observed work and answers;
2. `expert reviewed` — owner checked sequence, fields, thresholds and recovery;
3. `pilot validated` — completed real runs without an unsafe instruction;
4. `published` — organization authorized reuse.

## Measures

- percentage of question cards answered and median response time;
- expert minutes needed to turn a draft into an approved playbook;
- incorrect, missing and ambiguous rules found per draft;
- percentage of runs that reuse the playbook;
- handoff time before and after adoption;
- skipped steps or exceptions caught before sign-off;
- rejected or revised playbooks and why;
- incidents caused or prevented, reported as observed cases rather than
  extrapolated savings.

The initial go/no-go rule should be set before the pilot. A reasonable first
bar is: no unsafe rule reaches publication, at least 60% of contextual cards
receive an answer, and expert review time falls across the first three
revisions. These are proposed validation thresholds, not achieved results.

