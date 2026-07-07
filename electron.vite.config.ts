import path, { resolve } from 'node:path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { visualizer } from 'rollup-plugin-visualizer'
import type { Plugin } from 'vite'
import packageJson from './release/app/package.json'

/**
 * Vite plugin to inject the viewport meta content.
 * Omits `height=device-height` and `viewport-fit=cover` which trigger
 * Chromium's Virtual Keyboard API on macOS, causing an empty bottom margin on input focus.
 * See: https://github.com/workspaiceai/workspaice/issues/2023
 */
export function injectViewportContent(): Plugin {
  const content = 'width=device-width, initial-scale=1, user-scalable=no'
  return {
    name: 'inject-viewport-content',
    transformIndexHtml(html) {
      return html.replace('%VIEWPORT_CONTENT%', content)
    },
  }
}

/**
 * Vite plugin to inject the production Content-Security-Policy as a <meta>
 * tag at build time (desktop builds only).
 *
 * Why a meta tag: the packaged app loads the renderer via loadFile()
 * (file://), and the onHeadersReceived CSP header in src/main/main.ts never
 * applies there — file: responses carry no HTTP headers, so without this tag
 * the packaged renderer runs with NO CSP at all. Dev mode is served over
 * http://localhost:1212 and gets the (eval-permitting, HMR-compatible) header
 * CSP instead; this plugin is build-only so the two never overlap.
 *
 * Keep these directives in sync with the packaged-variant header CSP in
 * src/main/main.ts. Differences from the header version:
 * - no frame-ancestors: not enforceable via <meta> (Chromium ignores it with
 *   a console warning); the top-level BrowserWindow cannot be framed anyway.
 * - script-src uses 'wasm-unsafe-eval' (not 'unsafe-eval'): shiki's oniguruma
 *   WebAssembly engine needs wasm compilation, but eval()/new Function stay
 *   blocked (FABLE_REVIEW SEC-8).
 */
export function injectDesktopProdCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    'img-src * data: blob:',
    "font-src 'self' data:",
    'media-src * data: blob:',
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
  return {
    name: 'inject-desktop-prod-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

/**
 * Vite plugin to replace dvh units with vh units
 * This replaces the webpack string-replace-loader functionality
 */
export function dvhToVh(): Plugin {
  return {
    name: 'dvh-to-vh',
    transform(code, id) {
      if (id.endsWith('.css') || id.endsWith('.scss') || id.endsWith('.sass')) {
        return {
          code: code.replace(/(\d+)dvh/g, '$1vh'),
          map: null,
        }
      }
      return null
    },
  }
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    main: {
      plugins: [
        ...(isProduction
          ? [
              visualizer({
                filename: 'release/app/dist/main/stats.html',
                open: false,
                title: 'Main Process Dependency Analysis',
              }),
            ]
          : [externalizeDepsPlugin()]),
      ].filter(Boolean),
      build: {
        outDir: isProduction ? 'release/app/dist/main' : undefined,
        lib: {
          entry: resolve(__dirname, 'src/main/main.ts'),
        },
        sourcemap: isProduction ? 'hidden' : true,
        minify: isProduction,
        rollupOptions: {
          external: Object.keys(packageJson.dependencies || {}),
          output: {
            entryFileNames: '[name].js',
            inlineDynamicImports: true,
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src/renderer'),
          '@shared': path.resolve(__dirname, './src/shared'),
          'src/shared': path.resolve(__dirname, './src/shared'),
        },
      },
      define: {
        'process.type': '"browser"',
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      },
    },
    preload: {
      plugins: [
        visualizer({
          filename: 'release/app/dist/preload/stats.html',
          open: false,
          title: 'Preload Process Dependency Analysis',
        }),
      ],
      build: {
        outDir: isProduction ? 'release/app/dist/preload' : undefined,
        lib: {
          entry: resolve(__dirname, 'src/preload/index.ts'),
        },
        sourcemap: isProduction ? 'hidden' : true,
        minify: isProduction,
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src/renderer'),
          '@shared': path.resolve(__dirname, './src/shared'),
          'src/shared': path.resolve(__dirname, './src/shared'),
        },
      },
    },
    renderer: {
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src/renderer'),
          '@shared': path.resolve(__dirname, 'src/shared'),
        },
      },
      plugins: [
        TanStackRouterVite({
          target: 'react',
          autoCodeSplitting: true,
          routesDirectory: './src/renderer/routes',
          generatedRouteTree: './src/renderer/routeTree.gen.ts',
        }),
        react({}),
        dvhToVh(),
        injectViewportContent(),
        // Must come after the other head-prepend plugins: the last prepended
        // tag ends up first in <head>, and the CSP meta must precede every
        // script so all of them are governed by it.
        injectDesktopProdCsp(),
        visualizer({
          filename: 'release/app/dist/renderer/stats.html',
          open: false,
          title: 'Renderer Process Dependency Analysis',
        }),
      ].filter(Boolean),
      build: {
        outDir: isProduction ? 'release/app/dist/renderer' : undefined,
        target: 'es2020', // Avoid static initialization blocks for browser compatibility
        sourcemap: isProduction ? 'hidden' : true,
        minify: isProduction ? 'esbuild' : false, // Use esbuild for faster, less memory-intensive minification
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
            // Optimize chunk splitting to reduce memory usage during build
            manualChunks(id) {
              const normalizedId = id.split(path.sep).join('/')
              const isNodeModulePackage = (pkg: string) => normalizedId.includes(`/node_modules/${pkg}/`)

              if (normalizedId.includes('/node_modules/')) {
                // Split large vendor chunks
                if (isNodeModulePackage('@ai-sdk') || isNodeModulePackage('ai')) {
                  return 'vendor-ai'
                }
                if (isNodeModulePackage('@mantine') || isNodeModulePackage('@tabler')) {
                  return 'vendor-ui'
                }
                if (
                  isNodeModulePackage('mermaid') ||
                  isNodeModulePackage('d3') ||
                  /\/node_modules\/d3-[^/]+\//.test(normalizedId)
                ) {
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
        postcss: './postcss.config.cjs',
      },
      server: {
        port: Number(process.env.DEV_PORT) || 1212,
      },
      define: {
        'process.type': '"renderer"',
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      },
      optimizeDeps: {
        // Force a fresh dep optimization on dev startup. This avoids stale .vite
        // cache artifacts that intermittently break MUI internals after branch or
        // dependency changes with runtime errors like "createTheme_default is not a function".
        force: true,
        include: ['mermaid'],
        esbuildOptions: {
          target: 'es2015',
        },
      },
    },
  }
})
