import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import * as store from './store'

window.Understudy.init({
  appName: 'Understudy — Work Log Demo Workspace',
  // The demo app emits its own semantic journal entries via Understudy.log,
  // so automatic click capture is limited to navigation.
  autoCapture: 'min',
  stateProvider: () => {
    const s = store.getState()
    return {
      loggedInAs: s.me,
      actingAs: s.actingAs,
      users: s.users,
      incidents: s.worklogs,
      reviews: s.approvals,
      savedPlaybooks: s.processes,
    }
  },
  processStore: {
    save: async (map) => store.saveProcess(map as { title: string; steps: unknown[] }),
    list: () => store.listProcesses(),
    load: async (id) => {
      const p = await store.getProcess(id)
      return { map: p.map as never, title: p.title, createdBy: p.createdBy }
    },
    findRelevant: () => {
      const s = store.getState()
      return {
        entering_now: s.draft,
        matches: store.computeMatches(),
        note: 'Matches require every appliesWhen condition of a playbook to hold for the current form input.',
      }
    },
    startRun: (processId, map) => store.startRun(processId, map),
    updateRun: (runId, payload) => store.updateRun(runId, payload),
    saveVerification: (measurements, meta) => {
      const produced = meta.producedIds.find((p) => p.action === 'log_work_item')
      const target = produced?.id ?? store.getState().worklogs[0]?.id
      if (target)
        return store.saveVerification(target, measurements, {
          label: meta.branchLabel,
          pass: meta.toApproval,
          checked: meta.criteriaChecked,
        })
    },
  },
  // Resolve playbook branch conditions against live data: the urgency branch
  // becomes required once an actually-urgent incident exists in this run.
  branchResolver: (condition) => {
    const c = condition.toLowerCase()
    if (c.includes('urgent')) {
      const latest = store.getState().worklogs[0]
      return latest ? Boolean(latest.urgent) : undefined
    }
    return undefined
  },
  actions: [
    {
      name: 'log_work_item',
      description:
        'Create a work log entry (as the active persona): what was done or observed, its category, and any structured values. When a playbook with a fields contract is loaded, pass those fields as additional params — they are stored on the entry. Returns the new entry including its id.',
      params: {
        date: { type: 'string', description: 'YYYY-MM-DD', required: true },
        area: { type: 'string', description: 'Work area, "A" or "B"', required: true },
        kind: {
          type: 'string',
          description:
            "Category: routine work (default) | planning | development | design | operations | review | incident",
          required: true,
        },
        task: { type: 'string', description: 'What was done or observed, one line', required: true },
        urgent: { type: 'boolean', description: 'Blocked / needs the reviewer immediately' },
        hours: { type: 'number', description: 'Time spent (default 0.5)' },
      },
      handler: (p) => {
        // Domain-specific values (a loaded playbook's fields contract, or any
        // structured readings) arrive as extra params and are stored on the entry.
        const known = new Set(['date', 'area', 'line', 'kind', 'task', 'urgent', 'hours'])
        const extras = Object.fromEntries(Object.entries(p).filter(([k]) => !known.has(k)))
        return store.createWorklog({
          date: String(p.date),
          line: String(p.area ?? p.line ?? 'A'),
          task: String(p.task),
          hours: Number(p.hours ?? 0.5),
          note: '',
          urgent: Boolean(p.urgent),
          kind: String(p.kind),
          data: extras as store.IncidentData,
        })
      },
    },
    {
      name: 'record_step_result',
      description:
        'Attach a step\'s result (what was done and its outcome) to an EXISTING work log entry — use this for fix/remediation/completion steps instead of creating a new entry.',
      params: {
        worklogId: { type: 'string', description: 'The entry being updated', required: true },
        actionTaken: { type: 'string', description: 'What was done for this step', required: true },
        result: { type: 'string', description: 'Outcome/verification summary' },
      },
      handler: (p) =>
        store.recordCorrectiveAction(String(p.worklogId), {
          actionTaken: String(p.actionTaken),
          result: p.result ? String(p.result) : undefined,
        }),
      precondition: () =>
        store.getState().worklogs.length > 0 ? null : 'no work log entry exists yet — log the work item first',
    },
    {
      // Legacy aliases: playbooks saved before the rename may still call these.
      name: 'log_incident',
      hidden: true,
      description: '(legacy alias of log_work_item)',
      params: {
        date: { type: 'string', required: true },
        line: { type: 'string', required: true },
        kind: { type: 'string', required: true },
        task: { type: 'string', required: true },
        urgent: { type: 'boolean' },
        hours: { type: 'number' },
      },
      handler: (p) => {
        const known = new Set(['date', 'line', 'kind', 'task', 'urgent', 'hours'])
        const extras = Object.fromEntries(Object.entries(p).filter(([k]) => !known.has(k)))
        return store.createWorklog({
          date: String(p.date), line: String(p.line), task: String(p.task),
          hours: Number(p.hours ?? 0.5), note: '', urgent: Boolean(p.urgent),
          kind: String(p.kind), data: extras as store.IncidentData,
        })
      },
    },
    {
      name: 'record_corrective_action',
      hidden: true,
      description: '(legacy alias of record_step_result)',
      params: {
        worklogId: { type: 'string', required: true },
        actionTaken: { type: 'string', required: true },
        result: { type: 'string' },
      },
      handler: (p) =>
        store.recordCorrectiveAction(String(p.worklogId), {
          actionTaken: String(p.actionTaken),
          result: p.result ? String(p.result) : undefined,
        }),
      precondition: () =>
        store.getState().worklogs.length > 0 ? null : 'no work log entry exists yet — log the work item first',
    },
    {
      name: 'request_review',
      description: 'Send a work log entry to the reviewer for approval.',
      params: {
        worklogId: { type: 'string', description: 'Work log entry id', required: true },
        approver: { type: 'string', description: 'Approver username (default "lee")' },
      },
      handler: (p) => store.requestApproval(String(p.worklogId), String(p.approver ?? 'lee')),
      precondition: () =>
        store.getState().worklogs.some((w) => w.status === 'draft')
          ? null
          : 'no draft entry to send — log the work item first',
    },
    {
      name: 'approve_review',
      description:
        'Approve a pending review (switch persona to the reviewer first). Use for sign-off steps.',
      params: {
        approvalId: { type: 'string', required: true },
        comment: { type: 'string' },
      },
      handler: (p) =>
        store.decideApproval(String(p.approvalId), 'APPROVED', p.comment ? String(p.comment) : undefined),
      precondition: () =>
        store.getState().approvals.some((a) => a.status === 'PENDING')
          ? null
          : 'no pending review to approve — request a review first',
    },
    {
      name: 'reject_review',
      description: 'Reject a pending review with a comment explaining why.',
      params: {
        approvalId: { type: 'string', required: true },
        comment: { type: 'string', required: true },
      },
      handler: (p) => store.decideApproval(String(p.approvalId), 'REJECTED', String(p.comment ?? '')),
      precondition: () =>
        store.getState().approvals.some((a) => a.status === 'PENDING')
          ? null
          : 'no pending review to reject — request a review first',
    },
    {
      name: 'switch_persona',
      description:
        'Switch the active demo persona (kim = contributor, lee = reviewer) so one person can play both sides.',
      params: { username: { type: 'string', required: true } },
      handler: (p) => {
        store.switchActingAs(String(p.username))
        return { actingAs: store.getState().actingAs }
      },
    },
  ],
})

store.startPolling()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
