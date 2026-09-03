import { useEffect, useRef, useState } from 'react'

/** Keep double clicks and failed requests from looking like successful work. */
export function useAction() {
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: () => unknown | Promise<unknown>): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      return false
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return { run, busy, error }
}

export function ErrorNotice({ message }: { message?: string }) {
  return message ? <p className="error-notice" role="alert">{message}</p> : null
}

export function useWorkspaceUpdates() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const update = () => setTick((n) => n + 1)
    window.addEventListener('understudy:mapchange', update)
    window.addEventListener('understudy:agent-state', update)
    window.addEventListener('understudy:run-state', update)
    return () => {
      window.removeEventListener('understudy:mapchange', update)
      window.removeEventListener('understudy:agent-state', update)
      window.removeEventListener('understudy:run-state', update)
    }
  }, [])
}

export function AgentInvite({ prompt, label = 'Copy message for your agent', hint = 'In your agent’s chat, ask “Help me turn this work into a playbook.” Its questions will appear here. The copy button adds the context for you.' }: { prompt: string; label?: string; hint?: string }) {
  const [copied, setCopied] = useState(false)
  const [fallback, setFallback] = useState(false)
  useEffect(() => { setCopied(false); setFallback(false) }, [prompt])
  return (
    <div className="agent-invite">
      <p>{hint}</p>
      <button className="primary" onClick={() => {
        void navigator.clipboard?.writeText(prompt).then(() => setCopied(true)).catch(() => setFallback(true))
        if (!navigator.clipboard) setFallback(true)
      }}>{copied ? 'Copied — paste into your chat' : label}</button>
      <details open={fallback || undefined}>
        <summary>{fallback ? 'Select and copy this message' : 'View message & connection help'}</summary>
        <p className="copy-text">{prompt}</p>
        <p className="meta">Use ChatGPT’s in-app browser, or a browser with WebMCP enabled and an agent attached. “WebMCP ready” means the page exposes tools; your agent still needs your message.</p>
      </details>
    </div>
  )
}
