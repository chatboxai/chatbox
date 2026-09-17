import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mobileRoot = path.join(repositoryRoot, 'apps/mobile')
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])
const ignoredDirectories = new Set(['node_modules', 'dist', '.expo', 'ios', 'android'])
const forbiddenImports = [
  /(?:^|\/)src\/renderer(?:\/|$)/,
  /^@shared(?:\/|$)/,
  /^@chatbox\/(?:core|i18n|react)\/src(?:\/|$)/,
  /^@\/(?:api|chat|db|official|providers|resources|session|state)(?:\/|$)/,
]
const allowedSharedImports = new Map([
  [
    'apps/mobile/src/features/reasoning/mobile-reasoning.ts',
    new Set(['@shared/providers/api-style', '@shared/utils/reasoning-control']),
  ],
])
allowedSharedImports.set('apps/mobile/src/components/message/ToolImageGenerationPreview.tsx', new Set(['@shared/image-background-task-result']))
allowedSharedImports.set('apps/mobile/src/work-mode/image-commands.ts', new Set(['@shared/mobile-work/product-info-tools']))
allowedSharedImports.set('apps/mobile/src/adapters/background-stream.ts', new Set(['@shared/utils/background-stream']))
allowedSharedImports.set('apps/mobile/src/adapters/mobile-model-dependencies.ts', new Set(['@shared/utils/background-stream']))
// Host-neutral execution and artifact contracts shared by RN and Capacitor.
allowedSharedImports.set('apps/mobile/src/application/createPersistentMobileApplication.ts', new Set(['@shared/mobile-work/workspace-cleanup']))
allowedSharedImports.set('apps/mobile/src/screens/HtmlPreviewScreen.tsx', new Set(['@shared/mobile-work/artifact-preview']))
allowedSharedImports.set('apps/mobile/src/components/composer/ChatComposer.tsx', new Set(['@shared/mobile-work/capabilities', '@shared/models/utils/deepseek']))
allowedSharedImports.set('apps/mobile/src/screens/SessionScreen.tsx', new Set(['@shared/mobile-work/capabilities']))
allowedSharedImports.set('apps/mobile/src/work-mode/MobileExecutionHost.tsx', new Set(['@shared/mobile-work/generated/worker-source']))
allowedSharedImports.set('apps/mobile/src/work-mode/MobileExecutionService.ts', new Set(['@shared/mobile-work/MobileExecutionService']))
allowedSharedImports.set('apps/mobile/src/application/createMobileGeneration.ts', new Set(['@shared/mobile-work/model-disclosure']))
allowedSharedImports.set('apps/mobile/src/work-mode/MobileWorkMode.ts', new Set(['@shared/mobile-work/product-info-tools', '@shared/mobile-work/model-disclosure', '@shared/mobile-work/LocalWorkMode', '@shared/mobile-work/view-image', '@shared/tools/view-image']))
allowedSharedImports.set('apps/mobile/src/work-mode/MobileWorkspace.ts', new Set(['@shared/mobile-work/workspace-lifecycle', '@shared/mobile-work/workspace-inputs','@shared/work-artifacts']))
allowedSharedImports.set('apps/mobile/src/work-mode/WorkMessageArtifacts.tsx', new Set(['@shared/work-artifacts']))
allowedSharedImports.set('apps/mobile/src/work-mode/abort.ts', new Set(['@shared/mobile-work/abort']))
allowedSharedImports.set('apps/mobile/src/work-mode/execution-html.ts', new Set(['@shared/mobile-work/execution-html']))
allowedSharedImports.set('apps/mobile/src/work-mode/site-preview.ts', new Set(['@shared/mobile-work/site-preview']))
allowedSharedImports.set('apps/mobile/src/work-mode/system-tools/index.ts', new Set(['@shared/mobile-work/system-tools']))
allowedSharedImports.set('apps/mobile/src/work-mode/ui/WorkModeMenu.tsx', new Set(['@shared/mobile-work/capabilities']))
allowedSharedImports.set('apps/mobile/src/work-mode/workspace-path.ts', new Set(['@shared/mobile-work/workspace-path']))

allowedSharedImports.set('apps/mobile/src/work-mode/normalize-work-image.ts', new Set(['@shared/mobile-work/view-image']))

