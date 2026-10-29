import ts from 'typescript'

const aggregateNames = new Set([
  'Session',
  'SessionSchema',
  'SessionTree',
  'encodeSessionTree',
  'decodeSessionTree',
  'normalizeSessionV1',
  'repairSessionV1',
  'verifySessionTreeRoundTrip',
  'getReachableSessionMessages',
  'deriveSessionLockState',
  'getGenerationControlMessages',
  'getCurrentConversationMessages',
  'getConversationMessages',
  'buildCreateForkPatch',
  'buildDeleteForkPatch',
  'buildExpandForkPatch',
  'buildSwitchForkPatch',
  'buildSwitchForkToPatch',
  'findMessageContext',
  'findMessageLocation',
  'findMessageSourceThread',
])

// Historical file parsing and development fixtures have explicit input owners.
const inputOwners = new Map([
  ['packages/chatbox-core/src/application/session/compatibility/row-format.ts', new Set(['Session', 'SessionTree'])],
  ['packages/chatbox-core/src/application/session/compatibility/session-load.ts', new Set(['Session', 'buildSwitchForkToPatch', 'findMessageLocation'])],
  ['packages/chatbox-core/src/application/session/SessionRowMigration.ts', new Set(['verifySessionTreeRoundTrip'])],
  ['packages/chatbox-core/src/session/session-tree/encode.ts', new Set(['Session', 'SessionTree', 'normalizeSessionV1'])],
  ['packages/chatbox-core/src/session/session-tree/decode.ts', new Set(['Session', 'SessionTree'])],
  ['packages/chatbox-core/src/session/session-tree/normalize.ts', new Set(['Session', 'repairSessionV1'])],
  ['packages/chatbox-core/src/session/session-tree/repair.ts', new Set(['Session'])],
  ['packages/chatbox-core/src/session/session-tree/verify.ts', new Set(['Session', 'SessionTree', 'encodeSessionTree', 'decodeSessionTree'])],
  ['packages/chatbox-core/src/session/session-tree/index.ts', new Set(['SessionTree', 'encodeSessionTree', 'decodeSessionTree', 'normalizeSessionV1', 'repairSessionV1', 'verifySessionTreeRoundTrip'])],
  ['src/renderer/adapters/CurrentSessionRepository.ts', new Set(['Session'])],
  ['src/renderer/packages/initial_data.ts', new Set(['Session'])],
  ['src/renderer/stores/migration.ts', new Set(['Session'])],
  ['apps/mobile/src/application/mobile-session-fixtures.ts', new Set(['Session'])],
  ['apps/mobile/src/screens/message-display-fixtures.ts', new Set(['Session'])],
  ['apps/mobile/src/screens/use-fixture-transcript.ts', new Set(['Session'])],
])

export const sessionBusinessRoots = [
  'packages/chatbox-core/src/application',
  'packages/chatbox-core/src/generation',
  'packages/chatbox-core/src/session',
  'packages/chatbox-react/src',
  'src/renderer',
  'apps/mobile/src',
]

/** Checks named and namespace aggregate dependencies, not cross-module data flow. */
export function findSessionAggregateDependencies(file, sourceFile) {
  if (/\.(?:test|spec|stories|test-support)\.[^.]+$/.test(file) || file.includes('/testing/')) return []
  const permitted = inputOwners.get(file)
  const namespaces = new Set()
  const dependencies = new Set()
  const add = (name) => {
    if (aggregateNames.has(name) && !permitted?.has(name)) dependencies.add(name)
  }
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    }
    if (ts.isImportEqualsDeclaration(statement)) namespaces.add(statement.name.text)
  }
  function visit(node) {
    if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) add((node.propertyName ?? node.name).text)
    if (ts.isQualifiedName(node) && ts.isIdentifier(node.left) && namespaces.has(node.left.text)) add(node.right.text)
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text))
      add(node.name.text)
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text) &&
      ts.isStringLiteral(node.argumentExpression)
    ) add(node.argumentExpression.text)
    if (ts.isImportTypeNode(node) && node.qualifier) {
      add(ts.isIdentifier(node.qualifier) ? node.qualifier.text : node.qualifier.right.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...dependencies].map((specifier) => ({
    type: 'session-aggregate',
    boundary: 'Row-only session business',
    file,
    specifier,
    supportedPath:
      'Use SessionHeader, bounded row sources and explicit commands. Complete Session/SessionTree dependencies belong to named historical-input owners or test fixtures.',
  }))
}
