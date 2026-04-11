import { rimrafSync } from 'rimraf'
import path from 'path'
import webpackPaths from '../configs/webpack.paths'

rimrafSync(path.join(webpackPaths.distMainPath, '*.js.map'), { glob: true })
rimrafSync(path.join(webpackPaths.distRendererPath, '*.js.map'), { glob: true })
rimrafSync(path.join(webpackPaths.distPath, 'preload', '*.js.map'), { glob: true })
