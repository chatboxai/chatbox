import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const rendererDir = path.join(rootDir, 'src/renderer')

const includeRoots = [
  'src/renderer/routes',
  'src/renderer/components',
  'src/renderer/modals',
]

const generatedDataFile = 'src/renderer/dev/uiInventory.generated.ts'
const generatedDocFile = 'docs/ui-inventory.md'

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') return []
      return walk(fullPath)
    }
    if (!entry.name.endsWith('.tsx')) return []
    if (entry.name.endsWith('.test.tsx') || entry.name.endsWith('.spec.tsx')) return []
    return [fullPath]
  })
}

function rel(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/')
}

function toTitle(value) {
  return value
    .replace(/^src\/renderer\//, '')
    .replace(/\.(tsx|ts)$/, '')
    .replace(/\/index$/, '')
    .replace(/\$/g, ':')
}

function unique(values) {
  return [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b))
}

function matchesAll(source, regex, group = 1) {
  return [...source.matchAll(regex)].map((match) => String(match[group] || '').trim()).filter(Boolean)
}

function detectRoute(file, source) {
  const route = source.match(/createFileRoute\((['"`])([^'"`]+)\1/)
  if (route) return route[2]
  if (file.endsWith('src/renderer/routes/__root.tsx')) return '__root'
  return undefined
}

function detectKind(file, source) {
  if (file.includes('/components/stories/')) return 'story'
  if (file.includes('/modals/')) return 'modal'
  if (file.includes('/routes/') && source.includes('createFileRoute')) return 'page'
  if (file.includes('/routes/') && file.includes('/-components/')) return 'route-component'
  if (file.includes('/components/')) return 'component'
  return 'ui'
}

function detectArea(file) {
  const relative = rel(file)
  if (relative.includes('/routes/settings/')) return 'settings'
  if (relative.includes('/components/settings/')) return 'settings'
  if (relative.includes('/components/chat/')) return 'chat'
  if (relative.includes('/components/InputBox/')) return 'input'
  if (relative.includes('/components/session/')) return 'session'
  if (relative.includes('/components/layout/')) return 'layout'
  if (relative.includes('/components/common/')) return 'common'
  if (relative.includes('/components/knowledge-base/')) return 'knowledge-base'
  if (relative.includes('/components/ModelSelectorV2/')) return 'model-selector'
  if (relative.includes('/components/message-parts/')) return 'message-parts'
  if (relative.includes('/routes/image-creator/')) return 'image-creator'
  if (relative.includes('/routes/guide/')) return 'guide'
  if (relative.includes('/routes/copilots/')) return 'copilots'
  if (relative.includes('/routes/task/')) return 'task'
  if (relative.includes('/modals/')) return 'modal'
  if (relative.includes('/routes/dev/')) return 'dev'
  return 'app'
}

function detectComponents(source, fallbackName) {
  const names = [
    ...matchesAll(source, /export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/g),
    ...matchesAll(source, /export\s+function\s+([A-Z][A-Za-z0-9_]*)/g),
    ...matchesAll(source, /function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g),
    ...matchesAll(source, /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/g),
    ...matchesAll(source, /const\s+([A-Z][A-Za-z0-9_]*)\s*=/g),
  ]
  const deduped = unique(names)
  return deduped.length > 0 ? deduped : [fallbackName]
}

function detectStateNames(source) {
  const stateTupleNames = matchesAll(source, /const\s+\[\s*([A-Za-z0-9_]+)\s*,\s*set[A-Za-z0-9_]+\s*\]\s*=\s*useState/g)
  const disclosureNames = matchesAll(source, /const\s+\[\s*([A-Za-z0-9_]+)\s*,\s*\{\s*open,\s*close/g)
  const queryFlags = matchesAll(source, /\b(is[A-Z][A-Za-z0-9_]+|has[A-Z][A-Za-z0-9_]+)\b/g)
  const propState = matchesAll(source, /\b(opened|disabled|loading|checked|selected|active|visible|error|success|expanded|collapsed)\b/g)
  return unique([...stateTupleNames, ...disclosureNames, ...queryFlags, ...propState]).slice(0, 24)
}

function detectText(source) {
  const tKeys = [
    ...matchesAll(source, /\bt\(\s*(['"`])([^'"`]+)\1/g, 2),
    ...matchesAll(source, /\bTrans\s+i18nKey=(['"`])([^'"`]+)\1/g, 2),
  ]
  const propText = [
    ...matchesAll(source, /\b(?:label|title|placeholder|description|aria-label|nothingFound)=\{?\s*(['"`])([^'"`]+)\1/g, 2),
    ...matchesAll(source, /\bname:\s*(['"`])([^'"`]+)\1/g, 2),
    ...matchesAll(source, /\bdescription:\s*(['"`])([^'"`]+)\1/g, 2),
  ]
  const jsxText = matchesAll(source, />\s*([A-Z][^<>{}\n]{2,80})\s*</g)
  return unique([...tKeys, ...propText, ...jsxText])
    .filter((text) => !text.includes('${') && !text.includes('=>') && !text.includes('className'))
    .slice(0, 80)
}

function detectStories(source) {
  const exportedStories = unique([
    ...matchesAll(source, /export\s+const\s+([A-Za-z0-9_]+)\s*:/g),
    ...matchesAll(source, /export\s+const\s+([A-Za-z0-9_]+)\s*=/g),
  ]).filter((name) => name !== 'Route')
  return exportedStories.map((exportName) => {
    const storyBlock = source.match(new RegExp(`export\\s+const\\s+${exportName}\\b[\\s\\S]*?(?=\\nexport\\s+const\\s+|\\nexport\\s+default\\b|$)`))
    const displayName = storyBlock?.[0].match(/\bname:\s*(['"`])([^'"`]+)\1/)?.[2]
    const targetBlock = storyBlock?.[0].match(/\buiInventoryTargets:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
    const targets = matchesAll(targetBlock, /['"`]([^'"`]+)['"`]/g)
    return {
      exportName,
      displayName: displayName ?? exportName,
      targets,
    }
  })
}

function detectStorybookTitle(source) {
  const title = source.match(/\btitle:\s*(['"`])([^'"`]+)\1/)
  return title ? title[2] : undefined
}

function storybookId(title, storyName) {
  const normalizeTitle = (value) =>
    value
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  const normalizeStoryName = (value) =>
    value
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  return `${normalizeTitle(title)}--${normalizeStoryName(storyName)}`
}

async function loadStorybookEntriesByImportPath() {
  try {
    const response = await fetch('http://localhost:6006/index.json', {
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return new Map()
    const data = await response.json()
    const entries = Object.values(data.entries || {}).filter((entry) => entry?.type === 'story' && entry.importPath)
    const grouped = new Map()
    for (const entry of entries) {
      const importPath = String(entry.importPath).replace(/^\.\//, '')
      const current = grouped.get(importPath) || []
      current.push({
        id: String(entry.id),
        name: String(entry.name || entry.id),
      })
      grouped.set(importPath, current)
    }
    return grouped
  } catch {
    return new Map()
  }
}

function detectVariants(source) {
  const variantProps = matchesAll(source, /\bvariant=(?:\{)?(['"`])([^'"`]+)\1/g, 2)
  const colorProps = matchesAll(source, /\bcolor=(?:\{)?(['"`])([^'"`]+)\1/g, 2).map((value) => `color:${value}`)
  const sizeProps = matchesAll(source, /\bsize=(?:\{)?(['"`])([^'"`]+)\1/g, 2).map((value) => `size:${value}`)
  const unionValues = matchesAll(source, /type\s+[A-Z][A-Za-z0-9_]*\s*=\s*((?:['"`][^'"`]+['"`]\s*\|\s*)+['"`][^'"`]+['"`])/g)
    .flatMap((value) => matchesAll(value, /['"`]([^'"`]+)['"`]/g))
  return unique([...variantProps, ...colorProps, ...sizeProps, ...unionValues]).slice(0, 24)
}

function detectPlatformSignals(source) {
  const notes = []
  const platforms = new Set()
  const previewModes = new Set()

  const addPlatform = (platform, note) => {
    platforms.add(platform)
    notes.push(note)
  }

  if (/platform\.type\s*={2,3}\s*['"`]desktop['"`]/.test(source)) addPlatform('desktop', 'checks platform.type === desktop')
  if (/platform\.type\s*!={1,2}\s*['"`]desktop['"`]/.test(source)) notes.push('branches when platform.type is not desktop')
  if (/platform\.type\s*={2,3}\s*['"`]mobile['"`]/.test(source)) addPlatform('mobile', 'checks platform.type === mobile')
  if (/platform\.type\s*!={1,2}\s*['"`]mobile['"`]/.test(source)) notes.push('branches when platform.type is not mobile')
  if (/platform\.type\s*={2,3}\s*['"`]web['"`]/.test(source)) addPlatform('web', 'checks platform.type === web')
  if (/platform\.type\s*!={1,2}\s*['"`]web['"`]/.test(source)) notes.push('branches when platform.type is not web')

  if (/\bisDesktop\b/.test(source)) {
    addPlatform('desktop', 'uses isDesktop state/prop')
  }
  if (/\bisMobile\b/.test(source)) {
    addPlatform('mobile', 'uses isMobile state/prop')
  }
  if (/\bisSmallScreen\b/.test(source) || /useIsSmallScreen/.test(source)) {
    previewModes.add('desktop-wide')
    previewModes.add('narrow/mobile-layout')
    notes.push('responsive branch via isSmallScreen/useIsSmallScreen')
  }
  if (/CHATBOX_BUILD_PLATFORM\s*={2,3}\s*['"`]ios['"`]/.test(source)) {
    addPlatform('mobile', 'checks iOS build platform')
  }
  if (/CHATBOX_BUILD_PLATFORM\s*={2,3}\s*['"`]android['"`]/.test(source)) {
    addPlatform('mobile', 'checks Android build platform')
  }
  if (/CHATBOX_BUILD_PLATFORM/.test(source)) notes.push('uses CHATBOX_BUILD_PLATFORM')

  if (/type=(?:\{)?['"`]desktop['"`]/.test(source) || /\bdesktopOnly\b/.test(source)) {
    addPlatform('desktop', 'contains desktop-only UI option')
  }
  if (/type=(?:\{)?['"`]mobile['"`]/.test(source) || /\bmobileWebOnly\b/.test(source)) {
    addPlatform('mobile', 'contains mobile/mobile-web UI option')
  }
  if (/\bweb-only\b|\bweb only\b|web version/i.test(source)) {
    addPlatform('web', 'mentions web-only behavior')
  }
  if (/desktopActionIconProps/.test(source)) {
    addPlatform('desktop', 'uses desktop action icon props')
  }
  if (/mobileActionIconProps/.test(source)) {
    addPlatform('mobile', 'uses mobile action icon props')
  }

  return {
    platforms: unique(platforms.size > 0 ? [...platforms] : ['all']),
    platformNotes: unique(notes).slice(0, 16),
    previewModes: unique([...previewModes]),
  }
}

function normalizeDependencyPath(importPath, file) {
  if (importPath.startsWith('@/')) return importPath.replace('@/', 'src/renderer/')
  if (importPath.startsWith('@shared/')) return undefined
  if (!importPath.startsWith('.')) return undefined
  const resolved = path.normalize(path.join(path.dirname(file), importPath)).split(path.sep).join('/')
  if (!resolved.includes('/src/renderer/')) return undefined
  return resolved.replace(/^.*src\/renderer\//, 'src/renderer/')
}

function detectDependencies(source, file) {
  return unique(
    matchesAll(source, /from\s+['"]([^'"]+)['"]/g)
      .map((importPath) => normalizeDependencyPath(importPath, file))
      .filter((importPath) => importPath?.startsWith('src/renderer/components/')),
  )
}

function inventoryFor(file) {
  const source = readFileSync(file, 'utf8')
  const relative = rel(file)
  const fallbackName = path.basename(file, '.tsx').replace(/^\$/, '')
  const kind = detectKind(file, source)
  const platformSignals = detectPlatformSignals(source)
  const storyDefinitions = kind === 'story' ? detectStories(source) : []
  const storybookTitle = kind === 'story' ? detectStorybookTitle(source) : undefined
  return {
    path: relative,
    title: toTitle(relative),
    kind,
    area: detectArea(file),
    route: detectRoute(file, source),
    components: detectComponents(source, fallbackName),
    states: detectStateNames(source),
    variants: detectVariants(source),
    platforms: platformSignals.platforms,
    platformNotes: platformSignals.platformNotes,
    previewModes: platformSignals.previewModes,
    text: detectText(source),
    stories: storyDefinitions.map((story) => story.exportName),
    storyNames: storyDefinitions.map((story) => story.displayName),
    storyTargets: storyDefinitions.map((story) => story.targets),
    storybookTitle,
    storybookIds: storybookTitle ? storyDefinitions.map((story) => storybookId(storybookTitle, story.displayName)) : [],
    dependencies: detectDependencies(source, file),
    previewLinks: [],
    hasDefaultExport: /export\s+default\b/.test(source),
    hasNiceModal: source.includes('NiceModal'),
    hasTranslation: source.includes('useTranslation') || /\bt\(/.test(source),
  }
}

const files = includeRoots.flatMap((root) => walk(path.join(rootDir, root)))
const inventory = files.map(inventoryFor).sort((a, b) => a.path.localeCompare(b.path))
const storybookEntriesByImportPath = await loadStorybookEntriesByImportPath()

for (const item of inventory) {
  if (item.kind !== 'story') continue
  const entries = storybookEntriesByImportPath.get(item.path)
  if (!entries?.length) continue
  const targetsByStoryName = new Map(item.storyNames.map((name, index) => [name, item.storyTargets[index] ?? []]))
  item.storybookIds = entries.map((entry) => entry.id)
  item.storyNames = entries.map((entry) => entry.name)
  item.storyTargets = entries.map((entry) => targetsByStoryName.get(entry.name) ?? [])
}

const stories = inventory.filter((item) => item.kind === 'story')
for (const item of inventory) {
  const previewLinks = []
  if (item.route && item.route !== '__root') {
    previewLinks.push({ label: 'Open route preview', kind: 'route', href: item.route })
  }
  if (item.kind === 'story' && item.storybookIds.length > 0) {
    previewLinks.push(
      ...item.storybookIds.map((id, index) => ({
        label: item.storyNames[index] ? `Storybook: ${item.storyNames[index]}` : 'Storybook',
        kind: 'storybook',
        href: `http://localhost:6006/?path=/story/${id}`,
        iframeHref: `http://localhost:6006/iframe.html?id=${id}&viewMode=story`,
      })),
    )
  } else {
    const normalizedPath = item.path.replace(/\.(tsx|ts)$/, '')
    const relatedStories = stories.filter((story) => {
      if (story.storyTargets.some((targets) => targets.length > 0)) {
        return story.storyTargets.some((targets) => targets.includes(normalizedPath))
      }
      return story.dependencies.includes(normalizedPath)
    })
    for (const story of relatedStories) {
      const relatedStoryLinks = story.storybookIds
        .map((id, index) => ({ id, index, targets: story.storyTargets[index] ?? [] }))
        .filter(({ targets }) => targets.length === 0 || targets.includes(normalizedPath))
      previewLinks.push(
        ...relatedStoryLinks.map(({ id, index }) => ({
          label: story.storyNames[index] ? `Storybook: ${story.storyNames[index]}` : `Storybook: ${story.storybookTitle}`,
          kind: 'storybook',
          href: `http://localhost:6006/?path=/story/${id}`,
          iframeHref: `http://localhost:6006/iframe.html?id=${id}&viewMode=story`,
        })),
      )
    }
  }
  item.previewLinks = previewLinks
}

const counts = inventory.reduce(
  (acc, item) => {
    acc.total += 1
    acc.byKind[item.kind] = (acc.byKind[item.kind] || 0) + 1
    acc.byArea[item.area] = (acc.byArea[item.area] || 0) + 1
    for (const platform of item.platforms) {
      acc.byPlatform[platform] = (acc.byPlatform[platform] || 0) + 1
    }
    return acc
  },
  { total: 0, byKind: {}, byArea: {}, byPlatform: {} },
)

function markdownList(values) {
  if (!values.length) return 'None detected'
  return values.map((value) => `\`${value}\``).join(', ')
}

function markdownSection(items, heading) {
  const lines = [`## ${heading}`, '']
  for (const item of items) {
    const meta = [
      `kind: \`${item.kind}\``,
      `area: \`${item.area}\``,
      item.route ? `route: \`${item.route}\`` : undefined,
      item.stories.length ? `stories: ${markdownList(item.stories)}` : undefined,
    ].filter(Boolean)
    lines.push(`### ${item.title}`)
    lines.push('')
    lines.push(`- Source: \`${item.path}\``)
    lines.push(`- Metadata: ${meta.join('; ')}`)
    lines.push(`- Components: ${markdownList(item.components)}`)
    lines.push(`- Platform signals: ${markdownList(item.platforms)}`)
    lines.push(`- Platform notes: ${markdownList(item.platformNotes)}`)
    lines.push(`- Preview modes: ${markdownList(item.previewModes)}`)
    lines.push(
      `- Preview links: ${
        item.previewLinks.length
          ? item.previewLinks.map((link) => `[${link.label}](${link.href})`).join(', ')
          : 'Missing real fixture'
      }`,
    )
    lines.push(`- States: ${markdownList(item.states)}`)
    lines.push(`- Variants: ${markdownList(item.variants)}`)
    lines.push(`- Text: ${markdownList(item.text)}`)
    lines.push('')
  }
  return lines.join('\n')
}

const now = new Date().toISOString()
const docLines = [
  '# UI 页面和组件清单',
  '',
  `Generated by \`node scripts/generate-ui-inventory.mjs\` at ${now}.`,
  '',
  'This inventory is code-derived from `src/renderer/routes`, `src/renderer/components`, and `src/renderer/modals`. It lists UI pages, route-local components, shared components, modals, Storybook stories, detected platform visibility, responsive preview modes, UI states, variants, and user-facing text keys/literals. Regenerate it after adding or moving UI files.',
  '',
  '## Summary',
  '',
  `- Total UI TSX files: ${counts.total}`,
  `- By kind: ${Object.entries(counts.byKind).map(([key, value]) => `\`${key}\` ${value}`).join(', ')}`,
  `- By area: ${Object.entries(counts.byArea).map(([key, value]) => `\`${key}\` ${value}`).join(', ')}`,
  `- By platform signal: ${Object.entries(counts.byPlatform).map(([key, value]) => `\`${key}\` ${value}`).join(', ')}`,
  '- Dev preview: `/dev/ui-inventory`',
  '',
  markdownSection(inventory.filter((item) => item.kind === 'page'), 'Pages'),
  markdownSection(inventory.filter((item) => item.kind === 'modal'), 'Modals'),
  markdownSection(inventory.filter((item) => item.kind === 'component' || item.kind === 'route-component'), 'Components'),
  markdownSection(inventory.filter((item) => item.kind === 'story'), 'Storybook Previews'),
]

const generatedTs = `// This file is generated by scripts/generate-ui-inventory.mjs. Do not edit manually.

export type UiInventoryKind = 'component' | 'modal' | 'page' | 'route-component' | 'story' | 'ui'

export type UiInventoryItem = {
  path: string
  title: string
  kind: UiInventoryKind
  area: string
  route?: string
  components: string[]
  states: string[]
  variants: string[]
  platforms: string[]
  platformNotes: string[]
  previewModes: string[]
  text: string[]
  stories: string[]
  storyNames: string[]
  storyTargets: string[][]
  storybookTitle?: string
  storybookIds: string[]
  dependencies: string[]
  previewLinks: Array<{ label: string; kind: 'route' | 'storybook'; href: string; iframeHref?: string }>
  hasDefaultExport: boolean
  hasNiceModal: boolean
  hasTranslation: boolean
}

export const uiInventoryGeneratedAt = ${JSON.stringify(now)}

export const uiInventorySummary = ${JSON.stringify(counts, null, 2)} as const

export const uiInventoryItems: UiInventoryItem[] = ${JSON.stringify(inventory, null, 2)}
`

mkdirSync(path.dirname(path.join(rootDir, generatedDataFile)), { recursive: true })
mkdirSync(path.dirname(path.join(rootDir, generatedDocFile)), { recursive: true })
writeFileSync(path.join(rootDir, generatedDataFile), generatedTs)
writeFileSync(path.join(rootDir, generatedDocFile), `${docLines.join('\n')}\n`)

console.log(`Generated ${generatedDocFile} and ${generatedDataFile}`)
