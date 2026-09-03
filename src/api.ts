const TOKEN_KEY = 'linepulse-token'

// The in-memory copy is the source of truth: some embedded browsers
// (e.g. ChatGPT's in-app browser) block localStorage writes, which would
// otherwise lose the session right after a successful login. localStorage
// is best-effort persistence across reloads where available.
let memToken: string | null = null

export function getToken(): string | null {
  if (memToken) return memToken
  try {
    memToken = localStorage.getItem(TOKEN_KEY)
  } catch {
    /* storage unavailable */
  }
  return memToken
}

export function setToken(token: string | null): void {
  memToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable — memory token still carries the session */
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { detail?: string; error?: string }).detail ?? (data as { error?: string }).error ?? res.statusText)
  return data as T
}
