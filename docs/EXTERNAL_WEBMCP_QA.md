# External WebMCP client verification

This is a manual, non-deterministic integration lane. It counts only when an
actual WebMCP-capable client discovers and calls the page's tools through its
own transport. Browser-console calls to `window.__understudy`, mocked
`modelContext`, and the deterministic Chrome test do not count.

Store the result and captures in
`qa-evidence/webmcp/YYYY-MM-DD-client-version/`.

## Record before testing

- Git full hash and on-screen LIVE build after a hard reload
- Client name, exact version and operating system
- Browser name/version and the WebMCP transport/API surface reported by the client
- Tester, timestamp and LIVE URL

## Required flow

1. Open a fresh LIVE tab, hard reload, and verify the displayed build against
   `git rev-parse HEAD`.
2. Ask “What is this? How do I use it?” Confirm the client discovers and calls
   `describe_workspace`, the page opens the guide, and no records are changed.
3. Enter one synthetic work log. Ask the client to inspect the workspace and
   relevant playbooks. Save the tool transcript showing discovery rather than
   a browser-console invocation.
4. Ask one missing-knowledge question through `ask_user`; answer the rendered
   page card and confirm the client receives `get_question_result`.
5. Have the client propose a small process with one required field, one
   machine-checked decision and one approval. Edit a label in the page, then
   confirm the client reads that edit before saving.
6. Start a synthetic run and submit a value from the assignee UI. Ask the
   client to choose a branch using a contradictory value first. Capture the
   `evidence_conflict`, unchanged `chosen=null`, and the still-pending decision.
7. Submit the evidence-consistent decision. For a non-built-in action, capture
   the on-page approval card, approve it, and show the client polling
   `get_action_result` instead of assuming success.
8. Complete review, hard reload, and verify the same run, decision, evidence
   and approval are restored.

## Pass record

The result file must list every discovered tool, the transcript or screenshot
for steps 2–8, run/review ids, console errors, and any retry. Mark the lane PASS
only when the client transport, page consent and restored server state all
complete. Otherwise record FAILED or BLOCKED with the first failing step.
