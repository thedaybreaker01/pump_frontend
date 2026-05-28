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
      '/tokens-batch': 'http://127.0.0.1:8090',
      '/tokens': 'http://127.0.0.1:8090',
      '/trades': 'http://127.0.0.1:8090',
      '/signals': 'http://127.0.0.1:8090',
      '/a-tokens': 'http://127.0.0.1:8090',
      '/l-tokens': 'http://127.0.0.1:8090',
      '/health': 'http://127.0.0.1:8090',
    },
  },
})
