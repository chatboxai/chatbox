import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { checkArchitectureBoundaries, formatViolation } from './check-shared-boundaries.mjs'

function sourceInterpolation(expression) {
  return `\${${expression}}`
}

function withRendererStorage(source, localName = 'storage', specifier = '@/storage') {
  return `import ${localName} from '${specifier}'\n${source}`
}

function createFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'chatbox-boundaries-'))
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(root, path)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }
  return root
}

function withFixture(files, run) {
  const root = createFixture(files)
  try {
    run(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

test('allows supported process dependencies', () => {
  withFixture(
    {
      'src/renderer/view.ts': "import type { SessionHeader } from '@shared/types'",
      'src/main/main.ts': "import { app } from 'electron'\nimport type { Session } from '../shared/types'",
      'src/preload/index.ts':
        "import { contextBridge } from 'electron'\nimport type { Session } from '../shared/types'",
      'src/shared/types.ts': 'export interface Session { id: string }',
    },
    (root) => {
      assert.deepEqual(checkArchitectureBoundaries(root), [])
    }
  )
})

test('enforces row-only dependencies across both hosts and shared business modules', () => {
  const files = [
    'src/renderer/stores/session/new.ts',
    'apps/mobile/src/application/new.ts',
    'packages/chatbox-core/src/application/new.ts',
    'packages/chatbox-core/src/generation/new.ts',
    'packages/chatbox-core/src/session/new.ts',
    'packages/chatbox-core/src/session/session-tree/new.ts',
    'packages/chatbox-react/src/new.ts',
  ]
  withFixture(
    Object.fromEntries(files.map((file) => [file, "import type { Session as Chat } from '@chatbox/core'"])),
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(({ type }) => type === 'session-aggregate')
      assert.deepEqual(violations.map(({ file }) => file).sort(), [...files].sort())
    }
  )
})

test('rejects renderer imports from Electron, main, and preload through bare and relative paths', () => {
  withFixture(
    {
      'src/renderer/electron.ts': "import { app } from 'electron'",
      'src/renderer/main.ts': "import value from 'src/main/value'",
      'src/renderer/preload.ts': "export { value } from '../preload/value'",
      'src/main/value.ts': 'export default 1',
      'src/preload/value.ts': 'export const value = 1',
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(({ boundary }) => boundary === 'renderer process')
      assert.deepEqual(violations.map(({ specifier }) => specifier).sort(), [
        '../preload/value',
        'electron',
        'src/main/value',
      ])
      assert.match(formatViolation(violations[0]), /renderer platform facade and typed preload IPC contracts/)
    }
  )
})

test('rejects CommonJS, ESM, dynamic, and interpolated imports that escape into host processes', () => {
  withFixture(
    {
      'src/renderer/electron.cjs': "const electron = require('electron')",
      'src/renderer/main.ts': "const path = require.resolve('@/../main/value')",
      'src/renderer/preload.ts': "const value = require('../preload/value')",
      'src/renderer/dynamic.ts': "const value = import('src/main/value')",
      'src/renderer/import-equals.ts': "import electron = require('electron')",
      'src/renderer/import-type.ts': "type Main = import('src/main/value').default",
      'src/renderer/import-typeof.ts': "type MainModule = typeof import('src/main/value')",
      'src/renderer/module.cjs': "const preload = module.require('src/preload/value')",
      'src/renderer/re-export.mjs': "export { default } from 'src/main/value'",
      'src/renderer/template-call.ts': `const value = \`${sourceInterpolation("require('electron')")}\``,
      'src/renderer/template-import.ts': `const value = \`${sourceInterpolation("import('src/main/value')")}\``,
      'src/main/value.ts': 'export default 1',
      'src/preload/value.ts': 'export const value = 1',
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(({ boundary }) => boundary === 'renderer process')
      assert.deepEqual(violations.map(({ specifier }) => specifier).sort(), [
        '../preload/value',
        '@/../main/value',
        'electron',
        'electron',
        'electron',
        'src/main/value',
        'src/main/value',
        'src/main/value',
        'src/main/value',
        'src/main/value',
        'src/preload/value',
      ])
    }
  )
})

test('ignores import-like text in comments, strings, templates, JSX, and regular expressions', () => {
  withFixture(
    {
      'src/renderer/examples.ts': [
        "// const electron = require('electron')",
        "/* import value from 'src/main/value' */",
        'const quoted = "require.resolve(\'src/preload/value\')"',
        "const template = `import('electron')`",
        "const pattern = /require\\('electron'\\)/",
      ].join('\n'),
      'src/renderer/examples.tsx': [
        'export function Example() {',
        "  return <pre>require('electron') import('src/main/value')</pre>",
        '}',
      ].join('\n'),
    },
    (root) => {
      assert.deepEqual(checkArchitectureBoundaries(root), [])
    }
  )
})

test('resolves @shared aliases without allowing them to traverse process boundaries', () => {
  withFixture(
    {
      'src/shared/types.ts': 'export interface Session { id: string }',
      'src/renderer/allowed.ts': "import type { SessionHeader } from '@shared/types'",
      'src/renderer/main.ts': "import value from '@shared/../main/value'",
      'src/renderer/preload.ts': "export { value } from '@shared/../preload/value'",
      'src/main/renderer.ts': "import value from '@shared/../renderer/value'",
      'src/preload/renderer.ts': "const value = require('@shared/../renderer/value')",
      'src/main/value.ts': 'export default 1',
      'src/preload/value.ts': 'export const value = 1',
      'src/renderer/value.ts': 'export default 1',
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(({ boundary }) =>
        ['renderer process', 'main process', 'preload process'].includes(boundary)
      )
      assert.deepEqual(violations.map(({ specifier }) => specifier).sort(), [
        '@shared/../main/value',
        '@shared/../preload/value',
        '@shared/../renderer/value',
        '@shared/../renderer/value',
      ])
    }
  )
})

test('rejects @shared alias traversal from portable boundaries while allowing shared modules', () => {
  withFixture(
    {
      'src/shared/types.ts': 'export interface Session { id: string }',
      'src/shared/allowed.ts': "import type { Session } from '@shared/types'",
      'src/shared/escape.ts': "import view from '@shared/../renderer/view'",
      'packages/chatbox-core/src/allowed.ts': "import type { Session } from '@shared/types'",
      'packages/chatbox-core/src/escape.ts': "import main from '@shared/../main/main'",
      'packages/chatbox-react/src/allowed.ts': "import type { SessionHeader } from '@chatbox/core'",
      'packages/chatbox-react/src/escape.ts': "import preload from '@shared/../preload/index'",
      'src/renderer/view.ts': 'export default 1',
      'src/main/main.ts': 'export default 1',
      'src/preload/index.ts': 'export default 1',
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(({ boundary }) =>
        ['src/shared', '@chatbox/core', '@chatbox/react'].includes(boundary)
      )
      assert.deepEqual(
        violations.map(({ boundary, specifier }) => [boundary, specifier]),
        [
          ['src/shared', '@shared/../renderer/view'],
          ['@chatbox/core', '@shared/../main/main'],
          ['@chatbox/react', '@shared/../preload/index'],
        ]
      )
    }
  )
})

test('rejects main and preload imports from renderer through aliases and relative paths', () => {
  withFixture(
    {
      'src/renderer/value.ts': 'export const value = 1',
      'src/main/alias.ts': "import { value } from '@/value'",
      'src/main/relative.ts': "import { value } from '../renderer/value'",
      'src/preload/bare.ts': "import { value } from 'src/renderer/value'",
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(({ boundary }) =>
        ['main process', 'preload process'].includes(boundary)
      )
      assert.deepEqual(violations.map(({ specifier }) => specifier).sort(), [
        '../renderer/value',
        '@/value',
        'src/renderer/value',
      ])
      assert.ok(violations.every(({ supportedPath }) => supportedPath.includes('typed IPC')))
    }
  )
})

test('allows only the repository owner and named recovery paths to use Session-capable storage APIs', () => {
  const writer =
    'storage.setItemNow(StorageKeyGenerator.session(session.id), session)\nstorage.removeItem(StorageKeyGenerator.session(session.id))'
  withFixture(
    {
      'src/renderer/adapters/CurrentSessionRepository.ts': writer,
      'src/renderer/stores/migration.ts': 'dataStore.setAll({ [StorageKeyGenerator.session(session.id)]: session })',
    },
    (root) => {
      assert.deepEqual(checkArchitectureBoundaries(root), [])
    }
  )
})

test('restricts raw renderer storage capability imports to exact owner files', () => {
  withFixture(
    {
      'src/renderer/adapters/CurrentBlobStorage.ts': "import storage from '@/storage'\nvoid storage",
      'src/renderer/feature/renamed-default.ts': "import appStorage from '@/storage'\nvoid appStorage",
      'src/renderer/feature/namespace.ts': "import * as storageModule from '@/storage'\nvoid storageModule",
      'src/renderer/feature/import-equals.ts': "import storageModule = require('@/storage')\nvoid storageModule",
      'src/renderer/feature/require.cjs': "const storage = require('@/storage').default\nvoid storage",
      'src/renderer/feature/module-require.cjs': "const storage = module.require('@/storage').default\nvoid storage",
      'src/renderer/feature/dynamic.ts': "const storageModule = import('@/storage')\nvoid storageModule",
      'src/renderer/feature/parenthesized-dynamic.ts':
        "const storageModule = import(('@/storage'))\nvoid storageModule",
      'src/renderer/feature/parenthesized-require.cjs': "const storage = require(('@/storage')).default\nvoid storage",
      'src/renderer/feature/computed-member.cjs': "const storage = require('@/storage')[member]\nvoid storage",
      'src/renderer/feature/computed-destructuring.cjs':
        "const { [member]: storage } = require('@/storage')\nvoid storage",
      'src/renderer/feature/relative.ts': "import storage from '../storage'\nvoid storage",
      'src/renderer/feature/traversal.ts': "import storage from '@/feature/../storage'\nvoid storage",
      'src/renderer/adapters/copy/CurrentBlobStorage.ts': "import storage from '@/storage'\nvoid storage",
      'src/renderer/feature/named.ts': "import { StorageKey } from '@/storage'\nvoid StorageKey",
      'src/renderer/feature/type-only.ts': "import type storage from '@/storage'\ntype Raw = typeof storage",
      'src/renderer/feature/import-equals-type.ts':
        "import type storageModule = require('@/storage')\ntype Raw = typeof storageModule",
      'src/renderer/feature/named-require.cjs': "const { StorageKey } = require('@/storage')\nvoid StorageKey",
      'src/renderer/feature/named-member.cjs': "const StorageKey = require('@/storage')['StorageKey']\nvoid StorageKey",
      'src/renderer/feature/named-computed-destructuring.cjs':
        "const { ['StorageKey']: StorageKey } = require('@/storage')\nvoid StorageKey",
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(
        ({ boundary }) => boundary === 'Raw renderer storage capability import'
      )
      assert.deepEqual(violations.map(({ file }) => file).sort(), [
        'src/renderer/adapters/copy/CurrentBlobStorage.ts',
        'src/renderer/feature/computed-destructuring.cjs',
        'src/renderer/feature/computed-member.cjs',
        'src/renderer/feature/dynamic.ts',
        'src/renderer/feature/import-equals.ts',
        'src/renderer/feature/module-require.cjs',
        'src/renderer/feature/namespace.ts',
        'src/renderer/feature/parenthesized-dynamic.ts',
        'src/renderer/feature/parenthesized-require.cjs',
        'src/renderer/feature/relative.ts',
        'src/renderer/feature/renamed-default.ts',
        'src/renderer/feature/require.cjs',
        'src/renderer/feature/traversal.ts',
      ])
      assert.match(formatViolation(violations[0]), /typed repository\/port/)
    }
  )
})

test('rejects direct, variable, literal, template, bulk, and dynamic Session-capable writers', () => {
  withFixture(
    {
      'src/renderer/setup/direct.ts': withRendererStorage(
        'storage.setItemNow(StorageKeyGenerator.session(session.id), session)'
      ),
      'packages/feature/variable.ts':
        'const sessionKey = backupSessionStorageKey(session.id)\nstorage.setItemNow(sessionKey, session)',
      'src/main/literal.ts': "storage.setItem('session:literal', session)",
      'src/preload/template.ts': `storage.removeItem(\`session:${sourceInterpolation('sessionId')}\`)`,
      'src/renderer/setup/concatenated.ts': "cache.setItemNow('session:' + session.id, session)",
      'src/renderer/setup/const-chain.ts':
        "const prefix = 'session:'\nconst sessionKey = prefix + session.id\ncache.setItemNow(sessionKey, session)",
      'src/renderer/setup/computed-bulk.ts': withRendererStorage(
        'storage.setAll({ [StorageKeyGenerator.session(session.id)]: session })'
      ),
      'src/renderer/setup/import-bulk.ts': withRendererStorage('storage.setAll({ ...previousData, ...importData })'),
      'src/renderer/setup/settings-bulk.ts': withRendererStorage('storage.setAll({ settings: nextSettings })'),
      'src/renderer/setup/dynamic-key.ts': 'for (const [key, value] of entries) options.storage.setItemNow(key, value)',
      'src/renderer/setup/element-dynamic-key.ts': withRendererStorage("storage['setItemNow'](candidateKey, value)"),
      'src/renderer/setup/element-bulk.ts': withRendererStorage("storage['setAll']({ settings: value })"),
      'src/renderer/setup/aliased-dynamic-key.ts': withRendererStorage(
        "const store = storage\nstore['setItemNow'](candidateKey, value)"
      ),
      'src/renderer/setup/aliased-bulk.ts': "const store = dataStore\nstore['setAll']({ settings: value })",
      'src/renderer/setup/cyclic-key.ts': withRendererStorage(
        'const firstKey = secondKey\nconst secondKey = firstKey\nstorage.setItemNow(firstKey, value)'
      ),
      'src/renderer/setup/renamed-import.ts': withRendererStorage('appStorage.setAll(values)', 'appStorage'),
      'src/renderer/setup/namespace-import.ts':
        "import * as storageModule from '@/storage'\nstorageModule.default.setAll(values)",
      'src/renderer/setup/dynamic-set-item.ts': withRendererStorage('storage.setItem(dynamicKey, value)'),
      'src/renderer/setup/dynamic-remove-item.ts': withRendererStorage('storage.removeItem(dynamicKey)'),
      'src/renderer/setup/relative-import.ts': withRendererStorage(
        'appStorage.setItem(dynamicKey, value)',
        'appStorage',
        '../storage'
      ),
      'src/renderer/setup/scoped-receiver-alias.ts': withRendererStorage(
        [
          'function writeStorage() { const store = storage; store.setItem(dynamicKey, value) }',
          'function writeCache() { const store = cache; store.setItem(dynamicKey, value) }',
        ].join('\n')
      ),
      'src/renderer/setup/spoofed-sanitizer.ts': withRendererStorage(
        'function nonSessionStorageKey(key) { return key }\nstorage.setItem(nonSessionStorageKey(dynamicKey), value)'
      ),
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(
        ({ boundary }) => boundary === 'Session-capable storage writer'
      )
      assert.deepEqual(violations.map(({ file }) => file).sort(), [
        'packages/feature/variable.ts',
        'src/main/literal.ts',
        'src/preload/template.ts',
        'src/renderer/setup/aliased-bulk.ts',
        'src/renderer/setup/aliased-dynamic-key.ts',
        'src/renderer/setup/computed-bulk.ts',
        'src/renderer/setup/concatenated.ts',
        'src/renderer/setup/const-chain.ts',
        'src/renderer/setup/cyclic-key.ts',
        'src/renderer/setup/direct.ts',
        'src/renderer/setup/dynamic-key.ts',
        'src/renderer/setup/dynamic-remove-item.ts',
        'src/renderer/setup/dynamic-set-item.ts',
        'src/renderer/setup/element-bulk.ts',
        'src/renderer/setup/element-dynamic-key.ts',
        'src/renderer/setup/import-bulk.ts',
        'src/renderer/setup/namespace-import.ts',
        'src/renderer/setup/relative-import.ts',
        'src/renderer/setup/renamed-import.ts',
        'src/renderer/setup/scoped-receiver-alias.ts',
        'src/renderer/setup/settings-bulk.ts',
        'src/renderer/setup/spoofed-sanitizer.ts',
      ])
      assert.match(formatViolation(violations[0]), /direct writes without a statically non-Session key/)
    }
  )
})

test('allows controlled direct writes only when the key is statically non-Session', () => {
  withFixture(
    {
      'src/renderer/setup/safe-literal.ts': withRendererStorage("storage['setItemNow']('settings', value)"),
      'src/renderer/setup/safe-const.ts': withRendererStorage(
        "const key = 'settings'\nconst store = storage\nstore.setItem(key, value)"
      ),
      'src/renderer/setup/safe-template-prefix.ts': withRendererStorage(
        [
          "const prefix = 'chatbox-cli:image-generation-execution'",
          `const key = \`${sourceInterpolation('prefix')}:${sourceInterpolation('id')}\``,
          'const store = storage',
          "store['setItemNow'](key, value)",
        ].join('\n')
      ),
      'src/renderer/setup/uncontrolled-unknown.ts': 'cache.setItemNow(candidateKey, value)',
      'src/renderer/setup/uncontrolled-storage-name.ts': withRendererStorage(
        'function writeCache() { const storage = cache; storage.setItem(dynamicKey, value); storage.removeItem(dynamicKey) }'
      ),
      'src/renderer/setup/scoped-safe-keys.ts': withRendererStorage(
        [
          "function writeSettings() { const key = 'settings'; storage.setItem(key, value) }",
          "function writeCliState() { const key = 'chatbox-cli:other'; storage.removeItem(key) }",
        ].join('\n')
      ),
      'src/renderer/setup/sanitized-key.ts': [
        "import storage, { nonSessionStorageKey as safeKey } from '@/storage'",
        'storage.setItem(safeKey(dynamicKey), value)',
        'storage.removeItem(safeKey(dynamicKey))',
      ].join('\n'),
      'src/renderer/setup/type-reexport.ts': "export type { StorageKey } from '@/storage'",
      'src/renderer/setup/named-reexport.ts': "export { nonSessionStorageKey, StorageKey } from '@/storage'",
      'src/renderer/setup/safe-value-export.ts': [
        "import storage from '@/storage'",
        "export const storageStatus = storage === undefined ? 'missing' : 'ready'",
        "export const labels = { storage: 'renderer' }",
        "export function getStorageLabel() { return 'renderer storage' }",
      ].join('\n'),
      'src/renderer/setup/safe-cjs-export.cjs': [
        "module.exports = { storage: 'renderer' }",
        "exports.storageStatus = 'ready'",
      ].join('\n'),
      'src/renderer/setup/safe-mutable-and-class-export.ts': [
        "export let storageStatus = 'ready'",
        "export var storageLabel = 'renderer'",
        "export class Services { constructor() { this.storage = 'renderer' } }",
        "class LocalServices { get storage() { return 'renderer' } }",
        'export { LocalServices }',
      ].join('\n'),
      'src/renderer/setup/safe-cjs-channels.cjs': [
        "const { StorageKey } = require('@/storage')",
        'Object.assign(exports, { StorageKey })',
        "Object.defineProperty(exports, 'storageLabel', { get: () => 'renderer' })",
        "exports.storage ||= 'renderer'",
        "module.exports.Services = class { constructor() { this.storage = 'renderer' } }",
      ].join('\n'),
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(
        ({ boundary }) =>
          boundary === 'Session-capable storage writer' ||
          boundary === 'Raw renderer storage export (bounded single-file check)'
      )
      assert.deepEqual(violations, [])
    }
  )
})

test('rejects common same-file exports of the raw renderer storage instance', () => {
  const deepAliasSource = [
    "import storage from '@/storage'",
    'const alias0 = storage',
    ...Array.from({ length: 6000 }, (_, index) => `const alias${index + 1} = alias${index}`),
    'export { alias6000 as rawStorage }',
  ].join('\n')

  withFixture(
    {
      'src/renderer/setup/direct-reexport.ts': "export { default as appStorage } from '@/storage'",
      'src/renderer/setup/namespace-reexport.ts': "export * as storageModule from '@/storage'",
      'src/renderer/setup/local-reexport.ts': "import appStorage from '@/storage'\nexport { appStorage as rawStorage }",
      'src/renderer/setup/default-reexport.ts': "import storage from '@/storage'\nexport default storage",
      'src/renderer/setup/exported-variable.ts': "import storage from '@/storage'\nexport const rawStorage = storage",
      'src/renderer/setup/default-wrapper.ts': "import storage from '@/storage'\nexport default { storage }",
      'src/renderer/setup/exported-services.ts': "import storage from '@/storage'\nexport const services = { storage }",
      'src/renderer/setup/exported-function.ts':
        "import storage from '@/storage'\nexport function getStorage() { return storage }",
      'src/renderer/setup/exported-getter.ts':
        "import storage from '@/storage'\nexport const services = { get storage() { return storage } }",
      'src/renderer/setup/local-wrapper-reexport.ts':
        "import storage from '@/storage'\nconst services = { storage }\nexport { services }",
      'src/renderer/setup/cjs-module-export.cjs':
        "const storage = require('@/storage').default\nmodule.exports = storage",
      'src/renderer/setup/cjs-wrapper-export.cjs':
        "const storage = require('@/storage').default\nmodule.exports = { storage }",
      'src/renderer/setup/cjs-property-export.cjs':
        "const storage = require('@/storage').default\nexports.storage = storage",
      'src/renderer/setup/cjs-function-export.cjs':
        "const storage = require('@/storage').default\nmodule.exports.getStorage = () => storage",
      'src/renderer/setup/cjs-direct-require.cjs': "exports.storage = require('@/storage').default",
      'src/renderer/setup/exported-let.ts': "import storage from '@/storage'\nexport let rawStorage = storage",
      'src/renderer/setup/exported-var.ts': "import storage from '@/storage'\nexport var rawStorage = storage",
      'src/renderer/setup/exported-class.ts': [
        "import storage from '@/storage'",
        'export class Services { constructor() { this.storage = storage } }',
      ].join('\n'),
      'src/renderer/setup/local-class-reexport.ts': [
        "import storage from '@/storage'",
        'class Services { storage = storage }',
        'export { Services }',
      ].join('\n'),
      'src/renderer/setup/cjs-destructuring.cjs': [
        "const { default: storage } = require('@/storage')",
        'module.exports = storage',
      ].join('\n'),
      'src/renderer/setup/cjs-class-wrapper.cjs': [
        "const storage = require('@/storage').default",
        'module.exports = class Services { constructor() { this.storage = storage } }',
      ].join('\n'),
      'src/renderer/setup/cjs-object-assign.cjs': [
        "const storage = require('@/storage').default",
        'Object.assign(exports, { storage })',
      ].join('\n'),
      'src/renderer/setup/cjs-define-property.cjs': [
        "const storage = require('@/storage').default",
        "Object.defineProperty(exports, 'storage', { get: () => storage })",
      ].join('\n'),
      'src/renderer/setup/cjs-logical-assignment.cjs': [
        "const storage = require('@/storage').default",
        'exports.storage ||= storage',
      ].join('\n'),
      'src/renderer/setup/deep-alias.ts': deepAliasSource,
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(
        ({ boundary }) => boundary === 'Raw renderer storage export (bounded single-file check)'
      )
      assert.deepEqual(violations.map(({ file }) => file).sort(), [
        'src/renderer/setup/cjs-class-wrapper.cjs',
        'src/renderer/setup/cjs-define-property.cjs',
        'src/renderer/setup/cjs-destructuring.cjs',
        'src/renderer/setup/cjs-direct-require.cjs',
        'src/renderer/setup/cjs-function-export.cjs',
        'src/renderer/setup/cjs-logical-assignment.cjs',
        'src/renderer/setup/cjs-module-export.cjs',
        'src/renderer/setup/cjs-object-assign.cjs',
        'src/renderer/setup/cjs-property-export.cjs',
        'src/renderer/setup/cjs-wrapper-export.cjs',
        'src/renderer/setup/deep-alias.ts',
        'src/renderer/setup/default-reexport.ts',
        'src/renderer/setup/default-wrapper.ts',
        'src/renderer/setup/direct-reexport.ts',
        'src/renderer/setup/exported-class.ts',
        'src/renderer/setup/exported-function.ts',
        'src/renderer/setup/exported-getter.ts',
        'src/renderer/setup/exported-let.ts',
        'src/renderer/setup/exported-services.ts',
        'src/renderer/setup/exported-var.ts',
        'src/renderer/setup/exported-variable.ts',
        'src/renderer/setup/local-class-reexport.ts',
        'src/renderer/setup/local-reexport.ts',
        'src/renderer/setup/local-wrapper-reexport.ts',
        'src/renderer/setup/namespace-reexport.ts',
      ])
      assert.match(formatViolation(violations[0]), /bounded check catches common same-file export wrappers/)
    }
  )
})

test('ignores Session-writer-like text that is not an executable storage call', () => {
  withFixture(
    {
      'src/renderer/examples.ts': [
        '// storage.setAll({ session: value })',
        'const quoted = "storage.setItemNow(\'session:example\', value)"',
        'const template = `options.storage.setItemNow(key, value)`',
        'const pattern = /storage\\.setAll\\(/',
      ].join('\n'),
      'src/renderer/examples.tsx': [
        'export function Example() {',
        '  return <pre>storage.setAll(session)</pre>',
        '}',
      ].join('\n'),
    },
    (root) => {
      assert.deepEqual(checkArchitectureBoundaries(root), [])
    }
  )
})

test('does not allow similarly named files to impersonate Session-capable storage exceptions', () => {
  const writer = 'storage.setItemNow(StorageKeyGenerator.session(session.id), session)'
  withFixture(
    {
      'src/renderer/adapters/copy/CurrentSessionRepository.ts': writer,
      'src/renderer/stores/migrations.ts': writer,
      'src/renderer/packages/backup/import-backup-copy.ts': writer,
      'src/renderer/packages/backup/copy/legacy-import.ts':
        'for (const [key, value] of entries) options.storage.setItemNow(key, value)',
      'src/renderer/pages/SettingDialog/copy/AdvancedSettingTab.tsx': withRendererStorage(
        'storage.setAll({ ...previousData, ...importData })'
      ),
    },
    (root) => {
      const violations = checkArchitectureBoundaries(root).filter(
        ({ boundary }) => boundary === 'Session-capable storage writer'
      )
      assert.deepEqual(violations.map(({ file }) => file).sort(), [
        'src/renderer/adapters/copy/CurrentSessionRepository.ts',
        'src/renderer/packages/backup/copy/legacy-import.ts',
        'src/renderer/packages/backup/import-backup-copy.ts',
        'src/renderer/pages/SettingDialog/copy/AdvancedSettingTab.tsx',
        'src/renderer/stores/migrations.ts',
      ])
    }
  )
})

test('the current repository has no unnamed Session-capable storage writer', () => {
  const violations = checkArchitectureBoundaries(process.cwd()).filter(
    ({ boundary }) => boundary === 'Session-capable storage writer'
  )
  assert.deepEqual(violations, [])
})
