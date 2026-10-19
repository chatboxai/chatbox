import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { findSessionAggregateDependencies, sessionBusinessRoots } from './session-row-boundary.mjs'

const portableHostSpecifiers = [
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

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'])
const localTaintDepthLimit = 256

function hasSourceExtension(filePath) {
  return [...sourceExtensions].some((extension) => filePath.endsWith(extension))
}

function walk(dirPath) {
  if (!existsSync(dirPath)) return []
  const entries = readdirSync(dirPath)
  return entries.flatMap((entry) => {
    if (entry === 'node_modules') return []
    const fullPath = join(dirPath, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      return walk(fullPath)
    }
    return hasSourceExtension(fullPath) ? [fullPath] : []
  })
}

function matchesSpecifier(specifier, forbidden) {
  if (forbidden.endsWith('/')) return specifier.startsWith(forbidden)
  return specifier === forbidden || specifier.startsWith(`${forbidden}/`)
}

function isPathWithin(candidatePath, directory) {
  const relativePath = relative(directory, candidatePath)
  return (
    relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  )
}

function resolvesOutsideBoundary(filePath, specifier, boundaryDirectory) {
  if (!specifier.startsWith('.')) return false
  return !isPathWithin(resolve(dirname(filePath), specifier), boundaryDirectory)
}

function resolvesIntoDirectory(filePath, specifier, directory, root) {
  const resolvedPath = resolveProjectSpecifier(filePath, specifier, root)
  return resolvedPath ? isPathWithin(resolvedPath, directory) : false
}

function resolveProjectSpecifier(filePath, specifier, root) {
  if (specifier.startsWith('@/')) return resolve(root, 'src/renderer', specifier.slice(2))
  if (specifier === '@shared') return resolve(root, 'src/shared')
  if (specifier.startsWith('@shared/')) return resolve(root, 'src/shared', specifier.slice('@shared/'.length))
  if (specifier.startsWith('src/')) return resolve(root, specifier)
  if (specifier.startsWith('.')) return resolve(dirname(filePath), specifier)
  return null
}

function scriptKindFor(filePath) {
  switch (extname(filePath)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function createSourceFileReader() {
  const cache = new Map()
  return (filePath) => {
    let sourceFile = cache.get(filePath)
    if (!sourceFile) {
      sourceFile = ts.createSourceFile(
        filePath,
        readFileSync(filePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(filePath)
      )
      cache.set(filePath, sourceFile)
    }
    return sourceFile
  }
}

function staticString(node) {
  const expression = unwrapExpression(node)
  return expression && ts.isStringLiteralLike(expression) ? expression.text : null
}

function extractSpecifiers(sourceFile) {
  const specifiers = new Set()

  function add(node) {
    const value = staticString(node)
    if (value !== null) specifiers.add(value)
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression)
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node.arguments[0])
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        add(node.arguments[0])
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        ((node.expression.expression.text === 'require' && node.expression.name.text === 'resolve') ||
          (node.expression.expression.text === 'module' && node.expression.name.text === 'require'))
      ) {
        add(node.arguments[0])
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return [...specifiers]
}

function createBoundaries(root) {
  const rendererDirectory = join(root, 'src/renderer')
  const mainDirectory = join(root, 'src/main')
  const preloadDirectory = join(root, 'src/preload')

  return [
    {
      name: 'src/shared',
      directory: join(root, 'src/shared'),
      forbiddenSpecifiers: portableHostSpecifiers,
      forbiddenDirectories: [rendererDirectory, mainDirectory, preloadDirectory],
      forbidOutsideDirectory: true,
      supportedPath: 'Move host behavior behind a contract in src/shared/ports and inject its implementation.',
    },
    {
      name: '@chatbox/core',
      directory: join(root, 'packages/chatbox-core/src'),
      forbiddenSpecifiers: [
        ...portableHostSpecifiers,
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
      forbiddenDirectories: [rendererDirectory, mainDirectory, preloadDirectory],
      forbidOutsideDirectory: true,
      supportedPath: 'Depend on portable core contracts and inject host or React implementations.',
    },
    {
      name: '@chatbox/react',
      directory: join(root, 'packages/chatbox-react/src'),
      forbiddenSpecifiers: [
        ...portableHostSpecifiers,
        '@shared/application',
        '@shared/domain',
        '@shared/generation',
        '@shared/ports',
        '@shared/types',
        '@shared/utils/session-sort',
        'src/shared',
      ],
      forbiddenDirectories: [rendererDirectory, mainDirectory, preloadDirectory],
      forbidOutsideDirectory: true,
      supportedPath: 'Use @chatbox/core public exports instead of reaching into host or shared implementations.',
    },
    {
      name: '@chatbox/i18n',
      directory: join(root, 'packages/chatbox-i18n/src'),
      forbiddenSpecifiers: portableHostSpecifiers,
      forbiddenDirectories: [rendererDirectory, mainDirectory, preloadDirectory],
      forbidOutsideDirectory: true,
      supportedPath: 'Keep shared translations portable and independent from host-process implementations.',
    },
    {
      name: 'renderer process',
      directory: rendererDirectory,
      forbiddenSpecifiers: ['electron', 'src/main', 'src/preload'],
      forbiddenDirectories: [mainDirectory, preloadDirectory],
      supportedPath: 'Use the renderer platform facade and typed preload IPC contracts.',
    },
    {
      name: 'main process',
      directory: mainDirectory,
      forbiddenSpecifiers: ['@/', 'src/renderer'],
      forbiddenDirectories: [rendererDirectory],
      supportedPath: 'Share types through src/shared and communicate with the renderer through typed IPC.',
    },
    {
      name: 'preload process',
      directory: preloadDirectory,
      forbiddenSpecifiers: ['@/', 'src/renderer'],
      forbiddenDirectories: [rendererDirectory],
      supportedPath: 'Expose a typed IPC bridge from preload; keep renderer implementation behind that bridge.',
    },
  ]
}

function findImportViolations(root, boundary, readSourceFile) {
  return walk(boundary.directory).flatMap((filePath) => {
    const specifiers = extractSpecifiers(readSourceFile(filePath))
    return specifiers
      .filter(
        (specifier) =>
          boundary.forbiddenSpecifiers.some((forbidden) => matchesSpecifier(specifier, forbidden)) ||
          (boundary.forbidOutsideDirectory && resolvesOutsideBoundary(filePath, specifier, boundary.directory)) ||
          boundary.forbiddenDirectories?.some((directory) =>
            resolvesIntoDirectory(filePath, specifier, directory, root)
          )
      )
      .map((specifier) => ({
        type: 'import',
        boundary: boundary.name,
        file: relative(root, filePath),
        specifier,
        supportedPath: boundary.supportedPath,
      }))
  })
}

function unwrapExpression(node) {
  let expression = node
  while (
    expression &&
    (ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression))
  ) {
    expression = expression.expression
  }
  return expression
}

function propertyPath(node) {
  const expression = unwrapExpression(node)
  if (!expression) return null
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = propertyPath(expression.expression)
    return receiver ? `${receiver}.${expression.name.text}` : null
  }
  if (ts.isElementAccessExpression(expression)) {
    const property = staticString(expression.argumentExpression)
    const receiver = propertyPath(expression.expression)
    return receiver && property !== null ? `${receiver}.${property}` : null
  }
  return null
}

function isRendererStorageImport(sourceFile, specifier, root) {
  const resolvedImport = resolveProjectSpecifier(sourceFile.fileName, specifier, root)
  if (!resolvedImport) return false
  const storageDirectory = join(root, 'src/renderer/storage')
  return new Set([
    storageDirectory,
    join(storageDirectory, 'index'),
    join(storageDirectory, 'index.ts'),
    join(storageDirectory, 'index.js'),
  ]).has(resolvedImport)
}

function rawStorageOwnerGroups(root) {
  return [
    {
      name: 'typed storage adapters',
      files: [
        'src/renderer/adapters/CurrentBlobStorage.ts',
        'src/renderer/adapters/CurrentSessionRecordStore.ts',
        'src/renderer/adapters/CurrentSessionRepository.ts',
        'src/renderer/adapters/RendererSessionFolderStore.ts',
        'src/renderer/adapters/RendererSettingsStorage.ts',
        'src/renderer/adapters/RendererStoragePersistence.ts',
      ],
    },
    {
      name: 'durable renderer state owners',
      files: [
        'src/renderer/packages/chatbox-cli/images.ts',
        'src/renderer/stores/agentPersonaStore.ts',
        'src/renderer/stores/atoms/configAtoms.ts',
        'src/renderer/stores/memoryRuntime.ts',
        'src/renderer/stores/onboardingStore.ts',
        'src/renderer/stores/sessionHelpers.ts',
      ],
    },
    {
      name: 'migration and recovery owners',
      files: [
        'src/renderer/pages/SettingDialog/AdvancedSettingTab.tsx',
        'src/renderer/components/settings/DataSections.tsx',
        'src/renderer/stores/migration.ts',
      ],
    },
    {
      name: 'storage maintenance and diagnostics',
      files: ['src/renderer/routes/dev/storage.tsx', 'src/renderer/setup/storage_clear.ts'],
    },
  ].map((group) => ({ ...group, files: group.files.map((file) => join(root, file)) }))
}

function rawStorageOwners(root) {
  return new Map(rawStorageOwnerGroups(root).flatMap((group) => group.files.map((file) => [file, group.name])))
}

function requireCallSpecifier(node) {
  if (!ts.isCallExpression(node)) return null
  const callee = propertyPath(node.expression)
  if (callee !== 'require' && callee !== 'module.require') return null
  return staticString(node.arguments[0])
}

function requireCallGrantsRawStorage(node) {
  const parent = node.parent
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    unwrapExpression(parent.expression) === node
  ) {
    if (ts.isPropertyAccessExpression(parent)) return parent.name.text === 'default'
    const member = staticString(parent.argumentExpression)
    return member === null || member === 'default'
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name)) {
    return parent.name.elements.some((element) => {
      if (element.dotDotDotToken) return true
      const propertyName = element.propertyName
      const importedName = propertyName
        ? ts.isComputedPropertyName(propertyName)
          ? staticString(propertyName.expression)
          : (staticString(propertyName) ?? (ts.isIdentifier(propertyName) ? propertyName.text : null))
        : ts.isIdentifier(element.name)
          ? element.name.text
          : null
      return importedName === null || importedName === 'default'
    })
  }
  return true
}

