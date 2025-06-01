/**
 * Webpack config for production electron main process
 */

import path from 'path'
import webpack from 'webpack'
import { merge } from 'webpack-merge'
import TerserPlugin from 'terser-webpack-plugin'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import baseConfig from './webpack.config.base.ts'
import webpackPaths from './webpack.paths'
import checkNodeEnv from '../scripts/check-node-env'
import deleteSourceMaps from '../scripts/delete-source-maps'
import JavaScriptObfuscator from 'webpack-obfuscator'

checkNodeEnv('production')
deleteSourceMaps()

const configuration: webpack.Configuration = {
    devtool: false,

    mode: 'production',

    target: 'electron-main',

    entry: {
        main: path.join(webpackPaths.srcMainPath, 'main.ts'),
        preload: path.join(webpackPaths.srcMainPath, 'preload.ts'),
    },

    output: {
        path: webpackPaths.distMainPath,
        filename: '[name].js',
        library: {
            type: 'umd',
        },
    },

    optimization: {
        minimizer: [
            new TerserPlugin({
                parallel: true,
            }),
        ],
    },

    plugins: [
        new BundleAnalyzerPlugin({
            analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
            analyzerPort: 8888,
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
            NODE_ENV: 'production',
            DEBUG_PROD: false,
            START_MINIMIZED: false,
        }),

        new webpack.DefinePlugin({
            'process.type': '"browser"',
        }),

        new JavaScriptObfuscator({
            target: 'node',
            optionsPreset: 'default',
            // 默认的变量名混淆，可能被误报为恶意代码
            identifierNamesGenerator: 'mangled-shuffled',
        }),
    ],

    /**
     * Disables webpack processing of __dirname and __filename.
     * If you run the bundle in node.js it falls back to these values of node.js.
     * https://github.com/webpack/webpack/issues/2010
     */
    node: {
        __dirname: false,
        __filename: false,
    },
}

export default merge(baseConfig, configuration)