allowedSharedImports.set('apps/mobile/src/components/message/MessageWorkTimeline.tsx', new Set(['@shared/mobile-work/execution-feedback', '@shared/image-background-task-result']))
allowedSharedImports.set('apps/mobile/src/screens/settings/SkillsSettingsScreen.tsx', new Set(['@shared/mobile-work/skill-settings']))
allowedSharedImports.set('apps/mobile/src/work-mode/ui/WorkArtifactCards.tsx', new Set(['@shared/work-artifacts']))
allowedSharedImports.set('apps/mobile/src/work-mode/ui/WorkArtifactCards.test.ts', new Set(['@shared/work-artifacts']))
allowedSharedImports.set('apps/mobile/src/work-mode/ui/system-tool-approval.ts', new Set(['@shared/mobile-work/authorization-text']))

allowedSharedImports.set('apps/mobile/src/work-mode/createMobileWorkMode.ts', new Set(['@shared/mobile-work/product-info-tools']))

const expectedRoutes = [
  '(chat)/_layout.tsx',
  '(chat)/session/[sessionId].tsx',
  '(chat)/session/_layout.tsx',
  '(chat)/session/new.tsx',
  '+not-found.tsx',
  '_layout.tsx',
  'index.tsx',
  'message-image.tsx',
  'settings/_layout.tsx',
  'settings/about.tsx',
  'settings/chat.tsx',
  'settings/default-models.tsx',
  'settings/document-parser.tsx',
  'settings/general.tsx',
  'settings/index.tsx',
  'settings/providers/[id].tsx',
  'settings/providers/chatbox-ai.tsx',
  'settings/providers/index.tsx',
  'settings/providers/new.tsx',
  'settings/raw-json.tsx',
  'settings/web-search.tsx',
]
const forbiddenRoutes = [
  'providers/[id].tsx',
  'providers/new.tsx',
  'session/[sessionId].tsx',
  'session/new.tsx',
  'sessions.tsx',
  'settings/chatbox-ai.tsx',
]
const expectedStorageModules = [
  'src/adapters/async-storage.ts',
  'src/adapters/capacitor-compatible-sqlite/connection-factory.ts',
  'src/adapters/capacitor-compatible-sqlite/config-repository.ts',
  'src/adapters/capacitor-compatible-sqlite/image-generation-storage.ts',
  'src/adapters/capacitor-compatible-sqlite/key-value-store.ts',
  'src/adapters/capacitor-compatible-sqlite/schema.ts',
  'src/adapters/capacitor-compatible-sqlite/session-meta-repository.ts',
  'src/adapters/capacitor-compatible-sqlite/session-repository.ts',
  'src/adapters/capacitor-compatible-sqlite/settings-storage.ts',
  'src/adapters/deterministic-file-blob-storage.ts',
  'src/application/createPersistentMobileApplication.ts',
]
const expectedReadOnlyMessageModules = [
  'src/components/message/MessageContent.tsx',
  'src/components/message/MessageList.tsx',
  'src/components/message/MessageMarkdown.tsx',
  'src/components/message/MessageRow.tsx',
  'src/components/ThreadHistoryDrawer.tsx',
  'src/screens/MessageImageScreen.tsx',
]
const expectedChatCommandModules = [
  'src/adapters/mobile-attachment-picker.ts',
  'src/adapters/mobile-model-dependencies.ts',
  'src/application/createMobileGeneration.ts',
  'src/components/composer/ChatComposer.tsx',
  'src/components/composer/ModelSelectorActionSheet.tsx',
]
const expectedI18nModules = ['src/i18n/MobileI18nBridge.tsx', 'src/i18n/mobile-i18n.ts']

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (ignoredDirectories.has(entry)) return []
    const absolutePath = path.join(directory, entry)
    return statSync(absolutePath).isDirectory() ? listFiles(absolutePath) : [absolutePath]
  })
}

function importedSpecifiers(source) {
  const specifiers = []
  const pattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g
  for (const match of source.matchAll(pattern)) specifiers.push(match[1] ?? match[2])
  return specifiers
}

if (!existsSync(mobileRoot)) {
  throw new Error(`React Native product host is missing: ${mobileRoot}`)
}