function containsRawStorageCapabilityImport(sourceFile, root) {
  let found = false

  function visit(node) {
    if (found) return
    if (ts.isImportDeclaration(node)) {
      const specifier = staticString(node.moduleSpecifier)
      const clause = node.importClause
      if (specifier !== null && clause && !clause.isTypeOnly && isRendererStorageImport(sourceFile, specifier, root)) {
        const namedBindings = clause.namedBindings
        found =
          Boolean(clause.name) ||
          Boolean(namedBindings && ts.isNamespaceImport(namedBindings)) ||
          Boolean(
            namedBindings &&
              ts.isNamedImports(namedBindings) &&
              namedBindings.elements.some(
                (element) => !element.isTypeOnly && (element.propertyName?.text ?? element.name.text) === 'default'
              )
          )
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = staticString(node.moduleReference.expression)
      found = specifier !== null && isRendererStorageImport(sourceFile, specifier, root)
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = staticString(node.arguments[0])
        found = specifier !== null && isRendererStorageImport(sourceFile, specifier, root)
      } else {
        const specifier = requireCallSpecifier(node)
        found =
          specifier !== null &&
          isRendererStorageImport(sourceFile, specifier, root) &&
          requireCallGrantsRawStorage(node)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function isNonSessionKeyImport(sourceFile, specifier, root) {
  const resolvedImport = resolveProjectSpecifier(sourceFile.fileName, specifier, root)
  if (!resolvedImport) return false
  const modulePath = join(root, 'src/renderer/storage/non-session-key')
  return new Set([modulePath, `${modulePath}.ts`, `${modulePath}.js`]).has(resolvedImport)
}

function rendererStorageRequireKind(sourceFile, node, root) {
  let expression = unwrapExpression(node)
  let importsDefault = false
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const member = ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : staticString(expression.argumentExpression)
    if (member !== 'default') return null
    importsDefault = true
    expression = unwrapExpression(expression.expression)
  }
  if (!ts.isCallExpression(expression)) return null
  const specifier = requireCallSpecifier(expression)
  if (specifier === null || !isRendererStorageImport(sourceFile, specifier, root)) return null
  return importsDefault ? 'controlled-storage' : 'controlled-storage-namespace'
}

function createLexicalBindingResolver(sourceFile, root) {
  const scopes = new WeakMap()
  const rootScope = { parent: null, bindings: new Map(), acceptsVar: true }

  function childScope(parent, acceptsVar = false) {
    return { parent, bindings: new Map(), acceptsVar }
  }

  function addBinding(scope, name, binding) {
    scope.bindings.set(name, scope.bindings.has(name) ? { kind: 'unknown' } : binding)
  }

  function addBindingName(scope, name, binding) {
    if (ts.isIdentifier(name)) {
      addBinding(scope, name.text, binding)
      return
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue
      addBindingName(scope, element.name, binding)
    }
  }

  function varScope(scope) {
    let current = scope
    while (!current.acceptsVar && current.parent) current = current.parent
    return current
  }

  function visit(node, currentScope) {
    scopes.set(node, currentScope)

    if (ts.isFunctionDeclaration(node) && node.name) {
      addBinding(currentScope, node.name.text, { kind: 'function', declaration: node })
    } else if (ts.isClassDeclaration(node) && node.name) {
      addBinding(currentScope, node.name.text, { kind: 'class', declaration: node })
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const importSpecifier = staticString(node.moduleSpecifier)
      const importsStorage = importSpecifier !== null && isRendererStorageImport(sourceFile, importSpecifier, root)
      const importsNonSessionKey = importSpecifier !== null && isNonSessionKeyImport(sourceFile, importSpecifier, root)
      const importsValues = !node.importClause.isTypeOnly
      if (node.importClause.name) {
        addBinding(currentScope, node.importClause.name.text, {
          kind: importsValues && importsStorage ? 'controlled-storage' : 'other',
        })
      }
      const bindings = node.importClause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        addBinding(currentScope, bindings.name.text, {
          kind: importsValues && importsStorage ? 'controlled-storage-namespace' : 'other',
        })
      } else if (bindings) {
        for (const element of bindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text
          addBinding(currentScope, element.name.text, {
            kind:
              importsValues && !element.isTypeOnly && importsStorage && importedName === 'default'
                ? 'controlled-storage'
                : importsValues &&
                    !element.isTypeOnly &&
                    (importsStorage || importsNonSessionKey) &&
                    importedName === 'nonSessionStorageKey'
                  ? 'non-session-key-sanitizer'
                  : 'other',
          })
        }
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const specifier = ts.isExternalModuleReference(node.moduleReference)
        ? staticString(node.moduleReference.expression)
        : null
      addBinding(currentScope, node.name.text, {
        kind:
          !node.isTypeOnly && specifier !== null && isRendererStorageImport(sourceFile, specifier, root)
            ? 'controlled-storage-namespace'
            : 'other',
      })
    }

    if (ts.isFunctionLike(node)) {
      const functionScope = childScope(currentScope, true)
      scopes.set(node, functionScope)
      if (ts.isFunctionExpression(node) && node.name) {
        addBinding(functionScope, node.name.text, { kind: 'other' })
      }
      for (const parameter of node.parameters) visit(parameter, functionScope)
      if (node.body) visit(node.body, functionScope)
      return
    }

    if (ts.isBlock(node) || ts.isCaseBlock(node)) {
      const blockScope = childScope(currentScope)
      scopes.set(node, blockScope)
      ts.forEachChild(node, (child) => visit(child, blockScope))
      return
    }

    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const loopScope = childScope(currentScope)
      scopes.set(node, loopScope)
      ts.forEachChild(node, (child) => visit(child, loopScope))
      return
    }

    if (ts.isCatchClause(node)) {
      const catchScope = childScope(currentScope)
      scopes.set(node, catchScope)
      if (node.variableDeclaration) {
        addBindingName(catchScope, node.variableDeclaration.name, { kind: 'other' })
      }
      visit(node.block, catchScope)
      return
    }

    if (ts.isParameter(node)) {
      addBindingName(currentScope, node.name, { kind: 'other' })
    } else if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
      const declarationList = node.parent
      const isConst = (declarationList.flags & ts.NodeFlags.Const) !== 0
      const targetScope =
        isConst || (declarationList.flags & ts.NodeFlags.Let) !== 0 ? currentScope : varScope(currentScope)
      const requiredStorageKind =
        isConst && node.initializer ? rendererStorageRequireKind(sourceFile, node.initializer, root) : null

      if (requiredStorageKind === 'controlled-storage-namespace' && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const importedName = element.propertyName
            ? (staticString(element.propertyName) ??
              (ts.isIdentifier(element.propertyName) ? element.propertyName.text : null))
            : ts.isIdentifier(element.name)
              ? element.name.text
              : null
          addBindingName(targetScope, element.name, {
            kind: importedName === 'default' ? 'controlled-storage' : 'other',
          })
        }
        ts.forEachChild(node, (child) => visit(child, currentScope))
        return
      }

      const binding =
        requiredStorageKind !== null
          ? { kind: requiredStorageKind }
          : isConst && ts.isIdentifier(node.name) && node.initializer
            ? { kind: 'const', declaration: node, initializer: node.initializer }
            : ts.isIdentifier(node.name) && node.initializer
              ? { kind: 'variable', declaration: node, initializer: node.initializer }
              : { kind: 'other' }
      addBindingName(targetScope, node.name, binding)
    }

    ts.forEachChild(node, (child) => visit(child, currentScope))
  }

  scopes.set(sourceFile, rootScope)
  ts.forEachChild(sourceFile, (child) => visit(child, rootScope))

  return (identifier) => {
    let scope = scopes.get(identifier)
    while (scope) {
      const binding = scope.bindings.get(identifier.text)
      if (binding) return binding
      scope = scope.parent
    }
    return null
  }
}

