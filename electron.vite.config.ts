import { sentryVitePlugin } from '@sentry/vite-plugin'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import path, { resolve } from 'path'
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

const inferredRelease = process.env.SENTRY_RELEASE || packageJson.version
const inferredDist = process.env.SENTRY_DIST || undefined

process.env.SENTRY_RELEASE = inferredRelease
if (inferredDist) {
  process.env.SENTRY_DIST = inferredDist
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'
  const isWeb = process.env.CHATBOX_BUILD_PLATFORM === 'web'

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
        // After isolating locales, dev tools, tokenizer, markdown, and mermaid into their own chunks,
        // the remaining largest client bundle sits just under 1.9 MB. Keep the warning high enough to
        // avoid noise from those intentional boundaries while still surfacing future regressions above them.
        chunkSizeWarningLimit: 1900,
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

              if (normalizedId.endsWith('.css')) {
                return
              }

              const localeMatch = normalizedId.match(/\/src\/renderer\/i18n\/locales\/([^/]+)\//)
              if (localeMatch) {
                return `i18n-${localeMatch[1].replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`
              }

              const devRouteMatch = normalizedId.match(/\/src\/renderer\/routes\/dev\/([^/]+)\.tsx$/)
              if (devRouteMatch) {
                return `dev-${devRouteMatch[1].replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`
              }

              if (normalizedId.includes('/node_modules/')) {
                if (normalizedId.includes('/node_modules/@faker-js/faker/')) {
                  return 'vendor-faker'
                }

                if (normalizedId.includes('/node_modules/js-tiktoken/')) {
                  return 'vendor-tokenizer'
                }

                if (
                  normalizedId.includes('/node_modules/react-syntax-highlighter/') ||
                  normalizedId.includes('/node_modules/refractor/') ||
                  normalizedId.includes('/node_modules/micromark') ||
                  normalizedId.includes('/node_modules/mdast-util') ||
                  normalizedId.includes('/node_modules/remark-') ||
                  normalizedId.includes('/node_modules/rehype-')
                ) {
                  return 'vendor-markdown'
                }

                if (normalizedId.includes('/node_modules/katex/')) {
                  return 'vendor-math'
                }

                if (
                  normalizedId.includes('/node_modules/mermaid/') ||
                  normalizedId.includes('/node_modules/@mermaid-js/') ||
                  normalizedId.includes('/node_modules/dagre-d3-es/') ||
                  normalizedId.includes('/node_modules/roughjs/') ||
                  normalizedId.includes('/node_modules/khroma/') ||
                  normalizedId.includes('/node_modules/dompurify/')
                ) {
                  return 'vendor-mermaid'
                }

                if (
                  normalizedId.includes('/node_modules/cytoscape') ||
                  normalizedId.includes('/node_modules/layout-base/') ||
                  normalizedId.includes('/node_modules/cose-base/')
                ) {
                  return 'vendor-graph'
                }

                if (
                  normalizedId.includes('/node_modules/@ai-sdk/') ||
                  normalizedId.includes('/node_modules/ai/') ||
                  normalizedId.includes('/node_modules/@openrouter/ai-sdk-provider/') ||
                  normalizedId.includes('/node_modules/@modelcontextprotocol/sdk/')
                ) {
                  return 'vendor-ai-sdk'
                }

                if (normalizedId.includes('/node_modules/zod/')) {
                  return 'vendor-zod'
                }

                if (
                  normalizedId.includes('/node_modules/@mantine/') ||
                  normalizedId.includes('/node_modules/@floating-ui/')
                ) {
                  return 'vendor-mantine'
                }

                if (normalizedId.includes('/node_modules/@tabler/icons-react/')) {
                  return 'vendor-icons'
                }

                if (
                  normalizedId.includes('/node_modules/react-dom/') ||
                  normalizedId.includes('/node_modules/scheduler/')
                ) {
                  return 'vendor-react-dom'
                }

                if (normalizedId.includes('/node_modules/@mui/')) {
                  return 'vendor-mui'
                }

                if (normalizedId.includes('/node_modules/lodash')) {
                  return 'vendor-lodash'
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
        port: 1212,
        strictPort: true,
      },
      define: {
        'process.type': '"renderer"',
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        'process.env.CHATBOX_BUILD_TARGET': JSON.stringify(process.env.CHATBOX_BUILD_TARGET || 'unknown'),
        'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify(process.env.CHATBOX_BUILD_PLATFORM || 'unknown'),
        'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify(process.env.CHATBOX_BUILD_CHANNEL || 'unknown'),
        'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
        'process.env.USE_BETA_API': JSON.stringify(process.env.USE_BETA_API || ''),
        'process.env.USE_LOCAL_CHATBOX': JSON.stringify(process.env.USE_LOCAL_CHATBOX || ''),
        'process.env.USE_BETA_CHATBOX': JSON.stringify(process.env.USE_BETA_CHATBOX || ''),
      },
      optimizeDeps: {
        // Prebundle renderer-only deps that otherwise race cold dev startup.
        include: ['mermaid', 'chess.js'],
        esbuildOptions: {
          target: 'es2015',
        },
      },
    },
  }
})