const violations = []
for (const route of expectedRoutes) {
  if (!existsSync(path.join(mobileRoot, 'app', route))) violations.push(`apps/mobile/app/${route}: missing route`)
}
for (const route of forbiddenRoutes) {
  if (existsSync(path.join(mobileRoot, 'app', route))) violations.push(`apps/mobile/app/${route}: obsolete route`)
}
for (const modulePath of expectedStorageModules) {
  if (!existsSync(path.join(mobileRoot, modulePath))) {
    violations.push(`apps/mobile/${modulePath}: missing persistent storage module`)
  }
}
for (const modulePath of expectedReadOnlyMessageModules) {
  if (!existsSync(path.join(mobileRoot, modulePath))) {
    violations.push(`apps/mobile/${modulePath}: missing read-only message module`)
  }
}
for (const modulePath of expectedChatCommandModules) {
  if (!existsSync(path.join(mobileRoot, modulePath))) {
    violations.push(`apps/mobile/${modulePath}: missing chat command module`)
  }
}
for (const modulePath of expectedI18nModules) {
  if (!existsSync(path.join(mobileRoot, modulePath))) {
    violations.push(`apps/mobile/${modulePath}: missing mobile i18n module`)
  }
}

for (const file of listFiles(mobileRoot)) {
  if (!sourceExtensions.has(path.extname(file))) continue
  const relativePath = path.relative(repositoryRoot, file)
  const specifiers = importedSpecifiers(readFileSync(file, 'utf8'))

  for (const specifier of specifiers) {
    const explicitlyAllowed = allowedSharedImports.get(relativePath)?.has(specifier) === true
    if (!explicitlyAllowed && forbiddenImports.some((pattern) => pattern.test(specifier))) {
      violations.push(`${relativePath}: forbidden import ${specifier}`)
    }
  }

  const routePath = path.relative(path.join(mobileRoot, 'app'), file)
  if (!routePath.startsWith('..') && path.basename(file) !== '_layout.tsx') {
    for (const specifier of specifiers) {
      if (specifier !== 'expo-router' && !specifier.startsWith('@/screens/')) {
        violations.push(`${relativePath}: route modules may only import expo-router or @/screens/*`)
      }
    }
  }
}

const newSessionScreen = path.join(mobileRoot, 'src/screens/NewSessionScreen.tsx')
if (existsSync(newSessionScreen)) {
  const source = readFileSync(newSessionScreen, 'utf8')
  const specifiers = importedSpecifiers(source)
  for (const specifier of specifiers) {
    if (specifier === '@chatbox/core' || /^@\/adapters(?:\/|$)/.test(specifier)) {
      violations.push(`apps/mobile/src/screens/NewSessionScreen.tsx: draft route cannot import ${specifier}`)
    }
  }
  for (const forbidden of ['application.sessions', 'sessionHooks', 'sessionRepository', 'useSession(']) {
    if (source.includes(forbidden)) {
      violations.push(`apps/mobile/src/screens/NewSessionScreen.tsx: draft route cannot use ${forbidden}`)
    }
  }
}

