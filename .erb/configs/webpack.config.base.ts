/**
 * Base webpack config used across other specific configs
 */

import webpack from 'webpack'
import TsconfigPathsPlugins from 'tsconfig-paths-webpack-plugin'
import webpackPaths from './webpack.paths'
import { dependencies as externals } from '../../release/app/package.json'

const configuration: webpack.Configuration = {
  externals: [...Object.keys(externals || {})],

  stats: 'errors-only',

  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: [/node_modules/, /\.d\.ts$/],
        use: {
          loader: 'ts-loader',
          options: {
            // Remove this line to enable type checking in webpack builds
            transpileOnly: true,
            compilerOptions: {
              module: 'esnext',
            },
          },
        },
      },
      // Special rule for mermaid to transpile static blocks
      {
        test: /\.m?js$/,
        include: /node_modules\/mermaid/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  chrome: '58',
                  firefox: '60',
                  safari: '11',
                  edge: '16',
                  ios: '11',
                  android: '67'
                }
              }]
            ],
            plugins: [
              '@babel/plugin-transform-class-static-block'
            ]
          }
        }
      },
    ],
  },

  output: {
    path: webpackPaths.srcPath,
    // https://github.com/webpack/webpack/issues/1114
    library: {
      type: 'commonjs2',
    },
  },

  /**
   * Determine the array of extensions that should be used to resolve modules.
   */
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [webpackPaths.srcPath, 'node_modules'],
    // There is no need to add aliases here, the paths in tsconfig get mirrored
    plugins: [new TsconfigPathsPlugins()],
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
      CHATBOX_BUILD_TARGET: 'unknown',
      CHATBOX_BUILD_PLATFORM: 'unknown',
      USE_LOCAL_API: '',
    }),
  ],
}

export default configuration
