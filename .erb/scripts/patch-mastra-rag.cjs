/**
 * Strips the zeroentropy client (and with it the CVE-flagged node-fetch@2)
 * from the packaged @mastra/rag [SEC-5].
 *
 * @mastra/rag@1.0.8's dist/index.cjs eagerly `require`s 'zeroentropy' at the
 * top of the bundle, but the only consumer is ZeroEntropyRelevanceScorer,
 * which WorkspAIce never instantiates (rerank goes through Cohere directly,
 * src/shared/models/rerank.ts). zeroentropy hard-depends on node-fetch@2.7.0
 * (CVE-2022-0235; no patched 2.x exists, 3.x is ESM-only), so the packaged
 * main process both shipped and loaded the vulnerable module at startup.
 *
 * This runs from ensure-app-deps.cjs (electron-builder beforePack), after
 * `npm install` in release/app, and:
 *  1. rewrites dist/index.cjs so the zeroentropy require is lazy — MDocument
 *     (KB/attachment chunking) is untouched; constructing the scorer would
 *     throw a clear "Cannot find module" instead,
 *  2. removes zeroentropy from the installed @mastra/rag package.json so the
 *     asar collector's `npm list` stays consistent,
 *  3. deletes release/app/node_modules/zeroentropy entirely.
 *
 * Unknown file structure is a HARD FAILURE (unlike patch-libsql's warning):
 * @mastra/rag is exact-pinned, so a mismatch means a deliberate version bump
 * that must re-verify this patch rather than silently re-shipping the eager
 * require. See .ai/ARCHITECTURE_NOTES.md.
 */
const fs = require('fs')
const path = require('path')

const EAGER_REQUIRE = "var ZeroEntropy = require('zeroentropy');\n"
const EAGER_INTEROP = 'var ZeroEntropy__default = /*#__PURE__*/_interopDefault(ZeroEntropy);'
const LAZY_INTEROP =
  'var ZeroEntropy__default = { get default() { const m = require(\'zeroentropy\'); return m && m.__esModule ? m.default : m; } }; // patched by .erb/scripts/patch-mastra-rag.cjs [SEC-5]'

function patchIndexCjs(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')

  if (source.includes(LAZY_INTEROP)) {
    return 'already-patched'
  }

  if (!source.includes(EAGER_REQUIRE) || !source.includes(EAGER_INTEROP)) {
    return 'skip-unknown'
  }

  const patched = source.replace(EAGER_REQUIRE, '').replace(EAGER_INTEROP, LAZY_INTEROP)
  fs.writeFileSync(filePath, patched, 'utf8')
  return 'patched'
}

function removeZeroentropyDependency(pkgJsonPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  if (!pkg.dependencies || !pkg.dependencies.zeroentropy) {
    return 'already-removed'
  }
  delete pkg.dependencies.zeroentropy
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  return 'removed'
}

module.exports = function patchMastraRag(appDir) {
  const ragDir = path.join(appDir, 'node_modules', '@mastra', 'rag')
  const indexCjs = path.join(ragDir, 'dist', 'index.cjs')
  const pkgJson = path.join(ragDir, 'package.json')

  if (!fs.existsSync(indexCjs) || !fs.existsSync(pkgJson)) {
    throw new Error(`[patch-mastra-rag] @mastra/rag not found under ${ragDir} — did npm install run?`)
  }

  const indexState = patchIndexCjs(indexCjs)
  if (indexState === 'skip-unknown') {
    throw new Error(
      `[patch-mastra-rag] unexpected structure in ${indexCjs} — @mastra/rag was likely upgraded; ` +
        're-verify the zeroentropy require and update this patch (see .ai/ARCHITECTURE_NOTES.md [SEC-5])'
    )
  }
  console.log(`[patch-mastra-rag] ${indexState}: lazy zeroentropy require in ${indexCjs}`)

  const depState = removeZeroentropyDependency(pkgJson)
  console.log(`[patch-mastra-rag] ${depState}: zeroentropy dependency in ${pkgJson}`)

  const zeroentropyDir = path.join(appDir, 'node_modules', 'zeroentropy')
  if (fs.existsSync(zeroentropyDir)) {
    fs.rmSync(zeroentropyDir, { recursive: true, force: true })
    console.log(`[patch-mastra-rag] removed ${zeroentropyDir}`)
  } else {
    console.log('[patch-mastra-rag] zeroentropy already absent')
  }
}
