import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import * as store from './store'

window.Understudy.init({
  appName: 'LinePulse — Shift Worklog & Approvals',
  // LinePulse emits its own semantic journal entries via Understudy.log,
  // so automatic click capture is limited to navigation.
  autoCapture: 'min',
  stateProvider: () => {
    const s = store.getState()
    return {
      loggedInAs: s.me,
      actingAs: s.actingAs,
      users: s.users,
      worklogs: s.worklogs,
      approvals: s.approvals,
      savedProcesses: s.processes,
    }
  },
  processStore: {
    save: async (map) => store.saveProcess(map as { title: string; steps: unknown[] }),
    list: () => store.listProcesses(),
    load: async (id) => {
      const p = await store.getProcess(id)
      return { map: p.map as never, title: p.title, createdBy: p.createdBy }
    },
  },
  actions: [
    {
      name: 'create_worklog',
      description:
        'Create a draft shift worklog entry (as the active persona). Returns the new worklog including its id.',
      params: {
        date: { type: 'string', description: 'YYYY-MM-DD', required: true },
        line: { type: 'string', description: 'Production line, e.g. "A" or "B"', required: true },
        task: { type: 'string', description: 'What was worked on', required: true },
        progressPct: { type: 'number', description: '0-100', required: true },
        hours: { type: 'number', description: 'Hours spent', required: true },
        note: { type: 'string', description: 'Issues or remarks' },
        urgent: { type: 'boolean', description: 'Flag for issues needing immediate attention' },
      },
      handler: (p) =>
        store.createWorklog({
          date: String(p.date),
          line: String(p.line),
          task: String(p.task),
          progressPct: Number(p.progressPct),
          hours: Number(p.hours),
          note: String(p.note ?? ''),
          urgent: Boolean(p.urgent),
        }),
    },
    {
      name: 'request_approval',
      description: 'Submit a draft worklog for approval by the team lead.',
      params: {
        worklogId: { type: 'string', required: true },
        approver: { type: 'string', description: 'Approver username (default "lee")' },
      },
      handler: (p) => store.requestApproval(String(p.worklogId), String(p.approver ?? 'lee')),
    },
    {
      name: 'approve_request',
      description: 'Approve a pending approval request (switch persona to the approver first).',
      params: {
        approvalId: { type: 'string', required: true },
        comment: { type: 'string' },
      },
      handler: (p) =>
        store.decideApproval(String(p.approvalId), 'APPROVED', p.comment ? String(p.comment) : undefined),
    },
    {
      name: 'reject_request',
      description: 'Reject a pending approval request with a comment explaining why.',
      params: {
        approvalId: { type: 'string', required: true },
        comment: { type: 'string', required: true },
      },
      handler: (p) => store.decideApproval(String(p.approvalId), 'REJECTED', String(p.comment ?? '')),
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
