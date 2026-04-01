import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function listRendererFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      return listRendererFiles(fullPath)
    }

    if (!fullPath.endsWith('.tsx')) {
      return []
    }

    return [fullPath]
  })
}

describe('vaul drawer accessibility boundaries', () => {
  it('uses AccessibleDrawerContent instead of raw Drawer.Content in renderer components', () => {
    const drawerContentOffenders = listRendererFiles(rendererRoot)
      .filter((filePath) => !filePath.endsWith('AccessibleDrawerContent.tsx'))
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('Drawer.Content'))
      .map((filePath) => relative(rendererRoot, filePath))

    expect(drawerContentOffenders).toEqual([])
  })
})
