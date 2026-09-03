# Understudy release manifest — c9716f9

- Recorded at: 2026-09-03T23:55:47.404Z
- Git commit / origin/main: `c9716f910e0b0b0e4f349b9322d9f77c5d321dad`
- Live URL: https://nvidia-production-f205.up.railway.app
- Live build marker: `c9716f9`
- Qualification run: #53 on build `c9716f9`
- Qualification review: #64
- Run matches release build: YES
- Demo video: https://youtu.be/kKhdmuNePNM
- Video-recorded build: `1a9140b`
- Validation: R8 exact-source: base 70/70; strict Chrome 1/1; safety 4/4; rendered-v7 1/1; registration 8/8 across 20 tools; HTTP 6/6; parallel 4/4; required PostgreSQL CI 77/77 PASS

## Exact live artifacts

- `index.html`: `bbc491ca63f7a12cc3be565cdfffefff8a2cb09da5b79c67212ec7eae0f8fa06`
- `/assets/index-C72F_oW_.js`: `1f95b8e10b123895939f076c71939d259e34fd044b35fd0940de9a623378e252`
- `/understudy.js`: `2f712d4a4ab2a1cf54397a6ce8dfa3a1fb4e6c8ee2620ca6cac183895288ebc2`

## Evidence boundary

- PostgreSQL, a physical phone, and an external WebMCP client count only when their dedicated evidence folders contain a dated result.
- A 375px browser viewport and `window.__understudy` do not count as physical-mobile or external-client evidence.
- Hard reload the judging tab after deployment before comparing the on-screen build or starting a qualification run.
