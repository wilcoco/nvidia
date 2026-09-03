import { useState } from 'react'
import * as store from './store'
import { ErrorNotice, useAction } from './ui'

export default function SuggestionCard({ includeCandidates = false }: { includeCandidates?: boolean }) {
  const action = useAction()
  const matches = store.computeMatches().filter((m) => m.tier === 'strong' || includeCandidates).slice(0, 2)
  const [followedId, setFollowedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; map: UnderstudyProcessMap } | null>(null)
  if (matches.length === 0) return null
  return (
    <div className="card suggestion">
      <div className="entry-head">
        <span className="task">
          📋 {matches.length > 1 ? `${matches.length} related playbooks found — pick one` : 'Related playbook found'}
        </span>
      </div>
      {matches.map((m) => (
        <div key={m.processId} className="suggestion-item">
          <div className="entry-head">
            <span className="suggestion-title">
              {m.title} <span className="version-tag">v{m.version}</span>
            </span>
              <span className="confidence">{m.tier === 'candidate' ? 'Check whether it fits' : 'Related to your work'}</span>
          </div>
          <div className="meta">Suggested because: {m.reasons.join(' · ')}{m.tier === 'candidate' ? '. Check its steps and conditions before choosing it.' : ''}</div>
          <div className="decide">
            <button disabled={action.busy} aria-expanded={preview?.id === m.processId} onClick={() => {
              if (preview?.id === m.processId) { setPreview(null); return }
              void action.run(async () => { const p = await store.getProcess(m.processId); setPreview({id: p.id, map: p.map as UnderstudyProcessMap}) })
            }}>{preview?.id === m.processId ? 'Hide preview' : 'Preview steps'}</button>
            <button
              className="primary"
              onClick={() => {
                void action.run(async () => {
                  await store.followPlaybook(m.processId)
                  setFollowedId(m.processId)
                  setTimeout(() => setFollowedId(null), 2500)
                })
              }}
              disabled={action.busy}
            >
              {followedId === m.processId ? '✓ Loaded — see the panel →' : 'Follow this playbook'}
            </button>
            <button
              className="ghost"
              data-flow-ignore
              onClick={() => store.dismissSuggestion(m.processId, 'not relevant to this work')}
            >
              Not relevant
            </button>
          </div>
          {preview?.id === m.processId && <div className="suggestion-preview">
            <p className="meta">Applies when: {Object.entries(preview.map.appliesWhen ?? {}).filter(([key]) => key !== 'keywords').map(([key, value]) => `${key}: ${String(value)}`).join(' · ') || 'Ask your agent to confirm the fit.'}</p>
            <ol>{preview.map.steps.map((step) => <li key={step.id}><b>{step.label}</b>{step.role && ` · ${step.role}`}{step.detail && <p className="meta">{step.detail}</p>}{step.next?.filter((edge) => edge.condition).map((edge) => <p className="meta" key={edge.to}>{edge.condition} → {preview.map.steps.find((target) => target.id === edge.to)?.label ?? edge.to}</p>)}</li>)}</ol>
          </div>}
        </div>
      ))}
      <ErrorNotice message={action.error} />
    </div>
  )
}
