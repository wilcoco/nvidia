import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const build =
  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ??
  process.env.GIT_SHA?.slice(0, 7) ??
  'dev'

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(build) },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
