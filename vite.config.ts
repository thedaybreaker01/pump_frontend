import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8081,
    strictPort: true,
    host: true,
    proxy: {
      '/tokens-batch': 'http://127.0.0.1:8080',
      '/tokens': 'http://127.0.0.1:8080',
      '/trades': 'http://127.0.0.1:8080',
      '/health': 'http://127.0.0.1:8080',
    },
  },
})