function createKeyClassifier(resolveBinding) {
  const sessionPrefix = 'session:'

  function resolveStringPrefix(node, resolving) {
    const expression = unwrapExpression(node)
    if (!expression) return { prefix: '', complete: false }
    if (ts.isStringLiteralLike(expression)) return { prefix: expression.text, complete: true }

    if (ts.isIdentifier(expression)) {
      const binding = resolveBinding(expression)
      if (binding?.kind !== 'const' || resolving.has(binding.declaration)) return { prefix: '', complete: false }
      const nextResolving = new Set(resolving).add(binding.declaration)
      return resolveStringPrefix(binding.initializer, nextResolving)
    }

    if (ts.isTemplateExpression(expression)) {
      let prefix = expression.head.text
      for (const span of expression.templateSpans) {
        const resolvedExpression = resolveStringPrefix(span.expression, resolving)
        if (!resolvedExpression.complete) {
          return { prefix: prefix + resolvedExpression.prefix, complete: false }
        }
        prefix += resolvedExpression.prefix + span.literal.text
      }
      return { prefix, complete: true }
    }

    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolveStringPrefix(expression.left, resolving)
      if (!left.complete) return left
      const right = resolveStringPrefix(expression.right, resolving)
      return { prefix: left.prefix + right.prefix, complete: right.complete }
    }

    return { prefix: '', complete: false }
  }

  function classify(node, resolving = new Set()) {
    const expression = unwrapExpression(node)
    if (!expression) return 'unknown'

    if (ts.isIdentifier(expression)) {
      const binding = resolveBinding(expression)
      if (binding?.kind !== 'const' || resolving.has(binding.declaration)) return 'unknown'
      const nextResolving = new Set(resolving).add(binding.declaration)
      return classify(binding.initializer, nextResolving)
    }

    if (ts.isCallExpression(expression)) {
      const calledPath = propertyPath(expression.expression)
      if (calledPath === 'StorageKeyGenerator.session' || calledPath === 'backupSessionStorageKey') {
        return 'session'
      }
      if (
        ts.isIdentifier(expression.expression) &&
        resolveBinding(expression.expression)?.kind === 'non-session-key-sanitizer'
      ) {
        return 'provably-safe'
      }
    }

    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      classify(expression.left, resolving) === 'session'
    ) {
      return 'session'
    }

    if (
      ts.isTemplateExpression(expression) &&
      expression.head.text === '' &&
      expression.templateSpans.length > 0 &&
      classify(expression.templateSpans[0].expression, resolving) === 'session'
    ) {
      return 'session'
    }

    const resolved = resolveStringPrefix(expression, resolving)
    if (resolved.prefix.startsWith(sessionPrefix)) return 'session'
    if (resolved.complete) return 'provably-safe'
    if (resolved.prefix && !sessionPrefix.startsWith(resolved.prefix)) return 'provably-safe'
    return 'unknown'
  }

  return classify
}

