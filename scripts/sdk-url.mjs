/** Stamp the SDK script with the same immutable release id as the app shell.
 * A changed query key forces an already-open browser to acquire the matching
 * SDK and replace its registered WebMCP provider after a deployment. */
export function versionSdkScripts(html, build) {
  const release = String(build || '').trim()
  if (!/^(?:dev|[0-9a-f]{7})$/.test(release))
    throw new Error(`SDK build must be "dev" or a seven-character lowercase SHA; got ${JSON.stringify(release)}`)
  return html.replace(
    /(<script\b[^>]*\bsrc=["'])\/understudy\.js(?:\?v=[^"']*)?(["'][^>]*>)/g,
    `$1/understudy.js?v=${release}$2`,
  )
}
