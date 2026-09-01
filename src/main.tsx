import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import * as store from './store'

window.FlowCatch.init({
  appName: 'LinePulse — Shift Worklog & Approvals',
  // LinePulse emits its own semantic journal entries via FlowCatch.log,
  // so automatic click capture is limited to navigation.
  autoCapture: 'min',
  stateProvider: () => {
    const s = store.getState()
    return {
      currentUser: s.currentUser,
      users: store.USERS,
      worklogs: s.worklogs,
      approvals: s.approvals,
    }
  },
  actions: [
    {
      name: 'create_worklog',
      description:
        'Create a draft shift worklog entry (as the current user). Returns the new worklog including its id.',
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
        approver: { type: 'string', description: 'Approver user id (default "lee")' },
      },
      handler: (p) => store.requestApproval(String(p.worklogId), String(p.approver ?? 'lee')),
    },
    {
      name: 'approve_request',
      description: 'Approve a pending approval request (only meaningful when the current user is the approver).',
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
      name: 'switch_user',
      description: 'Switch the demo session to another user (kim = line worker, lee = team lead).',
      params: { userId: { type: 'string', required: true } },
      handler: (p) => {
        store.switchUser(String(p.userId))
        return { currentUser: store.getState().currentUser }
      },
    },
  ],
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
