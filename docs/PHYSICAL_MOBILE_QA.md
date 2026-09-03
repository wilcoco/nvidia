# Physical-mobile QA checklist

A desktop browser resized to 375px is useful regression coverage but is not a
physical-mobile result. Store device evidence in
`qa-evidence/mobile/YYYY-MM-DD-device-os-browser/`.

## Device record

- Device model, OS build, browser name/version, orientation and viewport
- Network type, tester, timestamp, Git full hash and on-screen LIVE build
- Screen recording filename and screenshots for each failed step

## Required assigned-work flow

- [ ] Open a fresh LIVE tab, hard reload, sign in and verify the build.
- [ ] Confirm the mobile scope message is visible and the page has no horizontal overflow.
- [ ] Open **My tasks** and switch to the assigned contributor.
- [ ] Use the on-screen keyboard to fill required text and numeric fields.
- [ ] Verify zero and `false` are accepted as values where the field permits them.
- [ ] Verify an unselected dropdown and unchecked required acknowledgment are blocked.
- [ ] Submit a valid dropdown choice and confirm the next role receives only its branch.
- [ ] Complete the next assignee handoff and open the reviewer card.
- [ ] Reject once with a comment, correct/resubmit, then approve.
- [ ] Reload and confirm the same run id, latest values, owners, review and completion.
- [ ] Rotate portrait→landscape→portrait and repeat the final task/review navigation.
- [ ] Check tap targets, sticky actions, virtual-keyboard overlap and browser back behavior.
- [ ] Record whether VoiceOver/TalkBack was tested; do not imply screen-reader coverage if it was not.

## Result

Create `result.md` with PASS/FAILED/BLOCKED, the first failing checklist item,
run/review ids and evidence filenames. Process authoring and agent-driven
decision resolution are outside the current mobile product scope; do not count
their absence as a failure or claim they were exercised.
