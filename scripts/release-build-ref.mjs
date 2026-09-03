const FULL_SHA = /^[0-9a-f]{40}$/
const SHORT_SHA = /^[0-9a-f]{7}$/

export function validateBuildRef(value, label = 'build reference') {
  const ref = String(value ?? '').trim()
  if (!SHORT_SHA.test(ref) && !FULL_SHA.test(ref)) {
    throw new Error(`${label} must be exactly 7 or 40 lowercase hexadecimal characters.`)
  }
  return ref
}

export function buildRefMatchesCommit(commit, value, label = 'build reference') {
  const exactCommit = String(commit ?? '').trim()
  if (!FULL_SHA.test(exactCommit)) {
    throw new Error('Git commit must be an exact 40-character lowercase hexadecimal SHA.')
  }
  const ref = validateBuildRef(value, label)
  return ref.length === 40 ? ref === exactCommit : ref === exactCommit.slice(0, 7)
}
