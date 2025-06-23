import 'webpack-dev-server'
import path from 'path'
import fs from 'fs'
import webpack from 'webpack'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import chalk from 'chalk'
import { merge } from 'webpack-merge'
import { execSync, spawn } from 'child_process'
import ReactRefreshWebpackPlugin from '@pmmmwh/react-refresh-webpack-plugin'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import baseConfig from './webpack.config.base'
import webpackPaths from './webpack.paths'
import checkNodeEnv from '../scripts/check-node-env'
import { TanStackRouterWebpack } from '@tanstack/router-plugin/webpack'

// When an ESLint server is running, we can't set the NODE_ENV so we'll check if it's
// at the dev webpack config is not accidentally run in a production environment
if (process.env.NODE_ENV === 'production') {
  checkNodeEnv('development')
}

const port = process.env.PORT || 1212
const manifest = path.resolve(webpackPaths.dllPath, 'renderer.json')
const skipDLLs =
  module.parent?.filename.includes('webpack.config.renderer.dev.dll') ||
  module.parent?.filename.includes('webpack.config.eslint')

const DEV_WEB_ONLY = process.env.DEV_WEB_ONLY === 'true'

/**
 * Warn if the DLL is not built
 */
if (!skipDLLs && !(fs.existsSync(webpackPaths.dllPath) && fs.existsSync(manifest))) {
  console.log(
    chalk.black.bgYellow.bold(
      'The DLL files are missing. Sit back while we build them for you with "npm run build-dll"'
    )
  )
  execSync('npm run postinstall')
}

const configuration: webpack.Configuration = {
  devtool: 'inline-source-map',

  mode: 'development',

  target: ['web', 'electron-renderer'],

  entry: [
    `webpack-dev-server/client?http://localhost:${port}/dist`,
    'webpack/hot/only-dev-server',
    path.join(webpackPaths.srcRendererPath, 'index.tsx'),
  ],

  output: {
    path: webpackPaths.distRendererPath,
    publicPath: '/',
    filename: 'renderer.dev.js',
    library: {
      type: 'umd',
    },
  },

  module: {
    rules: [
      {
        test: /\.s?(c|a)ss$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              modules: true,
              sourceMap: true,
              importLoaders: 1,
            },
          },
          'sass-loader',
        ],
        include: /\.module\.s?(c|a)ss$/,
      },
      {
        test: /\.s?css$/,
        use: ['style-loader', 'css-loader', 'sass-loader', 'postcss-loader'],
        exclude: /\.module\.s?(c|a)ss$/,
        sideEffects: true,
      },
      // Fonts
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
      // Images
      {
        test: /\.(png|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
      // SVG
      {
        test: /\.svg$/,
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              prettier: false,
              svgo: false,
              svgoConfig: {
                plugins: [{ removeViewBox: false }],
              },
              titleProp: true,
              ref: true,
            },
          },
          'file-loader',
        ],
      },
    ],
  },
  plugins: [
    ...(skipDLLs
      ? []
      : [
          new webpack.DllReferencePlugin({
            context: webpackPaths.dllPath,
            manifest: require(manifest),
            sourceType: 'var',
          }),
        ]),

    new webpack.NoEmitOnErrorsPlugin(),

    TanStackRouterWebpack({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/renderer/routes',
      generatedRouteTree: './src/renderer/routeTree.gen.ts',
    }),

    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     *
     * By default, use 'development' as NODE_ENV. This can be overriden with
     * 'staging', for example, by changing the ENV variables in the npm scripts
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
    }),

    new webpack.LoaderOptionsPlugin({
      debug: true,
    }),

    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8889,
    }),

    new ReactRefreshWebpackPlugin(),

    new HtmlWebpackPlugin({
      filename: path.join('index.html'),
      template: path.join(webpackPaths.srcRendererPath, 'index.ejs'),
      minify: {
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        removeComments: true,
      },
      isBrowser: false,
      env: process.env.NODE_ENV,
      isDevelopment: process.env.NODE_ENV !== 'production',
      nodeModules: webpackPaths.appNodeModulesPath,
      favicon: path.join(webpackPaths.srcRendererPath, 'favicon.ico'),
    }),
  ],

  node: {
    __dirname: false,
    __filename: false,
  },

  devServer: {
    port,
    compress: true,
    hot: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    static: {
      publicPath: '/',
    },
    historyApiFallback: {
      verbose: true,
    },
    setupMiddlewares(middlewares) {
      console.log('Starting preload.js builder...')
      const preloadProcess = spawn('npm', ['run', 'start:preload'], {
        shell: true,
        stdio: 'inherit',
      })
        .on('close', (code: number) => process.exit(code!))
        .on('error', (spawnError) => console.error(spawnError))

      if (!DEV_WEB_ONLY) {
        console.log('Starting Main Process...')
        let args = ['run', 'start:main']
        if (process.env.MAIN_ARGS) {
          args = args.concat(['--', ...process.env.MAIN_ARGS.matchAll(/"[^"]+"|[^\s"]+/g)].flat())
        }
        spawn('npm', args, {
          shell: true,
          stdio: 'inherit',
        })
          .on('close', (code: number) => {
            preloadProcess.kill()
            process.exit(code!)
          })
          .on('error', (spawnError) => console.error(spawnError))
      }
      return middlewares
    },
  },
}

export default merge(baseConfig, configuration)
