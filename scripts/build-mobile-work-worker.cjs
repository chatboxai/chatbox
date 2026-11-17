const fs = require('node:fs')
const path = require('node:path')

function buildWorkModeWorker() {
  const projectRoot = path.resolve(__dirname, '..')
  const resolve = (name) => require.resolve(name, { paths: [projectRoot] })
  const esbuild = require(resolve('esbuild'))
  const result = esbuild.buildSync({
    entryPoints: [path.join(projectRoot, 'src/shared/mobile-work/worker/entry.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2022'],
    minify: true,
    write: false,
    legalComments: 'inline',
    alias: { exceljs: resolve('exceljs/dist/exceljs.min.js') },
  })
  const source = result.outputFiles[0].text
  const target = path.join(projectRoot, 'src/shared/mobile-work/generated/worker-source.ts')
  const content = `export const workerSource = ${JSON.stringify(source)}\n`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) fs.writeFileSync(target, content)
  return { path: target, bytes: Buffer.byteLength(source) }
}

module.exports = { buildWorkModeWorker }
if (require.main === module) console.log(buildWorkModeWorker())