function callTarget(node) {
  const expression = unwrapExpression(node.expression)
  if (ts.isPropertyAccessExpression(expression)) {
    return { receiver: expression.expression, method: expression.name.text }
  }
  if (ts.isElementAccessExpression(expression)) {
    const method = staticString(expression.argumentExpression)
    return method === null ? null : { receiver: expression.expression, method }
  }
  return null
}

function createControlledReceiverPredicate(resolveBinding, sourceFile, root) {
  const roots = new Set(['options.storage', 'dataStore'])

  function isControlled(node, resolving = new Set(), depth = 0) {
    if (depth >= localTaintDepthLimit) return true
    const expression = unwrapExpression(node)
    const path = propertyPath(expression)
    if (path && roots.has(path)) return true
    if (rendererStorageRequireKind(sourceFile, expression, root) === 'controlled-storage') return true

    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const member = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : staticString(expression.argumentExpression)
      const namespace = unwrapExpression(expression.expression)
      if (
        member === 'default' &&
        ts.isIdentifier(namespace) &&
        resolveBinding(namespace)?.kind === 'controlled-storage-namespace'
      ) {
        return true
      }
    }

    if (!ts.isIdentifier(expression)) return false
    const binding = resolveBinding(expression)
    if (binding?.kind === 'controlled-storage') return true
    if (binding?.kind !== 'const' || resolving.has(binding.declaration)) return false
    return isControlled(binding.initializer, new Set(resolving).add(binding.declaration), depth + 1)
  }

  return isControlled
}

