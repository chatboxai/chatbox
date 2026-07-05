// Removes hidden production sourcemaps (sourcemap: 'hidden' in
// electron.vite.config.ts) from release/app/dist before web/mobile bundles
// are shipped. Called by the delete-sourcemaps npm script.
const fs = require('fs')
const path = require('path')

const distRoot = path.join(__dirname, '..', '..', 'release', 'app', 'dist')

function deleteMapsRecursively(dir) {
  if (!fs.existsSync(dir)) return 0
  let deleted = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      deleted += deleteMapsRecursively(fullPath)
    } else if (entry.name.endsWith('.js.map') || entry.name.endsWith('.css.map')) {
      fs.unlinkSync(fullPath)
      deleted += 1
    }
  }
  return deleted
}

const deleted = deleteMapsRecursively(distRoot)
console.log(`delete-source-maps: removed ${deleted} sourcemap file(s) from ${distRoot}`)
