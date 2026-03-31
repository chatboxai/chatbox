import { generator, getConfig } from '@tanstack/router-generator'

const config = getConfig(
  {
    target: 'react',
    autoCodeSplitting: true,
    routesDirectory: './src/renderer/routes',
    generatedRouteTree: './src/renderer/routeTree.gen.ts',
  },
  process.cwd()
)

await generator(config, process.cwd())