function createRawStorageEscapePredicate(resolveBinding, sourceFile, root) {
  const isControlledReceiver = createControlledReceiverPredicate(resolveBinding, sourceFile, root)

  function functionReturnsRawStorage(node, resolving, depth = 0) {
    if (depth >= localTaintDepthLimit) return true
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      return carriesRawStorage(node.body, resolving, depth + 1)
    }

    const pending = node.body ? [node.body] : []
    while (pending.length > 0) {
      const child = pending.pop()
      if (!child || (child !== node.body && ts.isFunctionLike(child))) continue
      if (
        ts.isReturnStatement(child) &&
        child.expression &&
        carriesRawStorage(child.expression, resolving, depth + 1)
      ) {
        return true
      }
      ts.forEachChild(child, (nested) => pending.push(nested))
    }
    return false
  }

  function constructorAssignsRawStorage(node, resolving, depth) {
    const pending = node.body ? [node.body] : []
    while (pending.length > 0) {
      const child = pending.pop()
      if (!child || (child !== node.body && ts.isFunctionLike(child))) continue
      if (
        ts.isBinaryExpression(child) &&
        isAssignmentOperator(child.operatorToken.kind) &&
        propertyPath(child.left)?.startsWith('this.') &&
        carriesRawStorage(child.right, resolving, depth + 1)
      ) {
        return true
      }
      if (
        ts.isCallExpression(child) &&
        propertyPath(child.expression) === 'Object.assign' &&
        propertyPath(child.arguments[0]) === 'this' &&
        child.arguments.slice(1).some((argument) => carriesRawStorage(argument, resolving, depth + 1))
      ) {
        return true
      }
      ts.forEachChild(child, (nested) => pending.push(nested))
    }
    return false
  }

  function classExposesRawStorage(node, resolving, depth = 0) {
    if (depth >= localTaintDepthLimit) return true
    return node.members.some((member) => {
      if (ts.isPropertyDeclaration(member) && member.initializer) {
        return carriesRawStorage(member.initializer, resolving, depth + 1)
      }
      if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)) {
        return functionReturnsRawStorage(member, resolving, depth + 1)
      }
      if (ts.isConstructorDeclaration(member)) {
        return constructorAssignsRawStorage(member, resolving, depth + 1)
      }
      return false
    })
  }

  function carriesRawStorage(node, resolving = new Set(), depth = 0) {
    if (depth >= localTaintDepthLimit) return true
    const expression = unwrapExpression(node)
    if (!expression) return false
    if (isControlledReceiver(expression, resolving)) return true
    if (rendererStorageRequireKind(sourceFile, expression, root) !== null) return true

    if (ts.isIdentifier(expression)) {
      const binding = resolveBinding(expression)
      if (binding?.kind === 'controlled-storage-namespace') return true
      if (!binding?.declaration || resolving.has(binding.declaration)) return false
      const nextResolving = new Set(resolving).add(binding.declaration)
      if (binding.kind === 'const' || binding.kind === 'variable') {
        return carriesRawStorage(binding.initializer, nextResolving, depth + 1)
      }
      if (binding.kind === 'function') return functionReturnsRawStorage(binding.declaration, nextResolving, depth + 1)
      if (binding.kind === 'class') return classExposesRawStorage(binding.declaration, nextResolving, depth + 1)
      return false
    }

    if (ts.isObjectLiteralExpression(expression)) {
      return expression.properties.some((property) => {
        if (ts.isPropertyAssignment(property)) return carriesRawStorage(property.initializer, resolving, depth + 1)
        if (ts.isShorthandPropertyAssignment(property)) return carriesRawStorage(property.name, resolving, depth + 1)
        if (ts.isSpreadAssignment(property)) return carriesRawStorage(property.expression, resolving, depth + 1)
        if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property)) {
          return functionReturnsRawStorage(property, resolving, depth + 1)
        }
        return false
      })
    }

    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.some((element) => carriesRawStorage(element, resolving, depth + 1))
    }

    if (ts.isConditionalExpression(expression)) {
      return (
        carriesRawStorage(expression.whenTrue, resolving, depth + 1) ||
        carriesRawStorage(expression.whenFalse, resolving, depth + 1)
      )
    }

    if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
      return functionReturnsRawStorage(expression, resolving, depth + 1)
    }

    if (ts.isClassExpression(expression)) return classExposesRawStorage(expression, resolving, depth + 1)
    return false
  }

  return { carriesRawStorage, classExposesRawStorage, functionReturnsRawStorage }
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
}

