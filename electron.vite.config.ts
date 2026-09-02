import path, { resolve } from 'node:path'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type ElectronViteConfig, externalizeDepsPlugin } from 'electron-vite'
import { visualizer } from 'rollup-plugin-visualizer'
import type { Plugin } from 'vite'
import packageJson from './release/app/package.json'
/**
 * Vite plugin to inject <base href="/"> for web builds
 * This ensures relative paths resolve correctly for SPA routes like /session/xxx
 */
export function injectBaseTag(): Plugin {
  return {
    name: 'inject-base-tag',
    transformIndexHtml() {
      return [
        {
          tag: 'base',
          attrs: { href: '/' },
          injectTo: 'head-prepend', // Inject at the beginning of <head>
        },
      ]
    },
  }
}

/**
 * Vite plugin to inject window.chatbox_release_date for web builds
 */
export function injectReleaseDate(): Plugin {
  const releaseDate = new Date().toISOString().slice(0, 10)
  return {
    name: 'inject-release-date',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          children: `window.chatbox_release_date="${releaseDate}";`,
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

/**
 * Vite plugin to replace Plausible data-domain for web builds
 */
export function replacePlausibleDomain(): Plugin {
  return {
    name: 'replace-plausible-domain',
    transformIndexHtml(html) {
      return html.replace('data-domain="app.chatboxai.app"', 'data-domain="web.chatboxai.app"')
    },
  }
}

/**
 * Vite plugin to inject platform-appropriate viewport meta content.
 * Desktop builds omit `height=device-height` and `viewport-fit=cover` which trigger
 * Chromium's Virtual Keyboard API on macOS, causing an empty bottom margin on input focus.
 * See: https://github.com/chatboxai/chatbox/issues/2023
 */
export function injectViewportContent(isDesktop: boolean): Plugin {
  const content = isDesktop
    ? 'width=device-width, initial-scale=1, user-scalable=no'
    : 'height=device-height, width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover'
  return {
    name: 'inject-viewport-content',
    transformIndexHtml(html) {
      return html.replace('%VIEWPORT_CONTENT%', content)
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

const electronViteBuildTargets = ['main', 'preload', 'renderer'] as const
type ElectronViteBuildTarget = (typeof electronViteBuildTargets)[number]

// Desktop production builds select one target per process so V8 can release the
// main/preload heaps before the much larger renderer bundle starts.
export function shouldBuildElectronViteTarget(
  target: ElectronViteBuildTarget,
  requestedTarget: string | undefined
): boolean {
  if (!requestedTarget) {
    return true
  }

  const resolvedTarget = electronViteBuildTargets.find((candidate) => candidate === requestedTarget)
  if (!resolvedTarget) {
    throw new Error(
      `Invalid CHATBOX_ELECTRON_VITE_TARGET "${requestedTarget}". Expected one of: ${electronViteBuildTargets.join(', ')}.`
    )
  }

  return resolvedTarget === target
}

// The index signature keeps `process.env` assignable (weak-type check).
export function getRendererDevServerConfig(env: {
  [key: string]: string | undefined
  CHATBOX_QA?: string
  DEV_PORT?: string
}): {
  port: number
  strictPort: boolean
} {
  const isQa = env.CHATBOX_QA === '1'
  if (isQa) {
    const port = env.DEV_PORT && /^\d+$/.test(env.DEV_PORT) ? Number(env.DEV_PORT) : Number.NaN
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('CHATBOX_QA=1 requires DEV_PORT with a port between 1 and 65535')
    }
    return { port, strictPort: true }
  }

  return {
    port: Number(env.DEV_PORT) || 1212,
    strictPort: false,
  }
}

const inferredRelease = process.env.SENTRY_RELEASE || packageJson.version
const inferredDist = process.env.SENTRY_DIST || undefined

process.env.SENTRY_RELEASE = inferredRelease
if (inferredDist) {
  process.env.SENTRY_DIST = inferredDist
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'
  const isWeb = process.env.CHATBOX_BUILD_PLATFORM === 'web'
  const isMobile = process.env.CHATBOX_BUILD_TARGET === 'mobile_app'
  const isDesktop = !isWeb && !isMobile
  const requestedTarget = process.env.CHATBOX_ELECTRON_VITE_TARGET
  const rendererDevServer = getRendererDevServerConfig(process.env)

  const config: ElectronViteConfig = {
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
        process.env.SENTRY_AUTH_TOKEN
          ? sentryVitePlugin({
              authToken: process.env.SENTRY_AUTH_TOKEN,
              org: 'sentry',
              project: 'chatbox',
              url: 'https://sentry.midway.run/',
              release: {
                name: inferredRelease,
                ...(inferredDist ? { dist: inferredDist } : {}),
              },
              sourcemaps: {
                assets: isProduction ? 'release/app/dist/main/**' : 'output/main/**',
              },
              telemetry: false,
            })
          : undefined,
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
        'process.env.CHATBOX_BUILD_TARGET': JSON.stringify(process.env.CHATBOX_BUILD_TARGET || 'unknown'),
        'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify(process.env.CHATBOX_BUILD_PLATFORM || 'unknown'),
        'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify(process.env.CHATBOX_BUILD_CHANNEL || 'unknown'),
        'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
        'process.env.USE_BETA_API': JSON.stringify(process.env.USE_BETA_API || ''),
        'process.env.USE_NEWDB_API': JSON.stringify(process.env.USE_NEWDB_API || ''),
        'process.env.USE_LOCAL_CHATBOX': JSON.stringify(process.env.USE_LOCAL_CHATBOX || ''),
        'process.env.USE_BETA_CHATBOX': JSON.stringify(process.env.USE_BETA_CHATBOX || ''),
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
        injectViewportContent(isDesktop),
        isWeb ? injectBaseTag() : undefined,
        injectReleaseDate(),
        isWeb ? replacePlausibleDomain() : undefined,
        visualizer({
          filename: 'release/app/dist/renderer/stats.html',
          open: false,
          title: 'Renderer Process Dependency Analysis',
        }),
        process.env.SENTRY_AUTH_TOKEN
          ? sentryVitePlugin({
              authToken: process.env.SENTRY_AUTH_TOKEN,
              org: 'sentry',
              project: 'chatbox',
              url: 'https://sentry.midway.run/',
              release: {
                name: inferredRelease,
                ...(inferredDist ? { dist: inferredDist } : {}),
              },
              sourcemaps: {
                assets: isProduction ? 'release/app/dist/renderer/**' : 'output/renderer/**',
              },
              telemetry: false,
            })
          : undefined,
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
                if (isNodeModulePackage('d3') || /\/node_modules\/d3-[^/]+\//.test(normalizedId)) {
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
        port: rendererDevServer.port,
        strictPort: rendererDevServer.strictPort,
        watch: {
          // The root .env is a 1Password-managed FIFO in local development. Vite
          // treats env file changes as a full server restart, which can interrupt
          // dependency scanning during startup and print noisy dep-scan failures.
          ignored: ['**/.env', '**/.env.*'],
        },
      },
      define: {
        'process.type': '"renderer"',
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        'process.env.CHATBOX_BUILD_TARGET': JSON.stringify(process.env.CHATBOX_BUILD_TARGET || 'unknown'),
        'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify(process.env.CHATBOX_BUILD_PLATFORM || 'unknown'),
        'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify(process.env.CHATBOX_BUILD_CHANNEL || 'unknown'),
        'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
        'process.env.USE_BETA_API': JSON.stringify(process.env.USE_BETA_API || ''),
        'process.env.USE_NEWDB_API': JSON.stringify(process.env.USE_NEWDB_API || ''),
        'process.env.USE_LOCAL_CHATBOX': JSON.stringify(process.env.USE_LOCAL_CHATBOX || ''),
        'process.env.USE_BETA_CHATBOX': JSON.stringify(process.env.USE_BETA_CHATBOX || ''),
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

  if (!requestedTarget) {
    return config
  }
  if (shouldBuildElectronViteTarget('main', requestedTarget)) {
    return { main: config.main }
  }
  if (shouldBuildElectronViteTarget('preload', requestedTarget)) {
    return { preload: config.preload }
  }
  return { renderer: config.renderer }
})
