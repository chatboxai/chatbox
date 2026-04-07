import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/apps/spotify/',
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
