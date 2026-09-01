import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import * as store from './store'

window.Understudy.init({
  appName: 'LinePulse — Paint Shop Incident & Response Log',
  // LinePulse emits its own semantic journal entries via Understudy.log,
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
      name: 'log_incident',
      description:
        'Create a paint-shop incident log entry (as the active persona): defect or equipment issue plus the line conditions it occurred under. Returns the new entry including its id.',
      params: {
        date: { type: 'string', description: 'YYYY-MM-DD', required: true },
        line: { type: 'string', description: 'Booth, "A" or "B"', required: true },
        kind: {
          type: 'string',
          description:
            'Incident type: orange peel | sagging / runs | dust inclusion | color mismatch | equipment fault | routine log',
          required: true,
        },
        task: { type: 'string', description: 'What happened, one line', required: true },
        urgent: { type: 'boolean', description: 'Line stopped / needs the lead immediately' },
        viscosity: { type: 'number', description: 'Paint viscosity in seconds, e.g. 18.5' },
        boothTemp: { type: 'number', description: 'Booth temperature °C' },
        sprayPressure: { type: 'number', description: 'Spray pressure in bar' },
        colorChange: { type: 'boolean', description: 'Occurred right after a color change' },
        actionTaken: { type: 'string', description: 'Corrective action taken, if any' },
        hours: { type: 'number', description: 'Time spent (default 0.5)' },
      },
      handler: (p) =>
        store.createWorklog({
          date: String(p.date),
          line: String(p.line),
          task: String(p.task),
          hours: Number(p.hours ?? 0.5),
          note: '',
          urgent: Boolean(p.urgent),
          kind: String(p.kind),
          data: {
            viscosity: p.viscosity === undefined ? undefined : Number(p.viscosity),
            boothTemp: p.boothTemp === undefined ? undefined : Number(p.boothTemp),
            sprayPressure: p.sprayPressure === undefined ? undefined : Number(p.sprayPressure),
            colorChange: Boolean(p.colorChange),
            actionTaken: p.actionTaken ? String(p.actionTaken) : undefined,
          },
        }),
    },
    {
      name: 'request_review',
      description: 'Send an incident log to the team lead for review/approval.',
      params: {
        worklogId: { type: 'string', description: 'Incident log id', required: true },
        approver: { type: 'string', description: 'Approver username (default "lee")' },
      },
      handler: (p) => store.requestApproval(String(p.worklogId), String(p.approver ?? 'lee')),
      precondition: () =>
        store.getState().worklogs.some((w) => w.status === 'draft')
          ? null
          : 'no draft incident log to send — log the incident first',
    },
    {
      name: 'approve_review',
      description:
        'Approve a pending review (switch persona to the approver first). Use for sign-off steps like corrective action approval or line restart.',
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
        'Switch the active demo persona (kim = line worker, lee = team lead) so one reviewer can play both sides.',
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
