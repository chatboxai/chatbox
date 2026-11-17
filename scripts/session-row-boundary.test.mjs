import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import { findSessionAggregateDependencies } from './session-row-boundary.mjs'

function check(file, source) {
  return findSessionAggregateDependencies(file, ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
}

test('rejects named imports and re-exports even when aggregates are aliased', () => {
  assert.deepEqual(
    check('src/renderer/stores/session/new.ts', [
      "import type { Session as CachedChat, SessionHeader } from '@shared/types'",
      "export { decodeSessionTree as loadChat } from '@chatbox/core/session/session-tree'",
    ].join('\n')).map(({ specifier }) => specifier),
    ['Session', 'decodeSessionTree']
  )
})

test('rejects aggregate namespace, import-type and indexed dependencies', () => {
  const source = [
    "import * as core from '@chatbox/core'",
    'type Chat = core.Session',
    "type Tree = import('@chatbox/core/session/session-tree').SessionTree",
    'core.decodeSessionTree(input)',
    "core['encodeSessionTree'](input)",
  ].join('\n')
  assert.deepEqual(
    check('apps/mobile/src/screens/Chat.tsx', source).map(({ specifier }) => specifier),
    ['Session', 'SessionTree', 'decodeSessionTree', 'encodeSessionTree']
  )
})

test('historical input owners permit only their explicitly named dependencies', () => {
  const owner = 'src/renderer/adapters/CurrentSessionRepository.ts'
  assert.deepEqual(check(owner, "import type { Session } from '@shared/types'"), [])
  assert.equal(check(owner, "import { decodeSessionTree } from '@chatbox/core/session/session-tree'").length, 1)
  assert.equal(check('src/renderer/other/CurrentSessionRepository.ts', "import type { Session } from '@shared/types'").length, 1)
  assert.deepEqual(check('packages/chatbox-core/src/application/session/SessionRowMigration.ts',
    "import { verifySessionTreeRoundTrip } from '../../session/session-tree/verify'"), [])
})

test('allows row projections and fixtures while ignoring text and local object member names', () => {
  const source = [
    "import type { SessionHeader, Message, SessionRowRepositoryPort } from '@chatbox/core'",
    "// import type { Session } from '@shared/types'",
    "const example = \"import type { Session } from '@shared/types'\"",
    'const components = { Session: View }; components.Session()',
  ].join('\n')
  assert.deepEqual(check('packages/chatbox-react/src/new.ts', source), [])
  for (const file of ['view.test.ts', 'view.spec.ts', 'view.stories.tsx', 'view.test-support.ts', 'testing/fixture.ts']) {
    assert.deepEqual(check(`src/renderer/${file}`, "import type { Session } from '@shared/types'"), [])
  }
})


test('core session helpers reject aggregate caches and legacy derivations', () => {
  const source = "import type { Session } from '../types'\nconst cache = new WeakMap<Session, unknown>()"
  assert.equal(check('packages/chatbox-core/src/session/generation-state.ts', source).length, 1)
  assert.equal(check('packages/chatbox-core/src/session/session-tree/new.ts', source).length, 1)
  assert.equal(check('packages/chatbox-core/src/session/new.ts', "export { getGenerationControlMessages } from './generation-state'").length, 1)
})

test('historical codecs permit only their exact input dependency set', () => {
  assert.deepEqual(check('packages/chatbox-core/src/session/session-tree/repair.ts', "import type { Session } from '../../types'"), [])
  assert.equal(check('packages/chatbox-core/src/session/session-tree/repair.ts', "import { decodeSessionTree } from './decode'").length, 1)
  assert.equal(check('packages/chatbox-core/src/session/reachable.ts', "import type { Session } from '../types'").length, 1)
  assert.equal(check('packages/chatbox-core/src/application/new.ts', "import { getReachableSessionMessages } from '@chatbox/core/session/session-tree'").length, 1)
})
