import type { ElicitationAnswer, ElicitationRecord, ElicitationStage, Step } from './types'

export type ElicitationGapKind =
  | 'knowledge_incident'
  | 'knowledge_cues'
  | 'knowledge_novice_mistake'
  | 'knowledge_boundary'
  | 'knowledge_failure_recovery'

export interface ElicitationGap {
  kind: ElicitationGapKind
  stage: ElicitationStage
  stepId: string
  step: string
  priority: number
  method: 'critical-incident' | 'observable-cue' | 'counterexample' | 'boundary' | 'failure-recovery'
  question_goal: string
  missing_information: string[]
  fallback_question: string
  note: string
}

const KIND_TO_STAGE: Record<ElicitationGapKind, ElicitationStage> = {
  knowledge_incident: 'incident',
  knowledge_cues: 'cues',
  knowledge_novice_mistake: 'novice_mistake',
  knowledge_boundary: 'boundary',
  knowledge_failure_recovery: 'failure_recovery',
}

const STAGE_TO_KIND = Object.fromEntries(
  Object.entries(KIND_TO_STAGE).map(([kind, stage]) => [stage, kind]),
) as Record<ElicitationStage, ElicitationGapKind>

const DECLINE_PATTERNS = [
  /\b(no such|none|cannot recall|can't recall|skip|not applicable)\b/i,
  /(그런 적|사례|기억나는 게|떠오르는 게).{0,12}(없|않)/,
  /(넘어가|건너뛰|해당 없)/,
]

const UNSPEAKABLE_PATTERNS = [
  /\b(just (know|feel)|gut feel|can't (be )?put .* words|cannot (be )?put .* words|only by watching|learned? by watching)\b/i,
  /(그냥|오직).{0,8}(감|느낌)/,
  /(말|글).{0,8}(설명|표현).{0,8}(안|못)/,
  /(옆에서|직접).{0,8}(봐야|보여야|해봐야)/,
]

function clean(value: string, limit = 2000): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function isDecline(answer: string): boolean {
  const text = clean(answer, 240)
  return text.length > 0 && text.length < 180 && DECLINE_PATTERNS.some((pattern) => pattern.test(text))
}

function isUnspeakable(answer: string): boolean {
  const text = clean(answer, 320)
  return UNSPEAKABLE_PATTERNS.some((pattern) => pattern.test(text))
}

function accepted(record: ElicitationRecord | undefined, stage: ElicitationStage): ElicitationAnswer[] {
  return (record?.answers ?? []).filter(
    (answer) => answer.stage === stage && ['accepted', 'declined', 'unspeakable'].includes(answer.disposition),
  )
}

function cueProbeCount(record: ElicitationRecord | undefined): number {
  return (record?.answers ?? []).filter(
    (answer) => answer.stage === 'cues' && answer.disposition === 'needs_probe',
  ).length
}

export function isElicitationGapKey(gapKey: string): boolean {
  return gapKey.split(':', 1)[0] in KIND_TO_STAGE
}

export function elicitationHotspots(steps: Step[], limit = 3): Step[] {
  return steps
    .map((step, index) => {
      if (step.type === 'approval') return null
      const branches = step.next?.length ?? 0
      const guarded = step.next?.some((edge) => edge.criteria && Object.keys(edge.criteria).length > 0) ?? false
      const score =
        (step.type === 'decision' ? 100 : 0) +
        (branches > 1 ? 40 : 0) +
        (guarded ? 30 : 0) +
        ((step.fields?.length ?? 0) > 0 ? 20 : 0) +
        (!step.detail ? 10 : 0)
      if (score === 0) return null
      return {step, index, score}
    })
    .filter((entry): entry is {step: Step; index: number; score: number} => entry !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.step)
}

export function nextElicitationGap(step: Step): ElicitationGap | null {
  const record = step.elicitation
  const cuesProbed = cueProbeCount(record)
  let stage: ElicitationStage | null = null
  if (accepted(record, 'incident').length === 0) stage = 'incident'
  else if (accepted(record, 'cues').length === 0) stage = 'cues'
  else if (accepted(record, 'novice_mistake').length === 0) stage = 'novice_mistake'
  else if (accepted(record, 'boundary').length === 0) stage = 'boundary'
  else if (accepted(record, 'failure_recovery').length === 0) stage = 'failure_recovery'
  if (!stage) return null

  const common = {
    stepId: step.id,
    step: step.label,
    priority: step.type === 'decision' ? 85 : 65,
    note:
      'Ask one short question about a real case. Record the answer with this gap key. The raw answer is source evidence only; never turn it into a field, threshold or route until the human reviews the draft.',
  }
  if (stage === 'incident') return {
    ...common,
    kind: STAGE_TO_KIND[stage], stage, method: 'critical-incident',
    question_goal: `Recall one recent, concrete occasion when experience changed what happened at “${step.label}”`,
    missing_information: ['one real occasion', 'what was at stake', 'where the judgment point occurred'],
    fallback_question: `Think of one recent occasion when experience changed what happened at “${step.label}”. What happened?`,
  }
  if (stage === 'cues') return {
    ...common,
    kind: STAGE_TO_KIND[stage], stage, method: 'observable-cue',
    question_goal: cuesProbed === 0
      ? `Find the observable signal that caused the expert to make the call at “${step.label}”`
      : `Make one final attempt to separate “feel” into an observable channel; if it still cannot be expressed, preserve it as requiring observation or apprenticeship`,
    missing_information: cuesProbed === 0
      ? ['what they saw, heard, measured or felt', 'the moment the situation stopped looking normal']
      : ['one visible, audible, measured, tactile or timing signal', 'whether this must be learned by watching'],
    fallback_question: cuesProbed === 0
      ? `At the moment you made the call at “${step.label}”, what did you actually see, hear, measure or feel?`
      : `Can you split that feeling into one visible, audible, measured, tactile or timing signal? If not, should this be learned by watching?`,
  }
  if (stage === 'novice_mistake') return {
    ...common,
    kind: STAGE_TO_KIND[stage], stage, method: 'counterexample',
    question_goal: `Expose the tempting but wrong move a less experienced person might make at “${step.label}”`,
    missing_information: ['likely novice action', 'why it would be wrong in this case'],
    fallback_question: `What would a less experienced person be tempted to do at “${step.label}”, and what would that miss?`,
  }
  if (stage === 'boundary') return {
    ...common,
    kind: STAGE_TO_KIND[stage], stage, method: 'boundary',
    question_goal: `Find when the usual judgment for “${step.label}” stops applying`,
    missing_information: ['exception or counterexample', 'boundary value if one exists', 'condition that changes the route'],
    fallback_question: `When does the usual judgment for “${step.label}” not apply?`,
  }
  return {
    ...common,
    kind: STAGE_TO_KIND[stage], stage, method: 'failure-recovery',
    question_goal: `Find a failure of this judgment and the recovery that followed at “${step.label}”`,
    missing_information: ['what failed', 'first recovery action', 'where the process should loop back'],
    fallback_question: `When has this judgment failed at “${step.label}”, and what did you do next?`,
  }
}

export function recordElicitationAnswer(
  step: Step,
  gapKey: string,
  evidence: {questionId: string; question: string; answer: string; answeredAt: number},
): {handled: boolean; resolved: boolean; disposition?: ElicitationAnswer['disposition']} {
  const [kind, stepId] = gapKey.split(':') as [ElicitationGapKind, string | undefined]
  const stage = KIND_TO_STAGE[kind]
  if (!stage || stepId !== step.id) return {handled: false, resolved: false}
  const answer = clean(evidence.answer)
  if (!answer) return {handled: true, resolved: false}
  const record = (step.elicitation ??= {answers: []})
  const decline = isDecline(answer)
  const firstUnspeakableCue = stage === 'cues' && isUnspeakable(answer) && cueProbeCount(record) === 0
  const disposition: ElicitationAnswer['disposition'] = decline
    ? 'declined'
    : firstUnspeakableCue
      ? 'needs_probe'
      : stage === 'cues' && isUnspeakable(answer)
        ? 'unspeakable'
        : 'accepted'
  record.answers.push({
    questionId: clean(evidence.questionId, 80),
    question: clean(evidence.question, 1000),
    answer,
    stage,
    answeredAt: evidence.answeredAt,
    disposition,
  })
  record.confirmed = false
  record.confirmedBy = undefined
  record.confirmedAt = undefined
  if (disposition === 'needs_probe') return {handled: true, resolved: false, disposition}
  if (disposition === 'declined') return {handled: true, resolved: true, disposition}
  if (disposition === 'unspeakable') {
    ;(record.unspeakable ??= []).push(answer)
    return {handled: true, resolved: true, disposition}
  }
  if (stage === 'incident') record.incident = answer
  else if (stage === 'cues') (record.cues ??= []).push(answer)
  else if (stage === 'novice_mistake') record.noviceMistake = answer
  else if (stage === 'boundary') (record.boundaries ??= []).push(answer)
  else record.failureRecovery = answer
  return {handled: true, resolved: true, disposition}
}

export function confirmedElicitation(step: Step, actor: string | undefined, at: number): Step {
  if (!step.elicitation?.answers.length) return {...step}
  return {
    ...step,
    elicitation: {
      ...structuredClone(step.elicitation),
      confirmed: true,
      confirmedBy: actor,
      confirmedAt: at,
    },
  }
}
