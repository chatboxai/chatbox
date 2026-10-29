import { readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../release/app/dist/', import.meta.url))

function removeSourceMaps(directory) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) removeSourceMaps(target)
    else if (entry.isFile() && entry.name.endsWith('.js.map')) unlinkSync(target)
  }
}

for (const target of ['main', 'preload', 'renderer']) removeSourceMaps(path.join(dist, target))
