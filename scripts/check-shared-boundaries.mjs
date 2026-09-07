import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const root = process.cwd()

const hostForbiddenSpecifiers = [
  '@/',
  'src/renderer',
  'src/main',
  'src/preload',
  '@capacitor/',
  '@capacitor-community/',
  'electron',
  '@mantine/',
  '@tanstack/react-router',
]

const boundaries = [
  {
    name: 'src/shared',
    directory: join(root, 'src/shared'),
    forbiddenSpecifiers: hostForbiddenSpecifiers,
  },
  {
    name: '@chatbox/core',
    directory: join(root, 'packages/chatbox-core/src'),
    forbiddenSpecifiers: [
      ...hostForbiddenSpecifiers,
      '@chatbox/react',
      'react',
      'react-dom',
      '@tanstack/react-query',
      'zustand',
      '@shared/react-bindings',
      '@shared/react-native',
      'src/shared/react-bindings',
      'src/shared/react-native',
    ],
  },
  {
    name: '@chatbox/react',
    directory: join(root, 'packages/chatbox-react/src'),
    forbiddenSpecifiers: [
      ...hostForbiddenSpecifiers,
      '@shared/application',
      '@shared/domain',
      '@shared/generation',
      '@shared/ports',
      '@shared/types',
      '@shared/utils/session-sort',
      'src/shared',
    ],
  },
]

const packageManifests = [
  { name: '@chatbox/core', file: join(root, 'packages/chatbox-core/package.json') },
  { name: '@chatbox/react', file: join(root, 'packages/chatbox-react/package.json') },
]

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'])

function hasSourceExtension(filePath) {
  return [...sourceExtensions].some((extension) => filePath.endsWith(extension))
}

function walk(dirPath) {
  const entries = readdirSync(dirPath)
  return entries.flatMap((entry) => {
    const fullPath = join(dirPath, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      return walk(fullPath)
    }
    return hasSourceExtension(fullPath) ? [fullPath] : []
  })
}

function resolvesOutsideBoundary(filePath, specifier, boundaryDirectory) {
  if (!specifier.startsWith('.')) return false
  const relativePath = relative(boundaryDirectory, resolve(dirname(filePath), specifier))
  return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
}

function findViolations(filePath, boundary) {
  const text = readFileSync(filePath, 'utf8')
  const importMatches = text.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)
  const dynamicImportMatches = text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)
  const specifiers = [...importMatches, ...dynamicImportMatches].map((match) => match[1])

  return specifiers
    .filter(
      (specifier) =>
        boundary.forbiddenSpecifiers.some(
          (forbidden) => specifier === forbidden || specifier.startsWith(forbidden)
        ) || resolvesOutsideBoundary(filePath, specifier, boundary.directory)
    )
    .map((specifier) => ({
      file: relative(root, filePath),
      specifier,
    }))
}

function findWildcardExportViolations(packageManifest) {
  const manifest = JSON.parse(readFileSync(packageManifest.file, 'utf8'))
  return Object.entries(manifest.exports ?? {})
    .filter(([specifier, target]) => specifier.includes('*') || JSON.stringify(target).includes('*'))
    .map(([specifier]) => ({
      packageName: packageManifest.name,
      specifier,
    }))
}

const violations = boundaries.flatMap((boundary) =>
  walk(boundary.directory).flatMap((filePath) =>
    findViolations(filePath, boundary).map((violation) => ({
      ...violation,
      boundary: boundary.name,
    }))
  )
)

const wildcardExportViolations = packageManifests.flatMap(findWildcardExportViolations)

if (violations.length > 0 || wildcardExportViolations.length > 0) {
  console.error('Shared boundary check failed. Portable package dependencies and public exports must remain explicit.')
  for (const violation of violations) {
    console.error(`- [${violation.boundary}] ${violation.file}: ${violation.specifier}`)
  }
  for (const violation of wildcardExportViolations) {
    console.error(`- [${violation.packageName}] wildcard package export: ${violation.specifier}`)
  }
  process.exit(1)
}

console.log('Shared boundary check passed.')
