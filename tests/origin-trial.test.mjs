import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const expectedOrigin='https://nvidia-production-f205.up.railway.app:443'
for (const file of ['index.html','public/plain.html']) test(`${file} carries the WebMCP origin-trial token`,()=>{
  const html=fs.readFileSync(file,'utf8')
  const token=html.match(/<meta\s+http-equiv=["']origin-trial["']\s+content=["']([^"']+)/i)?.[1]
  assert.ok(token,'origin-trial meta tag is missing')
  const decoded=Buffer.from(token,'base64').toString('utf8')
  const marker=decoded.indexOf('{"origin"')
  assert.ok(marker>=0,'token payload is not readable')
  const json=JSON.parse(decoded.slice(marker))
  assert.equal(json.origin,expectedOrigin)
  assert.equal(json.feature,'WebMCP')
  assert.ok(json.expiry>=Date.UTC(2026,10,17)/1000)
})
