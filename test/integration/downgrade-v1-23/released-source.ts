import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The latest stable release a downgrade must keep working with. */
export const RELEASED_TAG = 'v1.23.5'

const repoRoot = path.resolve(__dirname, '../../..')
const SOURCES = [
  'packages/chatbox-core/src',
  'src/shared',
  'src/renderer/utils',
  'src/renderer/packages/backup',
  'src/renderer/storage',
]

function resolveTag(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '-q', '--verify', `${RELEASED_TAG}^{commit}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/** Null when the checkout has no release tags (for example a shallow CI clone). */
export const releasedCommit = resolveTag()

function rewriteAliases(directory: string, root: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      rewriteAliases(file, root)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    const source = readFileSync(file, 'utf8')
    const rewritten = source
      .replace(/(['"])@shared\//g, `$1${root}/src/shared/`)
      .replace(/(['"])@\//g, `$1${root}/src/renderer/`)
      .replace(/(['"])@chatbox\/core\//g, `$1${root}/packages/chatbox-core/src/`)
    if (rewritten !== source) writeFileSync(file, rewritten)
  }
}

/**
 * Extracts the released reader modules once per commit, checkout and extraction code. Aliases
 * resolve inside the same extraction, so the modules run as released instead of against the
 * current tree; `node_modules` links to this checkout.
 */
function releasedSourceRoot(): string {
  if (!releasedCommit) throw new Error(`${RELEASED_TAG} is not available in this checkout`)
  const key = createHash('sha256')
    .update(`${releasedCommit}\0${repoRoot}\0`)
    .update(readFileSync(__filename))
    .digest('hex')
    .slice(0, 16)
  const root = path.join(os.tmpdir(), `chatbox-released-${key}`)
  if (existsSync(path.join(root, '.ready'))) return root
  const staging = `${root}.${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const archive = execFileSync('git', ['archive', releasedCommit, ...SOURCES], {
    cwd: repoRoot,
    maxBuffer: 1 << 30,
  })
  execFileSync('tar', ['-x', '-C', staging], { input: archive })
  rewriteAliases(staging, root)
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(staging, 'node_modules'), 'dir')
  writeFileSync(path.join(staging, '.ready'), releasedCommit)
  try {
    renameSync(staging, root)
  } catch (error) {
    // Another test worker published the same extraction first.
    rmSync(staging, { recursive: true, force: true })
    if (!existsSync(path.join(root, '.ready'))) throw error
  }
  return root
}

/** Imports a module of the released tree, e.g. `src/renderer/utils/session-utils.ts`. */
export function importReleased<T>(relativePath: string): Promise<T> {
  return import(/* @vite-ignore */ path.join(releasedSourceRoot(), relativePath)) as Promise<T>
}
