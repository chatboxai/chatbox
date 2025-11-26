/**
 * Builds the DLL for development electron renderer process
 */

import webpack from 'webpack'
import path from 'path'
import { merge } from 'webpack-merge'
import baseConfig from './webpack.config.base'
import webpackPaths from './webpack.paths'
import { dependencies } from '../../package.json'
import checkNodeEnv from '../scripts/check-node-env'

checkNodeEnv('development')

const EXCLUDE_MODULES = new Set([
    '@modelcontextprotocol/sdk', // avoid `Package path . is not exported from package` error
    '@mastra/core',
    '@mastra/rag',
    '@libsql/client',
    'capacitor-stream-http', // local file dependency
  ])

const dist = webpackPaths.dllPath

const configuration: webpack.Configuration = {
  context: webpackPaths.rootPath,

  devtool: 'eval',

  mode: 'development',

  target: 'electron-renderer',

  externals: ['fsevents', 'crypto-browserify'],

  /**
   * Use `module` from `webpack.config.renderer.dev.js`
   */
  module: require('./webpack.config.renderer.dev').default.module,

  entry: {
    renderer: Object.keys(dependencies || {}).filter((dependency) => !EXCLUDE_MODULES.has(dependency)),
  },

  output: {
    path: dist,
    filename: '[name].dev.dll.js',
    library: {
      name: 'renderer',
      type: 'var',
    },
  },

  plugins: [
    new webpack.DllPlugin({
      path: path.join(dist, '[name].json'),
      name: '[name]',
    }),

    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
    }),

    new webpack.LoaderOptionsPlugin({
      debug: true,
      options: {
        context: webpackPaths.srcPath,
        output: {
          path: webpackPaths.dllPath,
        },
      },
    }),
  ],
}

export default merge(baseConfig, configuration)