const chatLayout = path.join(mobileRoot, 'app/(chat)/_layout.tsx')
if (existsSync(chatLayout)) {
  const source = readFileSync(chatLayout, 'utf8')
  if (!/<Stack(?:\s|>)/.test(source)) {
    violations.push('apps/mobile/app/(chat)/_layout.tsx: chat shell must render a navigation Stack')
  }
  if (!/animation:\s*['"]none['"]/.test(source)) {
    violations.push('apps/mobile/app/(chat)/_layout.tsx: session navigation must disable Stack animations')
  }
  if (!/<Stack\.Screen\s+name=['"]session['"]/.test(source)) {
    violations.push('apps/mobile/app/(chat)/_layout.tsx: chat Stack must own the session shell')
  }
}

const sessionLayout = path.join(mobileRoot, 'app/(chat)/session/_layout.tsx')
if (existsSync(sessionLayout)) {
  const source = readFileSync(sessionLayout, 'utf8')
  if (!/<Slot(?:\s|\/|>)/.test(source)) {
    violations.push('apps/mobile/app/(chat)/session/_layout.tsx: session routes must render a Slot')
  }
  if (/<Stack(?:\s|>)/.test(source)) {
    violations.push('apps/mobile/app/(chat)/session/_layout.tsx: new and existing sessions must not use a nested Stack')
  }
}

const mobileNavigation = path.join(mobileRoot, 'src/navigation/mobile-navigation.ts')
if (existsSync(mobileNavigation)) {
  const source = readFileSync(mobileNavigation, 'utf8')
  if (!source.includes("router.replace('/session/new')") || !source.includes("router.replace({ pathname: '/session/[sessionId]'")) {
    violations.push('apps/mobile/src/navigation/mobile-navigation.ts: session navigation must replace in place')
  }
}

const messageComponents = path.join(mobileRoot, 'src/components/message')
if (existsSync(messageComponents)) {
  for (const file of listFiles(messageComponents)) {
    if (!sourceExtensions.has(path.extname(file)) || /\.test\.[cm]?[jt]sx?$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    for (const forbidden of ['ChatUiMessage', 'assetId']) {
      if (source.includes(forbidden)) {
        violations.push(`${path.relative(repositoryRoot, file)}: forbidden legacy message field ${forbidden}`)
      }
    }
  }
}

const storageSchema = path.join(mobileRoot, 'src/adapters/capacitor-compatible-sqlite/schema.ts')
if (existsSync(storageSchema)) {
  const source = readFileSync(storageSchema, 'utf8')
  for (const expected of [
    'CAPACITOR_MAIN_KEY_VALUE_SCHEMA_SQL',
    'CAPACITOR_SESSION_META_SCHEMA_SQL',
    'CAPACITOR_IMAGE_GENERATION_SCHEMA_SQL',
  ]) {
    if (!source.includes(expected)) {
      violations.push(`apps/mobile/src/adapters/capacitor-compatible-sqlite/schema.ts: missing ${expected}`)
    }
  }
}

const canonicalStorageSchema = path.join(
  repositoryRoot,
  'packages/chatbox-core/src/persistence/capacitor-compatible-schema.ts'
)
if (existsSync(canonicalStorageSchema)) {
  const source = readFileSync(canonicalStorageSchema, 'utf8')
  for (const expected of [
    "'chatboxSQLite.db'",
    "'chatbox-session-metaSQLite.db'",
    "'chatbox-image-generationSQLite.db'",
    'CREATE TABLE IF NOT EXISTS key_value',
    'CREATE TABLE IF NOT EXISTS session_meta',
    'CREATE TABLE IF NOT EXISTS image_generation',
  ]) {
    if (!source.includes(expected)) {
      violations.push(`packages/chatbox-core/src/persistence/capacitor-compatible-schema.ts: missing ${expected}`)
    }
  }
  for (const forbidden of [
    'chatbox-react-native.db',
    'CREATE TABLE IF NOT EXISTS sessions',
    'CREATE TABLE IF NOT EXISTS threads',
    'CREATE TABLE IF NOT EXISTS messages',
    'CREATE TABLE IF NOT EXISTS settings',
    'CREATE TABLE IF NOT EXISTS blob_objects',
  ]) {
    if (source.includes(forbidden)) {
      violations.push(`packages/chatbox-core/src/persistence/capacitor-compatible-schema.ts: forbidden ${forbidden}`)
    }
  }
} else {
  violations.push('packages/chatbox-core/src/persistence/capacitor-compatible-schema.ts: missing canonical schema')
}

const productComposition = path.join(mobileRoot, 'src/application/createPersistentMobileApplication.ts')
if (existsSync(productComposition)) {
  const source = readFileSync(productComposition, 'utf8')
  for (const expected of [
    'CapacitorCompatibleSessionRepository',
    'CapacitorCompatibleSettingsStorage',
    'CapacitorCompatibleImageGenerationStorage',
    'CapacitorCompatibleConfigRepository',
    'DeterministicFileBlobStorage',
  ]) {
    if (!source.includes(expected)) {
      violations.push(`apps/mobile/src/application/createPersistentMobileApplication.ts: missing ${expected}`)
    }
  }
  for (const forbidden of [
    'chatbox-react-native.db',
    "@/adapters/sqlite",
    "@/adapters/blob-file-storage",
    'new MobileSQLiteStore',
    'new SQLiteSessionRepository',
    'new SQLiteSettingsStorage',
    'new FileBlobStorage',
  ]) {
    if (source.includes(forbidden)) {
      violations.push(`apps/mobile/src/application/createPersistentMobileApplication.ts: forbidden ${forbidden}`)
    }
  }
  if (source.includes('seedFixtures')) {
    violations.push('apps/mobile/src/application/createPersistentMobileApplication.ts: product storage cannot seed fixtures')
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log('Mobile product boundary check passed.')
