/**
 * Generates src/renderer/routeTree.gen.ts outside of a Vite run.
 *
 * The route tree is gitignored and normally produced by the TanStackRouterVite
 * plugin during dev/build/test. `pnpm check` has no Vite run, so without this
 * the type check fails on a missing module plus one error per route file — the
 * reason CI's type-check step used to be non-blocking. Keep the options in sync
 * with the plugin config in electron.vite.config.ts and vitest.config.ts.
 *
 * @tanstack/router-generator is a dependency of @tanstack/router-plugin and
 * resolves from the root node_modules because .npmrc pins node-linker=hoisted.
 */
import { generator, getConfig } from '@tanstack/router-generator'

const root = process.cwd()

const config = await getConfig(
  {
    target: 'react',
    autoCodeSplitting: true,
    routesDirectory: './src/renderer/routes',
    generatedRouteTree: './src/renderer/routeTree.gen.ts',
  },
  root
)

await generator(config, root)