function isAssignmentOperator(kind) {
  return new Set([
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ]).has(kind)
}

function isCommonJsExportTarget(node) {
  const path = propertyPath(node)
  return path === 'module.exports' || path?.startsWith('module.exports.') || path?.startsWith('exports.')
}

function isCommonJsExportObject(node) {
  const path = propertyPath(node)
  return (
    path === 'exports' ||
    path === 'module.exports' ||
    path?.startsWith('module.exports.') ||
    path?.startsWith('exports.')
  )
}

function containsCommonRawStorageExport(sourceFile, root) {
  const resolveBinding = createLexicalBindingResolver(sourceFile, root)
  const { carriesRawStorage, classExposesRawStorage, functionReturnsRawStorage } = createRawStorageEscapePredicate(
    resolveBinding,
    sourceFile,
    root
  )
  let found = false

  function visit(node) {
    if (found) return

    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const specifier = node.moduleSpecifier ? staticString(node.moduleSpecifier) : null
      if (specifier !== null && isRendererStorageImport(sourceFile, specifier, root)) {
        if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
          found = true
          return
        }
        if (
          node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.some(
            (element) => !element.isTypeOnly && (element.propertyName?.text ?? element.name.text) === 'default'
          )
        ) {
          found = true
          return
        }
      } else if (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          if (element.isTypeOnly) continue
          const localBinding = element.propertyName ?? element.name
          if (carriesRawStorage(localBinding)) {
            found = true
            return
          }
        }
      }
    } else if (ts.isExportAssignment(node) && carriesRawStorage(node.expression)) {
      found = true
      return
    } else if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      if (node.declarationList.declarations.some((declaration) => carriesRawStorage(declaration.initializer))) {
        found = true
        return
      }
    } else if (
      ts.isFunctionDeclaration(node) &&
      hasExportModifier(node) &&
      functionReturnsRawStorage(node, new Set())
    ) {
      found = true
      return
    } else if (ts.isClassDeclaration(node) && hasExportModifier(node) && classExposesRawStorage(node, new Set())) {
      found = true
      return
    } else if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      isCommonJsExportTarget(node.left) &&
      carriesRawStorage(node.right)
    ) {
      found = true
      return
    } else if (ts.isCallExpression(node) && propertyPath(node.expression) === 'Object.assign') {
      const [target, ...sources] = node.arguments
      if (target && isCommonJsExportObject(target) && sources.some((source) => carriesRawStorage(source))) {
        found = true
        return
      }
    } else if (ts.isCallExpression(node) && propertyPath(node.expression) === 'Object.defineProperty') {
      const [target, , descriptor] = node.arguments
      if (target && descriptor && isCommonJsExportObject(target) && carriesRawStorage(descriptor)) {
        found = true
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function containsSessionCapableStorageWrite(sourceFile, root) {
  const resolveBinding = createLexicalBindingResolver(sourceFile, root)
  const classifyKey = createKeyClassifier(resolveBinding)
  const isControlledReceiver = createControlledReceiverPredicate(resolveBinding, sourceFile, root)
  const explicitSessionMethods = new Set(['setItemNow', 'setItem', 'setData', 'removeItem'])
  const controlledDirectWriteMethods = new Set(['setItemNow', 'setItem', 'setData', 'removeItem'])
  let found = false

  function visit(node) {
    if (found) return
    if (ts.isCallExpression(node)) {
      const target = callTarget(node)
      if (!target) {
        ts.forEachChild(node, visit)
        return
      }
      const firstArgument = node.arguments[0]
      const keyClassification = classifyKey(firstArgument)

      if (explicitSessionMethods.has(target.method) && keyClassification === 'session') {
        found = true
        return
      }

      if (isControlledReceiver(target.receiver)) {
        if (
          target.method === 'setAll' ||
          (controlledDirectWriteMethods.has(target.method) && keyClassification !== 'provably-safe')
        ) {
          found = true
          return
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function findSessionStorageViolations(root, readSourceFile) {
  const sessionWriterOwners = new Set([
    join(root, 'src/renderer/adapters/CurrentSessionRecordStore.ts'),
    join(root, 'src/renderer/adapters/CurrentSessionRepository.ts'),
    join(root, 'src/renderer/stores/migration.ts'),
    join(root, 'src/renderer/packages/backup/import-backup.ts'),
    join(root, 'src/renderer/packages/backup/legacy-import.ts'),
    join(root, 'packages/chatbox-core/src/backup/import-backup.ts'),
    join(root, 'packages/chatbox-core/src/backup/legacy-import.ts'),
    join(root, 'src/renderer/pages/SettingDialog/AdvancedSettingTab.tsx'),
  ])
  const rawImportOwners = rawStorageOwners(root)
  const sourceDirectories = [join(root, 'src'), join(root, 'packages')]

  return sourceDirectories.flatMap((sourceDirectory) =>
    walk(sourceDirectory).flatMap((filePath) => {
      const sourceFile = readSourceFile(filePath)
      const violations = []
      if (containsRawStorageCapabilityImport(sourceFile, root) && !rawImportOwners.has(filePath)) {
        violations.push({
          type: 'raw-storage-import',
          boundary: 'Raw renderer storage capability import',
          file: relative(root, filePath),
          supportedPath:
            'Use currentBlobStorage or a typed repository/port. New raw renderer storage owners require an exact-file architecture allowlist entry.',
        })
      }
      if (/\.(?:test|spec)\.[^.]+$/.test(filePath)) return violations
      if (containsCommonRawStorageExport(sourceFile, root)) {
        violations.push({
          type: 'raw-storage-export',
          boundary: 'Raw renderer storage export (bounded single-file check)',
          file: relative(root, filePath),
          supportedPath:
            'Keep raw storage inside its allowlisted owner. This bounded check catches common same-file export wrappers; it is not cross-module taint analysis.',
        })
      }
      if (!sessionWriterOwners.has(filePath) && containsSessionCapableStorageWrite(sourceFile, root)) {
        violations.push({
          type: 'session-storage',
          boundary: 'Session-capable storage writer',
          file: relative(root, filePath),
          supportedPath:
            'Persist session changes through row commands. Session-capable setAll and direct writes without a statically non-Session key are limited to the named migration and import/restore paths.',
        })
      }
      return violations
    })
  )
}

function findWildcardExportViolations(root) {
  const packageManifests = [
    { name: '@chatbox/core', file: join(root, 'packages/chatbox-core/package.json') },
    { name: '@chatbox/i18n', file: join(root, 'packages/chatbox-i18n/package.json') },
    { name: '@chatbox/react', file: join(root, 'packages/chatbox-react/package.json') },
  ]

  return packageManifests.flatMap((packageManifest) => {
    if (!existsSync(packageManifest.file)) return []
    const manifest = JSON.parse(readFileSync(packageManifest.file, 'utf8'))
    return Object.entries(manifest.exports ?? {})
      .filter(([specifier, target]) => specifier.includes('*') || JSON.stringify(target).includes('*'))
      .map(([specifier]) => ({
        type: 'wildcard-export',
        boundary: packageManifest.name,
        file: relative(root, packageManifest.file),
        specifier,
        supportedPath: 'List every public package export explicitly.',
      }))
  })
}

export function checkArchitectureBoundaries(root) {
  const readSourceFile = createSourceFileReader()
  return [
    ...createBoundaries(root).flatMap((boundary) => findImportViolations(root, boundary, readSourceFile)),
    ...findSessionStorageViolations(root, readSourceFile),
    ...sessionBusinessRoots.flatMap((directory) =>
      walk(join(root, directory)).flatMap((file) =>
        findSessionAggregateDependencies(relative(root, file).split(sep).join('/'), readSourceFile(file))
      )
    ),
    ...findWildcardExportViolations(root),
  ]
}

export function formatViolation(violation) {
  const detail = violation.specifier ? `: ${violation.specifier}` : ''
  return `- [${violation.boundary}] ${violation.file}${detail}\n  Supported path: ${violation.supportedPath}`
}

function run() {
  const root = process.cwd()
  const violations = checkArchitectureBoundaries(root)

  if (violations.length > 0) {
    console.error(
      'Architecture boundary check failed. Dependencies, raw storage owners, and Session-capable writers must remain explicit.'
    )
    for (const violation of violations) {
      console.error(formatViolation(violation))
    }
    process.exit(1)
  }

  console.info('Architecture boundary check passed.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
}
