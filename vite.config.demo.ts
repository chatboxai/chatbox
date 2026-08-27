import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rendererRoot = path.resolve(__dirname, 'src/renderer')
const demoRoot = path.resolve(rendererRoot, 'marketing-demo')
const demoPlatform = path.resolve(demoRoot, 'demo-platform.ts')
const demoApplication = path.resolve(demoRoot, 'demo-application.ts')
const demoDevTools = path.resolve(demoRoot, 'demo-dev-tools.ts')

export default defineConfig({
  root: demoRoot,
  base: process.env.NODE_ENV === 'production' ? '/demo/' : '/',
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/app\/renderer-application$/, replacement: demoApplication },
      { find: path.resolve(rendererRoot, 'app/renderer-application.ts'), replacement: demoApplication },
      { find: /^@\/platform$/, replacement: demoPlatform },
      { find: path.resolve(rendererRoot, 'platform/index.ts'), replacement: demoPlatform },
      { find: './dev/devToolsConfig', replacement: demoDevTools },
      { find: '@/dev/devToolsConfig', replacement: demoDevTools },
      { find: '@', replacement: rendererRoot },
      { find: '@shared', replacement: path.resolve(__dirname, 'src/shared') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: process.env.DEV_HOST || '0.0.0.0',
    port: Number(process.env.DEMO_PORT) || 1213,
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
  define: {
    'process.type': '"renderer"',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.CHATBOX_BUILD_TARGET': JSON.stringify('unknown'),
    'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify('web'),
    'process.env.USE_LOCAL_API': JSON.stringify(''),
    'process.env.USE_BETA_API': JSON.stringify(''),
    'process.env.USE_NEWDB_API': JSON.stringify(''),
    'process.env.USE_LOCAL_CHATBOX': JSON.stringify(''),
    'process.env.USE_BETA_CHATBOX': JSON.stringify(''),
  },
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.js'),
  },
  optimizeDeps: {
    include: ['@mantine/core', '@mantine/hooks', 'mermaid'],
  },
  build: {
    outDir: path.resolve(__dirname, 'release/app/dist/renderer/demo'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
})
