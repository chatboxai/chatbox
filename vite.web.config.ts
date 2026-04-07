/**
 * Vite config for building only the renderer (web frontend) in Docker.
 *
 * electron-vite builds main + preload + renderer in sequence, but the main
 * build fails in Docker because Electron native deps are skipped (--ignore-scripts).
 * We only need the renderer for the web deployment, so this config extracts just
 * that part from electron.vite.config.ts.
 */
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'
import { dvhToVh, injectBaseTag, injectReleaseDate, replacePlausibleDomain } from './electron.vite.config'

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      'src/shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: path.resolve(__dirname, 'src/renderer/routes'),
      generatedRouteTree: path.resolve(__dirname, 'src/renderer/routeTree.gen.ts'),
    }),
    react({}),
    dvhToVh(),
    injectBaseTag(),
    injectReleaseDate(),
    replacePlausibleDomain(),
    visualizer({
      filename: path.resolve(__dirname, 'release/app/dist/renderer/stats.html'),
      open: false,
      title: 'Renderer Process Dependency Analysis',
    }),
  ],
  build: {
    outDir: path.resolve(__dirname, 'release/app/dist/renderer'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: 'hidden',
    minify: 'esbuild',
    commonjsOptions: {
      // Ensure commonjs modules in node_modules at project root are found
      include: [/node_modules/],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'js/[name].[hash].js',
        chunkFileNames: 'js/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'styles/[name].[hash][extname]'
          }
          if (/\.(woff|woff2|eot|ttf|otf)$/i.test(assetInfo.name || '')) {
            return 'fonts/[name].[hash][extname]'
          }
          if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(assetInfo.name || '')) {
            return 'images/[name].[hash][extname]'
          }
          return 'assets/[name].[hash][extname]'
        },
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@ai-sdk') || id.includes('ai/')) {
              return 'vendor-ai'
            }
            if (id.includes('@mantine') || id.includes('@tabler')) {
              return 'vendor-ui'
            }
            if (id.includes('mermaid') || id.includes('d3')) {
              return 'vendor-charts'
            }
          }
        },
      },
    },
  },
  css: {
    modules: {
      generateScopedName: '[name]__[local]___[hash:base64:5]',
    },
    postcss: path.resolve(__dirname, 'postcss.config.cjs'),
  },
  define: {
    'process.type': '"renderer"',
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.CHATBOX_BUILD_TARGET': JSON.stringify(process.env.CHATBOX_BUILD_TARGET || 'unknown'),
    'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify('web'),
    'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify(process.env.CHATBOX_BUILD_CHANNEL || 'unknown'),
    'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
    'process.env.USE_BETA_API': JSON.stringify(process.env.USE_BETA_API || ''),
  },
})
