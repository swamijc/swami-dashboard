import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: true,   // allows Cloudflare Tunnel and any external proxy
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        credentials: true,
      }
    }
  }
})
