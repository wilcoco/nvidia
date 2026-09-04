import { useEffect, useRef, useState } from 'react'
import * as store from './store'
import { ErrorNotice, useAction } from './ui'

/** Selecting an existing execution never creates or retires a run. */
export default function RunPicker({onOpened}: {onOpened?: () => void}) {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<store.ProcessRun[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const action = useAction()
  const current = window.Understudy.currentRunId?.()
  const load = async (before?: string) => {
    const seq = ++request.current
    setLoading(true); setError('')
    try {
      const page = await store.listRuns(undefined, {before, limit: 10})
      if (seq !== request.current) return
      const visiblePage = page.filter((run) => !store.isQualityAssuranceArtifact(run.title))
      setRuns(previous => before ? [...previous, ...visiblePage.filter(r => !previous.some(p => p.id === r.id))] : visiblePage)
      setHasMore(page.length === 10)
    } catch (err) { if (seq === request.current) setError(err instanceof Error ? err.message : 'Could not load executions.') }
    finally { if (seq === request.current) setLoading(false) }
  }
  useEffect(() => {
    if (!open) return
    void load()
    const refresh = () => void load()
    window.addEventListener('focus', refresh)
    return () => { request.current++; window.removeEventListener('focus', refresh) }
  }, [open])
  return <details className="recent-runs" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Choose an existing run</summary>
    <p className="meta">Open saved work and its latest evidence. This keeps other executions and their pending reviews.</p>
    <button className="ghost" disabled={loading || action.busy} onClick={() => void load()}>Refresh run list</button>
    <ErrorNotice message={error || action.error} />
    {loading && <p role="status" className="meta">Loading latest executions…</p>}
    {runs.map(run => <button key={run.id} className="secondary" disabled={loading || action.busy || run.status === 'abandoned'}
      onClick={() => void action.run(async () => { await store.followPlaybook(run.processId, {run}); setOpen(false); onOpened?.() })}>
      {run.title} · #{run.id} · {run.status}{run.id === current ? ' · current' : ''}
    </button>)}
    {!loading && !error && runs.length === 0 && <p className="meta">No saved executions yet.</p>}
    {hasMore && <button disabled={loading || action.busy} onClick={() => void load(runs[runs.length - 1]?.id)}>Load earlier runs</button>}
  </details>
}
