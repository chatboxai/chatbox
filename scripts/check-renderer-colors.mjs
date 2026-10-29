import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Renderer UI colors must come from the --chatbox-* tokens (Tailwind `chatbox-*` classes, Mantine `chatbox-*` colors,
// or `var(--chatbox-...)`) so light/dark themes and the user brand color stay consistent.
// Files that predate the rule are tracked in the baseline with their current count; the count may only go down.

export const RENDERER_DIR = 'src/renderer'
export const BASELINE_PATH = 'scripts/renderer-color-baseline.json'

const sourceExtensions = new Set(['.ts', '.tsx'])
const excludedFilePattern = /\.(test|spec|stories)\.tsx?$/
const excludedDirectories = new Set(['node_modules', '__tests__', 'stories'])

const palette =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const utilities =
  'bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|decoration|placeholder|caret|accent|shadow'

const colorPatterns = [
  { kind: 'hex', pattern: /(?<![A-Za-z0-9&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![A-Za-z0-9-])/g },
  { kind: 'rgb', pattern: /(?<![A-Za-z0-9])rgba?\(\s*\d/g },
  { kind: 'tailwind-palette', pattern: new RegExp(`\\b(?:${utilities})-(?:${palette})-\\d{2,3}\\b`, 'g') },
  { kind: 'mantine-palette', pattern: new RegExp(`\\b(?:c|color|bg)=["'](?:${palette}|dark)["']`, 'g') },
]

function toPosix(path) {
  return path.split(sep).join('/')
}

function walk(dirPath) {
  if (!existsSync(dirPath)) return []
  return readdirSync(dirPath).flatMap((entry) => {
    if (excludedDirectories.has(entry)) return []
    const fullPath = join(dirPath, entry)
    if (statSync(fullPath).isDirectory()) return walk(fullPath)
    const extension = entry.slice(entry.lastIndexOf('.'))
    return sourceExtensions.has(extension) && !excludedFilePattern.test(entry) ? [fullPath] : []
  })
}

export function countColorLiterals(source) {
  let count = 0
  for (const { pattern } of colorPatterns) {
    count += source.match(pattern)?.length ?? 0
  }
  return count
}

export function scanRendererColors(root) {
  const counts = {}
  for (const filePath of walk(join(root, RENDERER_DIR))) {
    const count = countColorLiterals(readFileSync(filePath, 'utf8'))
    if (count > 0) counts[toPosix(relative(root, filePath))] = count
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

export function compareWithBaseline(counts, baseline) {
  const violations = []
  const improvements = []
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0
    if (count > allowed) violations.push({ file, count, allowed })
    else if (count < allowed) improvements.push({ file, count, allowed })
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    if (!(file in counts)) improvements.push({ file, count: 0, allowed })
  }
  return { violations, improvements }
}

function readBaseline(root) {
  const baselinePath = join(root, BASELINE_PATH)
  return existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {}
}

function run() {
  const root = process.cwd()
  const counts = scanRendererColors(root)

  if (process.argv.includes('--update')) {
    writeFileSync(join(root, BASELINE_PATH), `${JSON.stringify(counts, null, 2)}\n`)
    console.info(`Renderer color baseline written to ${BASELINE_PATH}.`)
    return
  }

  const { violations, improvements } = compareWithBaseline(counts, readBaseline(root))
  if (violations.length > 0) {
    console.error(
      'Renderer color check failed. Use --chatbox-* tokens (e.g. `text-chatbox-tint-error`, `c="chatbox-brand"`, `var(--chatbox-background-tertiary)`) instead of hex, rgb() or palette colors:'
    )
    for (const { file, count, allowed } of violations) {
      console.error(`- ${file}: ${count} color literal(s), ${allowed} allowed`)
    }
    process.exit(1)
  }
  if (improvements.length > 0) {
    console.error(
      `Renderer color baseline is stale for ${improvements.length} file(s); run \`node scripts/check-renderer-colors.mjs --update\` to lock in the reduction.`
    )
    process.exit(1)
  }
  console.info('Renderer color check passed.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
}
