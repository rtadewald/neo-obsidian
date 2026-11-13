import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: o front roda na 5180 e manda /api para o backend (uv run jarvis, porta 8740).
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8740' } },
})
