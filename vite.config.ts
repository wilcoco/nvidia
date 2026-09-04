import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { versionSdkScripts } from './scripts/sdk-url.mjs'

const build =
  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ??
  process.env.GIT_SHA?.slice(0, 7) ??
  'dev'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'understudy-sdk-release-url',
      transformIndexHtml: html => versionSdkScripts(html, build),
      closeBundle() {
        // Files copied from public/ do not pass through transformIndexHtml.
        // Stamp the framework-free host too so both demos reload one SDK.
        const plain = resolve(process.cwd(), 'dist/plain.html')
        if (existsSync(plain)) writeFileSync(plain, versionSdkScripts(readFileSync(plain, 'utf8'), build))
      },
    },
  ],
  define: { __BUILD__: JSON.stringify(build) },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
