import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API runs on :4000; proxying keeps the web app same-origin
// so the httpOnly refresh cookie (SameSite=Strict) works without CORS tricks.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
})
