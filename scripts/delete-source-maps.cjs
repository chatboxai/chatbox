const fs = require('fs')
const path = require('path')

const OUTPUT_DIRS = [
  path.resolve(process.cwd(), 'release/app/dist/renderer'),
  path.resolve(process.cwd(), 'release/app/dist'),
]

function removeMaps(dir) {
  if (!fs.existsSync(dir)) {
    return 0
  }

  let removed = 0
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      removed += removeMaps(fullPath)
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.map')) {
      fs.unlinkSync(fullPath)
      removed += 1
    }
  }

  return removed
}

let totalRemoved = 0
for (const dir of OUTPUT_DIRS) {
  totalRemoved += removeMaps(dir)
}

if (totalRemoved > 0) {
  console.log(`[delete-source-maps] removed ${totalRemoved} sourcemap file(s)`)
}
