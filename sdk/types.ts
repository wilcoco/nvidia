export type ActionSource = 'user' | 'agent'

export interface ActionEntry {
  id: number
  ts: number
  source: ActionSource
  /** 'click' | 'submit' | 'change' | 'navigate' | 'app' | 'action' | 'answer' | 'map' */
  kind: string
  label: string
  detail?: unknown
  page: string
}

export interface BranchTarget {
  to: string
  condition?: string
}

export type StepType = 'task' | 'decision' | 'approval'

export interface Step {
  id: string
  label: string
  type: StepType
  detail?: string
  /** Which host action (if any) performs this step when the agent replays the process. */
  action?: string
  next?: BranchTarget[]
  /** Completion state while working along a confirmed process. Auto-set when the
   *  step's action runs successfully; the human can also check steps off in the panel. */
  done?: boolean
  /** Id of the record the step's action produced (e.g. worklogId), captured on success
   *  so later steps can chain their params. */
  resultId?: string
  /** Set when the step was explicitly resolved as not applicable for this run. */
  naReason?: string
  /** Inherently manual step — no host action can perform it; the human checks it off. */
  humanOnly?: boolean
}

/** One field of a playbook's data contract — captured via interview, rendered
 *  as a dynamic form when the playbook is followed. */
export interface FieldDef {
  key: string
  label?: string
  type: 'number' | 'string' | 'boolean'
  unit?: string
  required?: boolean
}

export interface ProcessMap {
  title: string
  steps: Step[]
  /** The playbook's own data contract: what must be captured when following it. */
  fields?: FieldDef[]
  entry?: string
  confirmed?: boolean
  /** Conditions under which this playbook applies (used for auto-suggestion). */
  appliesWhen?: Record<string, unknown>
  priorityWhen?: Record<string, unknown>
  /** The work entry that triggered creating this playbook. */
  sourceWorklogId?: string
  /** Interview gaps the human already answered (kind[:stepId]) — not re-asked. */
  resolvedGaps?: string[]
  version?: number
}

export interface MapEdit {
  id: number
  ts: number
  stepId?: string
  field: string
  from?: string
  to?: string
}

export interface HostActionParam {
  type: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
}

export interface HostAction {
  name: string
  description: string
  params?: Record<string, HostActionParam>
  handler: (params: Record<string, unknown>) => unknown | Promise<unknown>
  /** Return a human-readable reason why the action cannot run right now, or null when it can.
   *  Used to mark process steps as 'blocked' instead of 'ready'. */
  precondition?: () => string | null
}

export interface ProcessSummary {
  id: string
  title: string
  createdBy?: string
  createdAt?: number
}

/** Host-provided persistence so confirmed processes can be shared across users. */
export interface ProcessStoreAdapter {
  save(map: ProcessMap): Promise<ProcessSummary>
  list(): Promise<ProcessSummary[]>
  load(id: string): Promise<{ map: ProcessMap; title?: string; createdBy?: string }>
  /** Optional: match saved processes against what the human is entering right now. */
  findRelevant?: () => Promise<unknown> | unknown
  /** Optional run persistence: one record per execution of a playbook. */
  startRun?: (processId: string, map: ProcessMap) => Promise<{ id: string }>
  updateRun?: (
    runId: string,
    payload: { steps: unknown[]; status?: 'active' | 'completed'; deviations?: number },
  ) => Promise<unknown>
}

export interface InitOptions {
  appName?: string
  /** 'full' captures clicks/submits/changes automatically; 'min' captures navigation only
   *  (for apps that emit their own semantic logs via Understudy.log). */
  autoCapture?: 'full' | 'min' | 'off'
  stateProvider?: () => unknown
  actions?: HostAction[]
  processStore?: ProcessStoreAdapter
  /** Resolve a branch condition against live app state: true = branch active
   *  (its steps are required), false = not taken, undefined = still unknown. */
  branchResolver?: (condition: string) => boolean | undefined
}
