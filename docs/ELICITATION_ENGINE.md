# Adaptive process elicitation

Understudy does not claim that a model can automatically extract everything an
expert knows. It uses a deterministic interview sequence to help a team surface
the human judgment missing between formal process steps, and keeps the human in
control of what becomes an executable playbook.

## Sequence

For up to three judgment-heavy steps in a new draft, `get_map_gaps` exposes one
next move at a time:

1. one recent concrete incident;
2. the observable cue at the decision point;
3. the tempting mistake a less experienced worker might make;
4. the boundary or exception where the usual rule stops applying;
5. a failure of the judgment and the recovery or loop-back that followed.

The sequence is influenced by Cognitive Task Analysis, including the Critical
Decision Method and ACTA Knowledge Audit. The implementation is an original
TypeScript state machine for Understudy's WebMCP tool and process-map model.

## Data and control contract

- `ask_user` receives the exact `resolves_gap` key from `get_map_gaps`.
- The page stores the question, raw answer, timestamp and disposition on the
  relevant step. Read tools continue to label this human-authored material as
  untrusted data.
- A first answer such as “I just know it by feel” triggers one concrete
  observable-channel follow-up. If it still cannot be expressed, the answer is
  preserved as `unspeakable`, meaning it needs observation or apprenticeship.
- The interview starts with only the highest-value judgment point and shows
  one question at a time. When its five evidence stages are complete, the
  panel stops. Only a human click on **Explore another judgment point** adds
  the next point to the agenda. The playbook can be saved earlier and refined
  in a later revision, so the interview never becomes a mandatory long form.
- Raw prose never becomes a numeric field, branch criterion, route or approval
  rule automatically. The agent must show its interpretation in the draft and
  the human must review it.
- There is no per-answer confirmation. The existing **Save as vN** action
  confirms the map and all attached elicitation source material together.
- Saved playbooks without `elicitationVersion` are legacy-reviewed assets.
  Their missing elicitation fields do not create a migration questionnaire or
  block execution.

## Scope and provenance

The separate public `wilcoco/yudonKnow` project was inspected read-only at
commit `70fc00dd373502a22d85963fc0009c46b0a35aba` to assess whether a professional
interview layer could fit Understudy. No Python source, prompt text, UI text,
card implementation or test was copied. Understudy keeps its existing
architecture: the visiting WebMCP agent writes the domain-specific question,
while the page owns sequencing, provenance, display and confirmation.

Not imported from that project: its Alter/persona, retrieval, coverage,
knowledge-royalty, memoir, campaign UI, proprietary prompts, and twelve-tool
expert toolbox.

Primary methodological lineage:

- Klein, Calderwood & MacGregor (1989), *Critical Decision Method*.
- Militello & Hutton (1998), *Applied Cognitive Task Analysis (ACTA)*.

This remains a product hypothesis until real experts use it during or soon
after actual work. Synthetic demonstrations validate the interaction and state
contract, not the completeness of captured expertise.
