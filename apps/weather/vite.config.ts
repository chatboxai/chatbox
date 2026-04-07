import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/apps/weather/',
  build: { outDir: 'dist' },
  server: {
    // Proxy /api calls to Express in dev so the iframe can fetch weather data
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
