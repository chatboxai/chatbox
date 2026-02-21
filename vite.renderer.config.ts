import { sentryVitePlugin } from '@sentry/vite-plugin'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

function injectBaseTag(): Plugin {
  return {
    name: 'inject-base-tag',
    transformIndexHtml() {
      return [
        {
          tag: 'base',
          attrs: { href: '/' },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

function dvhToVh(): Plugin {
  return {
    name: 'dvh-to-vh',
    transform(code, id) {
      if (id.endsWith('.css') || id.endsWith('.scss') || id.endsWith('.sass')) {
        return {
          code: code.replace(/(\\d+)dvh/g, '$1vh'),
          map: null,
        }
      }
      return null
    },
  }
}

const inferredRelease = process.env.SENTRY_RELEASE || process.env.npm_package_version || '0.0.0'
const inferredDist = process.env.SENTRY_DIST || undefined

process.env.SENTRY_RELEASE = inferredRelease
if (inferredDist) {
  process.env.SENTRY_DIST = inferredDist
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'
  const isWeb = process.env.CHATBOX_BUILD_PLATFORM === 'web'
  const rendererRoot = path.resolve(__dirname, 'src/renderer')

  return {
    root: rendererRoot,
    resolve: {
      alias: {
        '@': rendererRoot,
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
      outDir: path.resolve(__dirname, 'release/app/dist/renderer'),
      target: 'es2020',
      sourcemap: isProduction ? 'hidden' : true,
      minify: isProduction ? 'esbuild' : false,
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
      postcss: path.resolve(__dirname, 'postcss.config.js'),
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
      'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
      'process.env.USE_BETA_API': JSON.stringify(process.env.USE_BETA_API || ''),
    },
    optimizeDeps: {
      include: ['mermaid'],
      esbuildOptions: {
        target: 'es2015',
      },
    },
  }
})
