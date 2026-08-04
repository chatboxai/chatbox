/**
 * Standalone Vite config for web-only development.
 *
 * Usage:
 *   npx vite --config vite.config.web.ts
 *
 * This starts the renderer dev server on http://localhost:1212 and LAN IPs without
 * launching Electron, which is useful for:
 *   - Headless / CI environments where Electron cannot run
 *   - Faster iteration on renderer-only changes
 *   - Web platform testing
 *
 * It reuses the same plugins and settings as the renderer section in
 * electron.vite.config.ts to keep behavior consistent.
 */

import path from 'node:path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import packageJson from './package.json'
import { dvhToVh, injectBaseTag } from './electron.vite.config'

export default defineConfig({
  root: 'src/renderer',
  plugins: [
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/renderer/routes',
      generatedRouteTree: './src/renderer/routeTree.gen.ts',
    }),
    react({}),
    dvhToVh(),
    injectBaseTag(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    host: process.env.DEV_HOST || '0.0.0.0',
    port: Number(process.env.DEV_PORT) || 1212,
  },
  define: {
    'process.type': '"renderer"',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.CHATBOX_BUILD_TARGET': JSON.stringify(process.env.CHATBOX_BUILD_TARGET || 'unknown'),
    'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify('web'),
    'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
    'process.env.USE_BETA_API': JSON.stringify(process.env.USE_BETA_API || ''),
    'process.env.USE_NEWDB_API': JSON.stringify(process.env.USE_NEWDB_API || ''),
    'process.env.USE_LOCAL_CHATBOX': JSON.stringify(process.env.USE_LOCAL_CHATBOX || ''),
    'process.env.USE_BETA_CHATBOX': JSON.stringify(process.env.USE_BETA_CHATBOX || ''),
    // Sidebar footer About badge: prefer CI-injected build number, fall back to
    // the package version so the badge always shows something in web builds.
    'process.env.CHATBOX_BUILD_NUMBER': JSON.stringify(
      process.env.CHATBOX_BUILD_NUMBER || packageJson.version
    ),
  },
  css: {
    modules: {
      generateScopedName: '[name]__[local]___[hash:base64:5]',
    },
    postcss: './postcss.config.cjs',
  },
  optimizeDeps: {
    include: ['mermaid'],
    esbuildOptions: {
      target: 'es2015',
    },
  },
})
