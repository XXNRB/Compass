import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      // Forward /api to the backend so the frontend never hardcodes a port and
      // cookies stay same-origin. Override with VITE_API_TARGET if needed.
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },
  }
})
