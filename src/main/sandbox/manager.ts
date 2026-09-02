import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import {
  copyFile as fsCopyFile,
  readFile as fsReadFile,
  realpath as fsRealpath,
  writeFile as fsWriteFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { pathToFileURL } from 'node:url'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { app, type UtilityProcess, utilityProcess } from 'electron'
import { sandboxAttachmentRelPath } from '../../shared/sandbox/attachment-path'
import {
  SANDBOX_EXEC_ERROR_CODES,
  type SandboxExecErrorCode,
  type SandboxExecLanguage,
  type SandboxExecResult,
  type SandboxOperationResult,
  type SandboxReadResult,
  type SandboxSeedBlobItem,
  type SandboxSeedBlobResult,
} from '../../shared/sandbox-provider'
import {
  TASK_SANDBOX_DENY_READ_PATHS,
  TASK_SANDBOX_DENY_WRITE_PATHS,
  TASK_SANDBOX_EXTRA_WRITE_PATHS,
  TASK_SANDBOX_PROTECTED_GIT_METADATA_PATHS,
} from '../../shared/task-sandbox'
import { shellQuote } from '../../shared/utils/shell'
import { normalizeWindowsAbsolutePath } from '../../shared/utils/windows-path'
import { clearFailedCommandRetries, recordFailedSandboxCommand } from '../command-execution-policy'
import {
  COMMAND_OUTPUT_CAPTURE_FAILED_MESSAGE,
  createCommandOutputCapture,
  createCommandOutputCapturePath,
  getCommandOutputCaptureRoot,
} from '../command-output-capture'
import { buildOperationFinishLog, buildOperationStartLog, createOperationId } from '../operation-log'
import { killProcessTree } from '../process-tree'
import { getChatboxQaPaths } from '../qa-runtime'
import { runRipgrepFileList, runRipgrepSearch } from '../ripgrep-search'
import { getLogger } from '../util'
import { resolveWindowsPowerShell } from '../windows-powershell'
import { pathContainsAttachmentSeedManifest } from './attachment-seed'
import {
  classifyAttachmentSeedCopy,
  classifyAttachmentSeedCopyAgainstManifest,
  readAttachmentSeedManifest,
  recordAttachmentSeed,
} from './attachment-seed-store'
import { buildSandboxStdinScript, stripCodesignNoise } from './exec-script'
import { buildSandboxReadScript } from './file-read'
import { getLoginShellPath } from './login-shell-env'
import { isUnsafeResolvedPath, safeRealpathSync } from './path-safety'
import { headTruncate, tailTruncate } from './truncate'

export { resetWindowsPowerShellResolutionCache, resolveWindowsPowerShell } from '../windows-powershell'

const log = getLogger('sandbox:manager')

type SandboxState = 'idle' | 'initialized'

type ExecResult = SandboxExecResult

interface SandboxStatus {
  state: SandboxState
  workingDirectory: string | null
  platform: string
  homeDirectory: string
}

// ─── Per-session sandbox instances ───────────────────────────────────

interface WritePathGrant {
  /** Lexical path selected by the user or created for the session sandbox. */
  root: string
  /** Canonical target captured when the grant was created. */
  canonicalRoot: string
}

interface WritePathValidationResult {
  valid: boolean
  error?: string
  canonicalTarget?: string
}

interface SandboxSession {
  state: SandboxState
  workingDirectory: string | null
  workingDirectoryGrant: WritePathGrant | null
  /** Real directories explicitly granted by the user for approval-free file-tool writes. */
  userWriteGrants: WritePathGrant[]
  /** Requested configuration used to keep canonical grants stable across repeated initialization. */
  initConfigKey: string | null
  runningChildren: Set<ChildProcess>
  runningChildrenByToolCallId: Map<string, ChildProcess>
  runningUtilities: Set<UtilityProcess>
  runningUtilitiesByToolCallId: Map<string, UtilityProcess>
  pendingCancelledToolCallIds: Set<string>
  /** Per-session sandbox config for wrapWithSandbox customConfig override */
  sandboxConfig: ReturnType<typeof buildConfig> | null
}

// Global SandboxManager ref — initialized once, shared across sessions
let globalSandboxManager: typeof import('@anthropic-ai/sandbox-runtime')['SandboxManager'] | null = null
let globalInitialized = false

const sessions = new Map<string, SandboxSession>()

const DEFAULT_SESSION = '__default__'

function getSession(sessionId?: string): SandboxSession | undefined {
  return sessions.get(sessionId || DEFAULT_SESSION)
}

/**
 * Working directory of a live session, or null when the session is not initialized.
 * Narrow accessor for sibling modules (persist-artifact) — the session registry itself
 * stays private to this module.
 */
export function getSessionWorkingDirectory(sessionId?: string): string | null {
  return getSession(sessionId)?.workingDirectory ?? null
}

function getOrCreateSession(sessionId?: string): SandboxSession {
  const id = sessionId || DEFAULT_SESSION
  let session = sessions.get(id)
  if (!session) {
    session = {
      state: 'idle',
      workingDirectory: null,
      workingDirectoryGrant: null,
      userWriteGrants: [],
      initConfigKey: null,
      runningChildren: new Set(),
      runningChildrenByToolCallId: new Map(),
      runningUtilities: new Set(),
      runningUtilitiesByToolCallId: new Map(),
      pendingCancelledToolCallIds: new Set(),
      sandboxConfig: null,
    }
    sessions.set(id, session)
  }
  return session
}

function terminateTrackedChild(child: ChildProcess): void {
  killProcessTree(child, 'SIGTERM')
  const forceKillHandle = setTimeout(() => killProcessTree(child, 'SIGKILL'), 3_000)
  forceKillHandle.unref()
  const clearForceKill = () => clearTimeout(forceKillHandle)
  child.once('error', clearForceKill)
  child.once('close', clearForceKill)
}

function trackRunningChild(session: SandboxSession, child: ChildProcess, toolCallId?: string): boolean {
  session.runningChildren.add(child)
  if (toolCallId) session.runningChildrenByToolCallId.set(toolCallId, child)

  const cleanup = () => {
    session.runningChildren.delete(child)
    if (toolCallId && session.runningChildrenByToolCallId.get(toolCallId) === child) {
      session.runningChildrenByToolCallId.delete(toolCallId)
    }
  }
  child.once('error', cleanup)
  child.once('close', cleanup)
  return toolCallId ? session.pendingCancelledToolCallIds.delete(toolCallId) : false
}

function trackRunningUtility(session: SandboxSession, child: UtilityProcess, toolCallId?: string): boolean {
  session.runningUtilities.add(child)
  if (toolCallId) session.runningUtilitiesByToolCallId.set(toolCallId, child)

  const cleanup = () => {
    session.runningUtilities.delete(child)
    if (toolCallId && session.runningUtilitiesByToolCallId.get(toolCallId) === child) {
      session.runningUtilitiesByToolCallId.delete(toolCallId)
    }
  }
  child.once('exit', cleanup)
  return toolCallId ? session.pendingCancelledToolCallIds.delete(toolCallId) : false
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isHarmonyBuild(): boolean {
  return process.env.CHATBOX_BUILD_TARGET === 'harmony_app'
}

/** True if a command can start and complete successfully. Used only on win32. */
function commandSucceeds(cmd: string, args: string[], timeout = 3_000): boolean {
  try {
    return spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true, timeout }).status === 0
  } catch {
    return false
  }
}

export interface WindowsBashResolution {
  kind: 'git-bash' | 'path-bash' | 'wsl'
  cmd: string
  args: string[]
}

function findWindowsExecutables(name: 'git.exe' | 'bash.exe'): string[] {
  try {
    const result = spawnSync('where.exe', [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 3_000,
    })
    if (result.status !== 0 || !result.stdout) return []

    const cwd = path.win32.resolve(process.cwd()).toLowerCase()
    return result.stdout
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .filter((candidate) => {
        const resolved = path.win32.resolve(candidate).toLowerCase()
        const dir = path.win32.dirname(resolved)
        return dir !== cwd && !dir.startsWith(`${cwd}\\`)
      })
  } catch {
    return []
  }
}

function getKnownGitBashCandidates(): string[] {
  const roots = [
    path.win32.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git'),
    path.win32.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git'),
    ...(process.env.LOCALAPPDATA ? [path.win32.join(process.env.LOCALAPPDATA, 'Programs', 'Git')] : []),
    ...(process.env.USERPROFILE ? [path.win32.join(process.env.USERPROFILE, 'scoop', 'apps', 'git', 'current')] : []),
  ]
  return roots.map((root) => path.win32.join(root, 'bin', 'bash.exe'))
}

function findGitBash(): string | null {
  const override = process.env.CHATBOX_GIT_BASH_PATH
  if (override && commandSucceeds(override, ['--version'])) return override

  for (const candidate of getKnownGitBashCandidates()) {
    if (commandSucceeds(candidate, ['--version'])) return candidate
  }

  for (const gitExe of findWindowsExecutables('git.exe')) {
    const gitDir = path.win32.dirname(gitExe)
    const candidates = [
      path.win32.join(gitDir, 'bash.exe'),
      path.win32.join(gitDir, '..', 'bin', 'bash.exe'),
      path.win32.join(gitDir, '..', 'usr', 'bin', 'bash.exe'),
    ]
    for (const candidate of candidates) {
      if (commandSucceeds(candidate, ['--version'])) return candidate
    }
  }

  return null
}

/** WSL can be installed without a Linux distribution, in which case it cannot run bash. */
function hasInstalledWslDistribution(): boolean {
  try {
    const result = spawnSync('wsl', ['--list', '--quiet'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 3_000,
    })
    if (result.status !== 0 || !result.stdout?.length) return false
    // wsl.exe may emit UTF-16LE (including a BOM) when stdout is piped.
    const isUtf16Le =
      (result.stdout[0] === 0xff && result.stdout[1] === 0xfe) || (result.stdout.length > 1 && result.stdout[1] === 0)
    const output = result.stdout.toString(isUtf16Le ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '')
    return output.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Resolve a POSIX shell for the `bash` code-execution language on native Windows.
 * Prefer an explicit Git Bash path so its `/c/...` path model is predictable. Preserve
 * compatibility with other PATH-provided POSIX shells, then fall back to WSL as a distinct
 * shell kind. Scripts are fed via stdin and the working directory is supplied through spawn.
 */
export function resolveWindowsBash(): WindowsBashResolution | null {
  const gitBash = findGitBash()
  if (gitBash) return { kind: 'git-bash', cmd: gitBash, args: [] }

  const bashOnPath = findWindowsExecutables('bash.exe')[0]
  if (bashOnPath && commandSucceeds(bashOnPath, ['--version'])) {
    const normalized = path.win32.normalize(bashOnPath).toLowerCase()
    const kind = /\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized) ? 'wsl' : 'path-bash'
    return { kind, cmd: bashOnPath, args: [] }
  }

  // Keep the old command-name fallback for POSIX shells exposed through a custom process PATH.
  if (commandSucceeds('bash', ['--version'])) return { kind: 'path-bash', cmd: 'bash', args: [] }
  if (hasInstalledWslDistribution()) return { kind: 'wsl', cmd: 'wsl', args: ['bash'] }
  return null
}

/**
 * On Windows, bash (Git Bash / WSL / Cygwin) reports POSIX-style paths from `realpath`
 * (`/c/...`, `/mnt/c/...`, `/cygdrive/c/...`). Convert them back to native Windows form so
 * artifact validation against Windows roots works (e.g. create_download). No-op for paths
 * already in Windows form, for relative paths, and on non-Windows platforms.
 */
export function normalizeWindowsShellPath(p: string): string {
  if (process.platform !== 'win32') return p
  return normalizeWindowsAbsolutePath(p) ?? p
}

function createWritePathGrant(root: string): WritePathGrant {
  const resolvedRoot = path.resolve(root)
  return { root: resolvedRoot, canonicalRoot: safeRealpathSync(resolvedRoot) }
}

function createExistingDirectoryGrant(root: string): WritePathGrant | null {
  try {
    const resolvedRoot = path.resolve(root)
    if (!statSync(resolvedRoot).isDirectory()) return null
    return { root: resolvedRoot, canonicalRoot: realpathSync.native(resolvedRoot) }
  } catch {
    return null
  }
}

function getSafeUserWriteGrants(userWritePaths: string[]): WritePathGrant[] {
  const safeGrants: WritePathGrant[] = []
  for (const userPath of userWritePaths) {
    const normalized = normalizeWindowsShellPath(userPath)
    if (!path.isAbsolute(normalized)) {
      log.warn(`Refusing to grant sandbox write access to unsafe directory: ${userPath}`)
      continue
    }
    const grant = createExistingDirectoryGrant(normalized)
    if (!grant) {
      log.warn(`Refusing to grant sandbox write access to unavailable directory: ${userPath}`)
      continue
    }
    // Check both the selected path and its canonical target so a symlink cannot smuggle
    // a broad or sensitive root into allowWrite.
    if (isUnsafeResolvedPath(grant.root) || isUnsafeResolvedPath(grant.canonicalRoot)) {
      log.warn(`Refusing to grant sandbox write access to unsafe directory: ${userPath}`)
      continue
    }
    safeGrants.push(grant)
  }
  return safeGrants.filter(
    (grant, index) => safeGrants.findIndex((candidate) => path.relative(candidate.root, grant.root) === '') === index
  )
}

function getSandboxInitConfigKey(workDir: string, userWritePaths: string[]): string {
  const normalizeRequestedPath = (requestedPath: string) => {
    const normalized = normalizeWindowsShellPath(requestedPath)
    return path.isAbsolute(normalized) ? path.resolve(normalized) : normalized
  }
  return JSON.stringify({
    workDir: path.resolve(workDir),
    userWritePaths: userWritePaths.map(normalizeRequestedPath),
  })
}

// True when `child` is `parent` or lives under it (lexical, after resolution).
function pathContains(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function buildConfig(
  workDir: string,
  // Extra real directories the user granted write access to (sandbox working-directory
  // feature). buildConfig is macOS/Linux-only (Windows skips SRT), so these are POSIX paths.
  userWriteGrants: WritePathGrant[] = []
): Omit<SandboxRuntimeConfig, 'network'> & {
  network: Omit<SandboxRuntimeConfig['network'], 'allowedDomains'>
} {
  // buildConfig is only used by the macOS/Linux SRT path; Windows skips SRT (see initSandbox).
  const isMacOS = process.platform === 'darwin'
  const tempWritePaths = [tmpdir(), '/tmp'].flatMap((p) => [p, safeRealpathSync(p)])
  // Both the lexical and symlink-resolved forms of each granted dir.
  const userWriteVariants = userWriteGrants.flatMap((grant) => [grant.root, grant.canonicalRoot])
  const allowWrite = [...new Set([workDir, ...TASK_SANDBOX_EXTRA_WRITE_PATHS, ...tempWritePaths, ...userWriteVariants])]

  // Protect sensitive files (.env, etc.) inside granted dirs with ABSOLUTE deny paths.
  // The bare relative patterns in TASK_SANDBOX_DENY_WRITE_PATHS are resolved by
  // sandbox-runtime against the main-process cwd, so they do NOT cover the granted dirs;
  // we must anchor them explicitly (top-level + nested via glob).
  const userDenyWrite = userWriteVariants.flatMap((base) =>
    TASK_SANDBOX_DENY_WRITE_PATHS.flatMap((name) => [`${base}/${name}`, `${base}/**/${name}`])
  )
  // Top-level Git metadata protection (see TASK_SANDBOX_PROTECTED_GIT_METADATA_PATHS):
  // anchored per granted root, deliberately without `**` so `git clone`/`git init` in
  // subdirectories still work — only the user's own repo root is protected.
  const userGitMetadataDenyWrite = userWriteVariants.flatMap((base) =>
    TASK_SANDBOX_PROTECTED_GIT_METADATA_PATHS.flatMap((name) => [`${base}/${name}`, `${base}/${name}/**`])
  )
  const denyWrite = [...new Set([...TASK_SANDBOX_DENY_WRITE_PATHS, ...userDenyWrite, ...userGitMetadataDenyWrite])]
  const captureRoot = getCommandOutputCaptureRoot()

  // WARN: `allowedDomains: ['*']` is NOT a wildcard — it's a literal match.
  // Omit `allowedDomains` so wrapWithSandbox generates `(allow network*)`.
  return {
    ...(isMacOS ? { ripgrep: { command: 'sh' } } : {}),
    network: {
      deniedDomains: [] as string[],
    },
    filesystem: {
      denyRead: [...TASK_SANDBOX_DENY_READ_PATHS, captureRoot, safeRealpathSync(captureRoot)],
      allowWrite,
      denyWrite,
    },
  }
}

function getSandboxRuntimeImportTarget(): string {
  if (!app.isPackaged) {
    return '@anthropic-ai/sandbox-runtime'
  }

  const candidateEntries = [
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@anthropic-ai',
      'sandbox-runtime',
      'dist',
      'index.js'
    ),
    path.join(
      process.resourcesPath,
      'app.asar',
      'node_modules',
      '@anthropic-ai',
      'sandbox-runtime',
      'dist',
      'index.js'
    ),
  ]

  for (const candidate of candidateEntries) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href
    }
  }

  return '@anthropic-ai/sandbox-runtime'
}

/** @deprecated Use shellQuote from '@shared/utils/shell' instead. Kept for backwards compat. */
export const shellEscape = shellQuote

/**
 * Validate that a resolved target path is inside the sandbox working directory.
 * Defense-in-depth: also checks for symlinks that could redirect writes outside the sandbox.
 */
async function validateWritePathAgainstGrants(
  resolved: string,
  allowedRoots: WritePathGrant[]
): Promise<WritePathValidationResult> {
  const targetPath = path.resolve(resolved)

  for (const grant of allowedRoots) {
    if (!pathContains(grant.root, targetPath)) continue

    // Resolve the nearest existing ancestor so junctions/symlinks in any parent component
    // cannot redirect a new file outside the user-granted root.
    let existingAncestor = targetPath
    const missingSegments: string[] = []
    while (!existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor)
      if (parent === existingAncestor) break
      missingSegments.unshift(path.basename(existingAncestor))
      existingAncestor = parent
    }

    try {
      const realRoot = await fsRealpath(grant.root)
      // The selected root itself may be replaced with a symlink/junction after initialization.
      // Keep the grant pinned to the canonical target that the user originally selected.
      if (path.relative(grant.canonicalRoot, realRoot) !== '') continue
      const realAncestor = await fsRealpath(existingAncestor)
      const realTarget = path.resolve(realAncestor, ...missingSegments)
      if (pathContains(grant.canonicalRoot, realTarget)) return { valid: true, canonicalTarget: realTarget }
    } catch {
      // A selected directory can disappear or change while the app is running. Fail closed
      // instead of recreating or following a path whose canonical boundary is now unknown.
    }
  }
  return { valid: false, error: 'Invalid path: outside sandbox or granted working directories' }
}

export async function validateWritePath(
  resolved: string,
  workDir: string,
  userWritePaths: string[] = []
): Promise<{ valid: boolean; error?: string }> {
  const grants = [createWritePathGrant(workDir), ...userWritePaths.map(createWritePathGrant)]
  const validation = await validateWritePathAgainstGrants(resolved, grants)
  return validation.valid ? { valid: true } : { valid: false, error: validation.error }
}

function isProtectedUserWritePath(
  resolved: string,
  canonicalTarget: string | undefined,
  grants: WritePathGrant[]
): boolean {
  const normalizeName = (name: string) => {
    if (process.platform !== 'win32') return name
    // NTFS exposes streams as `filename:stream:type`; `filename::$DATA` is the
    // default stream and is equivalent to writing the file itself. Compare the
    // base filename so stream syntax cannot bypass protected-name checks.
    const streamSeparator = name.indexOf(':')
    const baseName = streamSeparator >= 0 ? name.slice(0, streamSeparator) : name
    return baseName.replace(/[. ]+$/u, '').toLowerCase()
  }
  const deniedNames = new Set(TASK_SANDBOX_DENY_WRITE_PATHS.map(normalizeName))
  const containsProtectedSegment = (root: string, target: string) => {
    if (!pathContains(root, target)) return false
    const relativeSegments = path.relative(root, target).split(path.sep)
    return relativeSegments.some((segment) => deniedNames.has(normalizeName(segment)))
  }

  const targetPath = path.resolve(resolved)
  return grants.some(
    (grant) =>
      containsProtectedSegment(grant.root, targetPath) ||
      (canonicalTarget !== undefined && containsProtectedSegment(grant.canonicalRoot, canonicalTarget))
  )
}

// Main-process file tools bypass the OS sandbox, so the seatbelt denyWrite rules for
// top-level Git metadata (buildConfig) are mirrored here for user-granted roots.
function isProtectedGitMetadataPath(
  resolved: string,
  canonicalTarget: string | undefined,
  grants: WritePathGrant[]
): boolean {
  const normalizeRel = (rel: string) => {
    const posix = rel.split(path.sep).join('/')
    return process.platform === 'win32' ? posix.toLowerCase() : posix
  }
  const matchesProtectedMetadata = (root: string, target: string) => {
    if (!pathContains(root, target)) return false
    const rel = normalizeRel(path.relative(root, target))
    return TASK_SANDBOX_PROTECTED_GIT_METADATA_PATHS.some((name) => rel === name || rel.startsWith(`${name}/`))
  }

  const targetPath = path.resolve(resolved)
  return grants.some(
    (grant) =>
      matchesProtectedMetadata(grant.root, targetPath) ||
      (canonicalTarget !== undefined && matchesProtectedMetadata(grant.canonicalRoot, canonicalTarget))
  )
}

async function validateSessionWritePath(session: SandboxSession, resolved: string): Promise<WritePathValidationResult> {
  const allowedRoots = [session.workingDirectoryGrant, ...session.userWriteGrants].filter(
    (grant): grant is WritePathGrant => grant !== null
  )
  const validation = await validateWritePathAgainstGrants(resolved, allowedRoots)
  if (!validation.valid) {
    return session.userWriteGrants.length > 0 ? validation : { valid: false, error: 'Invalid path: outside sandbox' }
  }
  if (
    isProtectedUserWritePath(resolved, validation.canonicalTarget, session.userWriteGrants) ||
    isProtectedGitMetadataPath(resolved, validation.canonicalTarget, session.userWriteGrants) ||
    pathContainsAttachmentSeedManifest(resolved)
  ) {
    return { valid: false, error: 'Write access denied for protected file' }
  }
  return validation
}

/**
 * Write content to a file, handling data URLs (base64) and plain text.
 * Creates parent directories as needed.
 */
/** Decode copy-in content (a data URL or plain text) into the exact bytes written to disk. */
function contentToFileBuffer(content: string): Buffer {
  if (content.startsWith('data:')) {
    const base64Match = content.match(/^data:[^;]*;base64,(.*)$/)
    if (base64Match) return Buffer.from(base64Match[1], 'base64')
    const commaIndex = content.indexOf(',')
    return Buffer.from(commaIndex >= 0 ? content.slice(commaIndex + 1) : content, 'utf-8')
  }
  return Buffer.from(content, 'utf-8')
}

/**
 * View a Buffer's bytes as a plain Uint8Array. Node types `Buffer.buffer` as
 * `ArrayBufferLike`, which no longer satisfies the `Uint8Array` parameters of
 * `fs.writeFile` and `Buffer#equals`, so byte APIs take this zero-copy view.
 */
function toByteView(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

async function writeContentToFile(targetPath: string, content: string): Promise<void> {
  const parentDir = path.dirname(targetPath)
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }
  await fsWriteFile(targetPath, toByteView(contentToFileBuffer(content)))
}

// ─── Sandbox lifecycle ───────────────────────────────────────────────

export async function initSandbox(
  workDir: string,
  sessionId?: string,
  userWritePaths: string[] = []
): Promise<{ success: boolean; acceptedWorkingDirectories?: string[]; error?: string }> {
  let session = getOrCreateSession(sessionId)
  const initConfigKey = getSandboxInitConfigKey(workDir, userWritePaths)

  if (session.state === 'initialized') {
    if (session.initConfigKey === initConfigKey) {
      return { success: true, acceptedWorkingDirectories: session.userWriteGrants.map((grant) => grant.root) }
    }
    log.info(`Sandbox session ${sessionId || DEFAULT_SESSION} already initialized, resetting first`)
    await resetSandbox(sessionId)
    // resetSandbox deletes the session from the Map, so re-create it
    session = getOrCreateSession(sessionId)
  }

  const safeUserWriteGrants = getSafeUserWriteGrants(userWritePaths)
  const workingDirectoryGrant = createWritePathGrant(workDir)

  // Native Windows and HarmonyOS paths skip @anthropic-ai/sandbox-runtime. HarmonyOS reports
  // process.platform=linux, but cannot run bubblewrap/socat inside a HAP; Node code is launched
  // through Electron's utilityProcess instead (see execHarmonyNodeCode below).
  if (process.platform === 'win32' || isHarmonyBuild()) {
    session.workingDirectory = workDir
    session.workingDirectoryGrant = workingDirectoryGrant
    session.userWriteGrants = safeUserWriteGrants
    session.initConfigKey = initConfigKey
    session.state = 'initialized'
    const backend = isHarmonyBuild() ? 'HarmonyOS utility process' : 'native Windows, no OS isolation'
    log.info(`Sandbox session ${sessionId || DEFAULT_SESSION} initialized (${backend})`)
    return { success: true, acceptedWorkingDirectories: safeUserWriteGrants.map((grant) => grant.root) }
  }

  // Warm the login-shell PATH cache so the first exec doesn't pay the shell-fork latency.
  void getLoginShellPath()

  try {
    // Initialize the global SandboxManager once (shared across sessions).
    // Per-session config is passed via customConfig to wrapWithSandbox().
    if (!globalSandboxManager) {
      const { SandboxManager } = await import(getSandboxRuntimeImportTarget())
      globalSandboxManager = SandboxManager
    }

    const config = buildConfig(workDir, safeUserWriteGrants)
    log.info(
      `Initializing sandbox session=${sessionId || DEFAULT_SESSION} workDir=${workDir} platform=${process.platform} extraWritePaths=${userWritePaths.length}`
    )

    if (!globalInitialized && globalSandboxManager) {
      await globalSandboxManager.initialize(config as Parameters<typeof globalSandboxManager.initialize>[0])
      globalInitialized = true
    }

    session.sandboxConfig = config
    session.workingDirectory = workDir
    session.workingDirectoryGrant = workingDirectoryGrant
    session.userWriteGrants = safeUserWriteGrants
    session.initConfigKey = initConfigKey
    session.state = 'initialized'
    log.info(`Sandbox session ${sessionId || DEFAULT_SESSION} initialized successfully`)
    return { success: true, acceptedWorkingDirectories: safeUserWriteGrants.map((grant) => grant.root) }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error('Sandbox initialization failed:', msg)
    return { success: false, error: msg }
  }
}

export const HARMONY_UTILITY_RUNNER_SOURCE = `'use strict'
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const util = require('node:util')

// HarmonyOS Electron currently crashes in uv_set_process_title. User code should not be
// able to trigger that native failure while running inside the utility process.
try {
  Object.defineProperty(process, 'title', {
    configurable: true,
    get: () => 'chatbox-code',
    set: () => {},
  })
} catch {}

const codePath = path.resolve(process.argv[2])
const resultPath = path.resolve(process.argv[3])
const code = fs.readFileSync(codePath, 'utf8').replace(/^#!.*\\r?\\n/, '')
const userModule = new Module(codePath)
userModule.filename = codePath
userModule.paths = Module._nodeModulePaths(path.dirname(codePath))
// Materialize stdio before taking the baseline; Node creates these handles lazily on first
// access, and they must not be mistaken for user-created background work.
void process.stdout
void process.stderr
const baselineHandles = new Set(process._getActiveHandles())
const maxCaptureBytes = 10 * 1024 * 1024
const capturedOutput = {
  stdout: { chunks: [], bytes: 0, capped: false },
  stderr: { chunks: [], bytes: 0, capped: false },
}

function captureOutput(stream, chunk, encoding) {
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8')
  const capture = capturedOutput[stream]
  capture.bytes += buffer.byteLength
  if (!capture.capped) {
    if (capture.bytes > maxCaptureBytes) capture.capped = true
    else capture.chunks.push(buffer)
  }
}

function createOutputProxy(stream, output) {
  return new Proxy(output, {
    get(target, property) {
      if (property === 'write') {
        return (chunk, encoding, callback) => {
          let normalizedEncoding = encoding
          let normalizedCallback = callback
          if (typeof normalizedEncoding === 'function') {
            normalizedCallback = normalizedEncoding
            normalizedEncoding = undefined
          }
          captureOutput(stream, chunk, normalizedEncoding)
          return target.write(chunk, normalizedEncoding, normalizedCallback)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const userStdout = createOutputProxy('stdout', process.stdout)
const userStderr = createOutputProxy('stderr', process.stderr)
const userProcess = new Proxy(process, {
  get(target, property) {
    if (property === 'stdout') return userStdout
    if (property === 'stderr') return userStderr
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
  set(target, property, value) {
    return Reflect.set(target, property, value, target)
  },
})
const stdoutConsoleMethods = new Set(['log', 'info', 'debug'])
const stderrConsoleMethods = new Set(['error', 'warn'])
const userConsole = new Proxy(console, {
  get(target, property) {
    if (stdoutConsoleMethods.has(property) || stderrConsoleMethods.has(property)) {
      return (...args) => {
        captureOutput(stdoutConsoleMethods.has(property) ? 'stdout' : 'stderr', util.format(...args) + '\\n')
        return target[property](...args)
      }
    }
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
})
global.__chatboxUserConsole = userConsole
global.__chatboxUserProcess = userProcess

// HarmonyOS Electron does not currently deliver utilityProcess stdout/stderr pipes reliably.
// Its Module._compile implementation also ignores injected source prefixes, so execute through
// AsyncFunction and pass controlled globals explicitly instead.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const userFunction = new AsyncFunction(
  'exports',
  'require',
  'module',
  '__filename',
  '__dirname',
  'console',
  'process',
  code
)
userModule.exports = userFunction(
  userModule.exports,
  userModule.require.bind(userModule),
  userModule,
  codePath,
  path.dirname(codePath),
  userConsole,
  userProcess
)

function reportCompletion(exitCode) {
  // HarmonyOS utilityProcess reliably signals completion but drops stdio and additional message
  // fields. Persist the bounded result inside the app sandbox and use parentPort only as a signal.
  fs.writeFileSync(resultPath, JSON.stringify({
    exitCode,
    stdout: Buffer.concat(capturedOutput.stdout.chunks).toString('base64'),
    stderr: Buffer.concat(capturedOutput.stderr.chunks).toString('base64'),
    stdoutBytes: capturedOutput.stdout.bytes,
    stderrBytes: capturedOutput.stderr.bytes,
    stdoutCapped: capturedOutput.stdout.capped,
    stderrCapped: capturedOutput.stderr.capped,
  }), 'utf8')
  process.parentPort.postMessage({ type: 'chatbox-exec-complete', exitCode })
}

function waitForUserWorkToSettle(exitCode) {
  let idlePasses = 0
  const poll = () => {
    const userHandles = process._getActiveHandles().filter((handle) => !baselineHandles.has(handle))
    const activeRequests = process._getActiveRequests()
    if (userHandles.length === 0 && activeRequests.length === 0) idlePasses += 1
    else idlePasses = 0

    if (idlePasses >= 3) reportCompletion(exitCode)
    else setTimeout(poll, 10)
  }
  poll()
}

Promise.resolve(userModule.exports).then(
  () => waitForUserWorkToSettle(process.exitCode || 0),
  (error) => {
    userConsole.error(error && error.stack ? error.stack : error)
    waitForUserWorkToSettle(1)
  }
)
`

async function ensureHarmonyUtilityRunner(): Promise<string> {
  const runtimeDir = path.join(app.getPath('userData'), 'chatbox-sandbox', 'runtime')
  mkdirSync(runtimeDir, { recursive: true })
  const runnerPath = path.join(runtimeDir, 'harmony-node-runner.cjs')
  await fsWriteFile(runnerPath, HARMONY_UTILITY_RUNNER_SOURCE, 'utf-8')
  return runnerPath
}

async function execHarmonyNodeCode(params: {
  code: string
  cwd?: string
  timeout: number
  session: SandboxSession
  operationId: string
  startedAt: number
  toolCallId?: string
}): Promise<ExecResult> {
  const cwd = params.cwd ?? process.cwd()
  const runnerPath = await ensureHarmonyUtilityRunner()
  const codePath = path.join(cwd, `.chatbox-exec-${randomUUID()}.cjs`)
  const resultPath = `${codePath}.result.json`
  await fsWriteFile(codePath, params.code, 'utf-8')

  const cacheDir = path.join(cwd, '.cache')
  mkdirSync(cacheDir, { recursive: true })
  // Unlike the desktop path, HarmonyOS has no OS sandbox wrapping the child, so the
  // HOME/TMPDIR redirect is the only thing steering tools away from the app's real
  // directories. Keep it.
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      HOME: cwd,
      TMPDIR: cwd,
      TMP: cwd,
      TEMP: cwd,
      XDG_CACHE_HOME: cacheDir,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const MAX_BUFFER_BYTES = 10 * 1024 * 1024

  return await new Promise((resolve) => {
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutCapped = false
    let stderrCapped = false
    let timedOut = false
    let settled = false
    let completedExitCode: number | undefined
    let child: UtilityProcess | undefined

    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rmSync(codePath, { force: true })
      rmSync(resultPath, { force: true })

      stdoutChunks.push(stdoutDecoder.end())
      stderrChunks.push(stderrDecoder.end())
      let stdout = tailTruncate(stdoutChunks.join(''))
      let stderr = tailTruncate(stripCodesignNoise(stderrChunks.join('')))
      const exitCode = timedOut ? 124 : (completedExitCode ?? code)
      if (stdoutCapped) stdout += `\n[Output truncated: exceeded ${MAX_BUFFER_BYTES / 1024 / 1024}MB buffer limit]`
      if (stderrCapped) stderr += `\n[Stderr truncated: exceeded ${MAX_BUFFER_BYTES / 1024 / 1024}MB buffer limit]`
      if (timedOut) stderr += `\n[Process timed out after ${params.timeout}ms]`

      const finishLog = buildOperationFinishLog({
        operationId: params.operationId,
        success: exitCode === 0,
        exitCode,
        durationMs: Date.now() - params.startedAt,
        timedOut,
        stdout,
        stderr,
        stdoutBytes,
        stderrBytes,
      })
      if (exitCode === 0) log.info(finishLog)
      else log.warn(finishLog)
      resolve({ stdout, stderr, exitCode })
    }

    const timer = setTimeout(() => {
      timedOut = true
      child?.kill()
    }, params.timeout)

    try {
      child = utilityProcess.fork(runnerPath, [codePath, resultPath], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        serviceName: 'Chatbox Code Execution',
      })
      const cancelAfterRegistration = trackRunningUtility(params.session, child, params.toolCallId)

      // Drain the platform pipes to avoid backpressure, but receive user output over parentPort.
      // HarmonyOS Electron currently exposes these streams without delivering their data events.
      child.stdout?.resume()
      child.stderr?.resume()
      child.on('error', (type, location, report) => {
        const message = `${type}${location ? ` at ${location}` : ''}${report ? `\n${report}` : ''}`
        stderrBytes += Buffer.byteLength(message)
        if (!stderrCapped) {
          if (stderrBytes > MAX_BUFFER_BYTES) stderrCapped = true
          else stderrChunks.push(message)
        }
      })
      child.on('message', (message) => {
        if (typeof message !== 'object' || message === null) return
        const utilityMessage = message as {
          type?: unknown
          exitCode?: unknown
        }
        if (utilityMessage.type === 'chatbox-exec-complete' && typeof utilityMessage.exitCode === 'number') {
          try {
            const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
              stdout?: unknown
              stderr?: unknown
              stdoutBytes?: unknown
              stderrBytes?: unknown
              stdoutCapped?: unknown
              stderrCapped?: unknown
            }
            if (typeof result.stdout === 'string') {
              stdoutChunks.push(stdoutDecoder.write(Buffer.from(result.stdout, 'base64')))
            }
            if (typeof result.stderr === 'string') {
              stderrChunks.push(stderrDecoder.write(Buffer.from(result.stderr, 'base64')))
            }
            if (typeof result.stdoutBytes === 'number') stdoutBytes += result.stdoutBytes
            if (typeof result.stderrBytes === 'number') stderrBytes += result.stderrBytes
            if (result.stdoutCapped === true) stdoutCapped = true
            if (result.stderrCapped === true) stderrCapped = true
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            stderrChunks.push(message)
            stderrBytes += Buffer.byteLength(message)
          }
          completedExitCode = utilityMessage.exitCode
          child?.kill()
        }
      })
      child.on('exit', finish)
      if (cancelAfterRegistration) child.kill()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      stderrChunks.push(message)
      stderrBytes += Buffer.byteLength(message)
      finish(1)
    }
  })
}

/**
 * Execute agent code inside the sandbox. The program is fed to the child via stdin (see
 * {@link buildSandboxStdinScript}), so the user's bytes never touch a host shell command line —
 * there is no shell escaping and no base64 round-trip.
 *
 * macOS/Linux: the spawn argv comes from SandboxManager.wrapWithSandboxArgv() and runs with
 * {shell:false}, applying SRT confinement. HarmonyOS: Node.js runs through Electron's
 * utilityProcess inside the application sandbox; Bash and PowerShell are unavailable.
 * Windows: @anthropic-ai/sandbox-runtime does not run there, so the program executes natively
 * with NO OS sandbox (see docs/technical/windows-sandbox.md) — the session working directory
 * is the only scoping.
 */
export async function execCode(params: {
  code: string
  language: SandboxExecLanguage
  timeout?: number
  cwd?: string
  sessionId?: string
  toolCallId?: string
  outputFilePath?: string
}): Promise<ExecResult> {
  const session = getSession(params.sessionId)
  if (!session || session.state !== 'initialized') {
    throw new Error('Sandbox not initialized. Call initSandbox first.')
  }
  const isWindows = process.platform === 'win32'
  const cwd = params.cwd ?? session.workingDirectory ?? undefined
  const timeout = params.timeout ?? 30_000
  const operationId = createOperationId()
  const startedAt = Date.now()

  log.info(
    buildOperationStartLog({
      operationId,
      kind: 'sandbox_exec_code',
      sessionId: params.sessionId,
      toolCallId: params.toolCallId,
      cwd,
      timeoutMs: timeout,
      language: params.language,
      code: params.code,
    })
  )

  const unavailableResult = (stderr: string, errorCode: SandboxExecErrorCode): ExecResult => {
    log.warn(
      buildOperationFinishLog({
        operationId,
        success: false,
        exitCode: 127,
        durationMs: Date.now() - startedAt,
        stdout: '',
        stderr,
      })
    )
    return { stdout: '', stderr, exitCode: 127, errorCode }
  }

  if (isHarmonyBuild()) {
    if (params.language !== 'node') {
      return unavailableResult(
        'HarmonyOS code execution currently supports Node.js only. Use the node language on this platform.',
        params.language === 'powershell'
          ? SANDBOX_EXEC_ERROR_CODES.POWERSHELL_NOT_AVAILABLE
          : SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE
      )
    }
    return await execHarmonyNodeCode({
      code: params.code,
      cwd: params.cwd ?? session.workingDirectory ?? undefined,
      timeout,
      session,
      operationId,
      startedAt,
      toolCallId: params.toolCallId,
    })
  }

  // Session env overrides. On the SRT platforms (macOS/Linux) HOME stays the user's real
  // home (matching Codex/Claude Code): confinement never depended on it — SRT bakes deny
  // rules from the main process's os.homedir(), reads are default-allowed minus
  // TASK_SANDBOX_DENY_READ_PATHS, and writes outside allowWrite are denied regardless of
  // what HOME says. Rewriting HOME to the working directory silently hid every $HOME-based
  // user config (git identity, line endings, mirrors…) and let repo-root files (.gitconfig,
  // .ssh/config) masquerade as the user's global config. Cache/npm redirects below keep
  // $HOME itself write-free.
  const envOverrides: NodeJS.ProcessEnv = {}
  if (session.workingDirectory) {
    const cacheDir = path.join(session.workingDirectory, '.cache')
    mkdirSync(cacheDir, { recursive: true })
    envOverrides.XDG_CACHE_HOME = cacheDir
    // npm's cache defaults to ~/.npm, which is not writable under SRT now that HOME is
    // real; redirect it so `npm install` keeps working inside the sandbox.
    envOverrides.npm_config_cache = path.join(cacheDir, 'npm')
    if (isWindows) {
      // Native Windows execution has NO OS sandbox (docs/technical/windows-sandbox.md), so
      // nothing would deny writes to the real profile. Like execHarmonyNodeCode, keep the
      // HOME/temp redirect as the only thing steering `~`, os.homedir(), and temp files
      // into the session directory; real-HOME inheritance is deliberately limited to the
      // platforms where the OS sandbox keeps the real home write-protected.
      envOverrides.HOME = session.workingDirectory
      envOverrides.TMPDIR = envOverrides.TMP = envOverrides.TEMP = session.workingDirectory
      // Git for Windows resolves its global config from HOME, so the redirect above is the
      // one thing still hiding the user's git identity here (the bug the real-HOME change
      // fixed on the SRT platforms). Point git — and only git — back at the real global
      // config. `git config --global` writes then target the real file, which unsandboxed
      // native execution could already do, so this opens no new exposure.
      const realHome = process.env.USERPROFILE || homedir()
      const globalGitConfig = [path.join(realHome, '.gitconfig'), path.join(realHome, '.config', 'git', 'config')].find(
        existsSync
      )
      if (globalGitConfig) envOverrides.GIT_CONFIG_GLOBAL = globalGitConfig
    }
  }

  // Resolve the program that reads the code from stdin.
  let cmd: string
  let args: string[]
  if (params.language === 'node') {
    // The bundled Electron binary runs as Node via ELECTRON_RUN_AS_NODE; with no script arg and
    // piped (non-TTY) stdin it executes the piped program.
    cmd = process.execPath
    args = []
    envOverrides.ELECTRON_RUN_AS_NODE = '1'
  } else if (params.language === 'powershell') {
    if (!isWindows) {
      return unavailableResult(
        'PowerShell code execution is only available on Windows. Use Node.js or Bash on this platform.',
        SANDBOX_EXEC_ERROR_CODES.POWERSHELL_NOT_AVAILABLE
      )
    }
    const powershell = resolveWindowsPowerShell()
    if (!powershell) {
      return unavailableResult(
        'PowerShell is not available on this Windows host. Install PowerShell 7 or enable Windows PowerShell, or use Node.js.',
        SANDBOX_EXEC_ERROR_CODES.POWERSHELL_NOT_AVAILABLE
      )
    }
    cmd = powershell.cmd
    args = powershell.args
  } else if (isWindows) {
    // Native Windows has no bash; use Git Bash / WSL if present.
    const bash = resolveWindowsBash()
    if (!bash) {
      const stderr = 'bash is not available on this Windows host. Install Git Bash or enable WSL, or use node.'
      return unavailableResult(stderr, SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE)
    }
    cmd = bash.cmd
    args = bash.args
  } else {
    cmd = 'bash'
    args = []
  }

  // Build the spawn descriptor. macOS/Linux wrap the argv with the OS sandbox; Windows runs direct.
  let spawnCmd: string
  let spawnArgs: string[]
  let spawnEnv: NodeJS.ProcessEnv
  if (isWindows) {
    spawnCmd = cmd
    spawnArgs = args
    spawnEnv = { ...process.env, ...envOverrides }
  } else {
    const mgr = globalSandboxManager
    if (!mgr) {
      throw new Error('Sandbox not initialized. Call initSandbox first.')
    }
    // Per-session config is passed as customConfig so each session's allowWrite is respected.
    const customConfig = session.sandboxConfig as Parameters<typeof mgr.wrapWithSandboxArgv>[2]
    const innerCommand = [cmd, ...args].map((token) => shellQuote(token)).join(' ')
    const { argv, env: wrappedEnv } = await mgr.wrapWithSandboxArgv(innerCommand, undefined, customConfig)
    spawnCmd = argv[0]
    spawnArgs = argv.slice(1)
    // On macOS/Linux wrappedEnv is process.env with proxy vars baked in; layer overrides on top.
    spawnEnv = { ...wrappedEnv, ...envOverrides }
    // GUI-launched Electron inherits launchd's minimal PATH (missing /opt/homebrew/bin,
    // ~/.local/bin, version-manager shims, …), so user-installed commands would not resolve.
    const loginShellPath = await getLoginShellPath()
    if (loginShellPath) spawnEnv.PATH = loginShellPath
  }

  // Windows Bash (especially WSL) must keep resolving `node` from its own PATH; a Windows
  // process.execPath is not executable inside WSL. PowerShell reads its script directly.
  // macOS/Linux Bash needs the bundled-node shim.
  const script = buildSandboxStdinScript(params.code, params.language, process.execPath, !isWindows, isWindows)
  const MAX_BUFFER_BYTES = params.outputFilePath ? 6_000 : 10 * 1024 * 1024
  const outputCapture = params.outputFilePath ? createCommandOutputCapture(params.outputFilePath) : undefined

  return new Promise((resolve, reject) => {
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutCapped = false
    let stderrCapped = false
    let outputLimitExceeded = false

    const child = spawn(spawnCmd, spawnArgs, {
      cwd,
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      // POSIX needs its own process group so we can signal the whole tree via -pid.
      // On Windows the tree is killed via taskkill /T, so detaching is unnecessary.
      detached: !isWindows,
    })
    const cancelAfterRegistration = trackRunningChild(session, child, params.toolCallId)

    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child, 'SIGTERM')
      setTimeout(() => killProcessTree(child, 'SIGKILL'), 3_000)
    }, timeout)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (outputCapture && !outputCapture.append('stdout', chunk)) {
        child.stdout.pause()
        outputCapture.onDrain(() => child.stdout.resume())
      }
      if (outputCapture?.isLimitExceeded() && !outputLimitExceeded) {
        outputLimitExceeded = true
        terminateTrackedChild(child)
      }
      if (!stdoutCapped) {
        const remaining = MAX_BUFFER_BYTES - (stdoutBytes - chunk.byteLength)
        if (remaining > 0) stdoutChunks.push(stdoutDecoder.write(chunk.slice(0, remaining)))
        if (stdoutBytes > MAX_BUFFER_BYTES) stdoutCapped = true
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (outputCapture && !outputCapture.append('stderr', chunk)) {
        child.stderr.pause()
        outputCapture.onDrain(() => child.stderr.resume())
      }
      if (outputCapture?.isLimitExceeded() && !outputLimitExceeded) {
        outputLimitExceeded = true
        terminateTrackedChild(child)
      }
      if (!stderrCapped) {
        const remaining = MAX_BUFFER_BYTES - (stderrBytes - chunk.byteLength)
        if (remaining > 0) stderrChunks.push(stderrDecoder.write(chunk.slice(0, remaining)))
        if (stderrBytes > MAX_BUFFER_BYTES) stderrCapped = true
      }
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      void (async () => {
        await outputCapture?.finish()
        log.warn(
          buildOperationFinishLog({
            operationId,
            success: false,
            exitCode: null,
            durationMs: Date.now() - startedAt,
            stdout: stdoutChunks.join('') + stdoutDecoder.end(),
            stderr: err.message,
            stdoutBytes,
            stderrBytes,
          })
        )
        reject(err)
      })()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      void (async () => {
        const outputFile = await outputCapture?.finish()
        const captureFailed = outputCapture?.isFailed() === true
        let stdout = tailTruncate(stdoutChunks.join('') + stdoutDecoder.end())
        let stderr = tailTruncate(stripCodesignNoise(stderrChunks.join('') + stderrDecoder.end()))
        const exitCode = timedOut ? 124 : outputLimitExceeded ? 1 : (code ?? 1)
        if (stdoutCapped) {
          stdout +=
            params.outputFilePath && !captureFailed
              ? '\n[Inline stdout preview truncated; see full output file]'
              : `\n[Output truncated: exceeded ${MAX_BUFFER_BYTES / 1024 / 1024}MB buffer limit]`
        }
        if (stderrCapped) {
          stderr +=
            params.outputFilePath && !captureFailed
              ? '\n[Inline stderr preview truncated; see full output file]'
              : `\n[Stderr truncated: exceeded ${MAX_BUFFER_BYTES / 1024 / 1024}MB buffer limit]`
        }
        if (captureFailed) stderr += `\n${COMMAND_OUTPUT_CAPTURE_FAILED_MESSAGE}`
        if (timedOut) stderr += `\n[Process timed out after ${timeout}ms]`
        if (outputLimitExceeded) stderr += '\n[Command terminated: output exceeded the 10MB capture limit]'
        const finishLog = buildOperationFinishLog({
          operationId,
          success: exitCode === 0,
          exitCode,
          durationMs: Date.now() - startedAt,
          timedOut,
          stdout,
          stderr,
          stdoutBytes,
          stderrBytes,
        })
        if (exitCode === 0) log.info(finishLog)
        else log.warn(finishLog)
        resolve({ stdout, stderr, exitCode, ...(outputFile ? { outputFile } : {}) })
      })()
    })

    // Feed the program via stdin only after cancellation listeners are ready: node executes
    // the piped script; bash runs the piped commands.
    child.stdin.on('error', () => {})
    if (cancelAfterRegistration) {
      terminateTrackedChild(child)
    } else {
      child.stdin.write(script)
      child.stdin.end()
    }
  })
}

const SANDBOX_DENIAL_PATTERNS = [
  /operation not permitted/i,
  /permission denied/i,
  /read-only file system/i,
  /\bEACCES\b/i,
  /\bEPERM\b/i,
  /\bEROFS\b/i,
]

/** Execute one model-facing shell command under confinement and retain failed-call identity for an optional retry. */
export async function runSandboxCommand(params: {
  command: string
  shell: 'bash' | 'powershell'
  workdir?: string
  timeout?: number
  sessionId?: string
  toolCallId: string
}): Promise<import('../../shared/sandbox-provider').SandboxRunCommandResult> {
  const session = getSession(params.sessionId)
  if (!session || session.state !== 'initialized' || !session.workingDirectory) {
    throw new Error('Sandbox not initialized. Call initSandbox first.')
  }
  if (!params.sessionId) throw new Error('Session ID is required for run_command')
  if (process.platform === 'win32') {
    throw new Error('Windows has no confined command runner; use the host approval path')
  }
  if (params.shell !== 'bash') {
    throw new Error('Sandboxed run_command uses Bash on macOS and Linux')
  }

  const defaultCwd = session.userWriteGrants[0]?.root ?? session.workingDirectory
  const cwd = params.workdir ? path.resolve(defaultCwd, normalizeWindowsShellPath(params.workdir)) : defaultCwd
  const cwdValidation = await validateSessionWritePath(session, cwd)
  if (!cwdValidation.valid || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return {
      stdout: '',
      stderr: cwdValidation.error ?? 'Working directory does not exist or is not an authorized directory',
      exitCode: 1,
      cwd,
    }
  }

  const result = await execCode({
    code: params.command,
    language: 'bash',
    timeout: params.timeout,
    cwd,
    sessionId: params.sessionId,
    toolCallId: params.toolCallId,
    outputFilePath: createCommandOutputCapturePath(params.toolCallId),
  })
  const retryOf =
    result.exitCode !== 0
      ? recordFailedSandboxCommand({
          sessionId: params.sessionId,
          toolCallId: params.toolCallId,
          command: params.command,
          cwd,
          canonicalCwd: cwdValidation.canonicalTarget ?? cwd,
          shell: params.shell,
        })
      : undefined
  const denied = result.exitCode !== 0 && SANDBOX_DENIAL_PATTERNS.some((pattern) => pattern.test(result.stderr))
  return {
    ...result,
    cwd,
    ...(retryOf ? { retryOf } : {}),
    sandbox: { denied, ...(denied ? { confidence: 'heuristic' as const } : {}) },
  }
}

export function killRunningCommand(sessionId?: string, toolCallId?: string): { killed: boolean } {
  const session = getSession(sessionId)
  if (!session) return { killed: false }

  const utilities = toolCallId
    ? [session.runningUtilitiesByToolCallId.get(toolCallId)].filter(
        (child): child is UtilityProcess => child !== undefined
      )
    : [...session.runningUtilities]
  const children = toolCallId
    ? [session.runningChildrenByToolCallId.get(toolCallId)].filter(
        (child): child is ChildProcess => child !== undefined
      )
    : [...session.runningChildren]

  if (toolCallId && utilities.length === 0 && children.length === 0) {
    // Cancellation can arrive while execCode is still preparing the sandbox wrapper.
    // Remember it so a child registered moments later is terminated immediately.
    session.pendingCancelledToolCallIds.add(toolCallId)
  }

  let killed = false
  for (const utility of utilities) {
    killed = utility.kill() || killed
  }
  for (const child of children) {
    if (child.killed) continue
    terminateTrackedChild(child)
    killed = true
  }
  if (killed) {
    log.info(
      `Killed running sandbox command${toolCallId ? ` ${toolCallId}` : ''} for session ${sessionId || DEFAULT_SESSION}`
    )
  }
  return { killed }
}

// ─── File operations ─────────────────────────────────────────────────

function operationError(result: ExecResult, fallback: string): Pick<SandboxOperationResult, 'error' | 'errorCode'> {
  return {
    error: result.stderr || result.stdout || fallback,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  }
}

const SANDBOX_READ_DEFAULT_LINES = 500
const SANDBOX_READ_MAX_LINES = 2000
const SANDBOX_MAX_LINE_LENGTH = 2000
const SANDBOX_LIST_MAX_ENTRIES = 200

export async function readFile(
  filePath: string,
  sessionId?: string,
  options?: { offset?: number; limit?: number }
): Promise<SandboxReadResult> {
  try {
    const startLine = Math.max(1, Math.floor(options?.offset ?? 1))
    const limit = Math.min(
      SANDBOX_READ_MAX_LINES,
      Math.max(1, Math.floor(options?.limit ?? SANDBOX_READ_DEFAULT_LINES))
    )
    const result = await execCode({
      language: 'node',
      sessionId,
      timeout: 10_000,
      code: buildSandboxReadScript({
        filePath,
        startLine,
        limit,
        maxLineLength: SANDBOX_MAX_LINE_LENGTH,
      }),
    })
    if (result.exitCode !== 0) {
      return { success: false, ...operationError(result, `Exit code ${result.exitCode}`) }
    }
    const output = JSON.parse(result.stdout) as {
      content: string
      startLine: number
      endLine: number
      totalLines: number
    }
    return { success: true, ...output }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function writeFile(
  filePath: string,
  content: string,
  sessionId?: string
): Promise<{ success: boolean; error?: string }> {
  const session = getSession(sessionId)
  if (!session?.workingDirectory) {
    return { success: false, error: 'Sandbox not initialized' }
  }
  try {
    // Write directly via fs to avoid ARG_MAX limits with shell commands.
    // Relative paths resolve inside the session temp directory. Absolute paths are accepted
    // only when they are inside a user-granted working directory.
    const normalizedPath = normalizeWindowsShellPath(filePath)
    const resolved = path.isAbsolute(normalizedPath)
      ? path.resolve(normalizedPath)
      : path.resolve(session.workingDirectory, normalizedPath)
    const validation = await validateSessionWritePath(session, resolved)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }
    const parentDir = path.dirname(resolved)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }
    await fsWriteFile(resolved, content, 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function editFile(
  filePath: string,
  input: {
    search?: string
    replace?: string
    edits?: Array<{ search: string; replace: string }>
  },
  sessionId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const edits = input.edits?.length
      ? input.edits
      : input.search !== undefined && input.replace !== undefined
        ? [{ search: input.search, replace: input.replace }]
        : []
    if (edits.length === 0) {
      return { success: false, error: 'No edits provided' }
    }
    const session = getSession(sessionId)
    if (!session?.workingDirectory) {
      return { success: false, error: 'Sandbox not initialized' }
    }
    const normalizedPath = normalizeWindowsShellPath(filePath)
    const resolved = path.isAbsolute(normalizedPath)
      ? path.resolve(normalizedPath)
      : path.resolve(session.workingDirectory, normalizedPath)
    const validation = await validateSessionWritePath(session, resolved)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }
    let text = await fsReadFile(resolved, 'utf-8')
    for (let index = 0; index < edits.length; index++) {
      const edit = edits[index]
      const first = text.indexOf(edit.search)
      if (first === -1) {
        return { success: false, error: `Edit ${index + 1}: search text not found` }
      }
      if (text.indexOf(edit.search, first + edit.search.length) !== -1) {
        return { success: false, error: `Edit ${index + 1}: search text is not unique` }
      }
      text = text.slice(0, first) + edit.replace + text.slice(first + edit.search.length)
    }
    await fsWriteFile(resolved, text, 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function listDir(dirPath: string, sessionId?: string): Promise<SandboxOperationResult> {
  try {
    const result = await execCode({
      language: 'node',
      sessionId,
      timeout: 10_000,
      code: `
const fs = require('fs')
const path = require('path')
const dirPath = ${JSON.stringify(dirPath)}
const entries = fs.readdirSync(dirPath, { withFileTypes: true })
const rows = entries.slice(0, ${SANDBOX_LIST_MAX_ENTRIES}).map((entry) => {
  let size = 0
  try { size = fs.statSync(path.join(dirPath, entry.name)).size } catch {}
  const type = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other'
  return type + '\\t' + size + '\\t' + entry.name
})
if (entries.length > ${SANDBOX_LIST_MAX_ENTRIES}) {
  rows.push('... ' + (entries.length - ${SANDBOX_LIST_MAX_ENTRIES}) + ' more entries')
}
process.stdout.write(rows.join('\\n'))
`,
    })
    if (result.exitCode !== 0) {
      return { success: false, ...operationError(result, `Exit code ${result.exitCode}`) }
    }
    return { success: true, content: headTruncate(result.stdout) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function searchFiles(
  pattern: string,
  dirPath?: string,
  options?: { regex?: boolean; include?: string },
  sessionId?: string
): Promise<SandboxOperationResult> {
  const session = getSession(sessionId)
  if (!session?.workingDirectory || session.state !== 'initialized') {
    return { success: false, error: 'Sandbox not initialized' }
  }

  const root = path.resolve(session.workingDirectory, dirPath ?? '.')
  return await runRipgrepSearch(
    { root, pattern, regex: options?.regex, include: options?.include },
    {
      prepareCommand: async (command, args) => {
        if (process.platform === 'win32') return { command, args }
        if (!globalSandboxManager || !session.sandboxConfig) {
          throw new Error('Sandbox not initialized')
        }
        const innerCommand = [command, ...args].map((token) => shellQuote(token)).join(' ')
        const customConfig = session.sandboxConfig as Parameters<typeof globalSandboxManager.wrapWithSandboxArgv>[2]
        const wrapped = await globalSandboxManager.wrapWithSandboxArgv(innerCommand, undefined, customConfig)
        return {
          command: wrapped.argv[0],
          args: wrapped.argv.slice(1),
          env: wrapped.env,
          detached: true,
        }
      },
      terminate: killProcessTree,
      onChild: (child) => {
        if (child) trackRunningChild(session, child)
      },
    }
  )
}

export async function findFiles(
  dirPath: string,
  pattern?: string,
  sessionId?: string
): Promise<SandboxOperationResult> {
  const session = getSession(sessionId)
  if (!session?.workingDirectory || session.state !== 'initialized') {
    return { success: false, error: 'Sandbox not initialized' }
  }

  return await runRipgrepFileList(
    { root: session.workingDirectory, path: dirPath, pattern },
    {
      prepareCommand: async (command, args) => {
        if (process.platform === 'win32') return { command, args }
        if (!globalSandboxManager || !session.sandboxConfig) {
          throw new Error('Sandbox not initialized')
        }
        const innerCommand = [command, ...args].map((token) => shellQuote(token)).join(' ')
        const customConfig = session.sandboxConfig as Parameters<typeof globalSandboxManager.wrapWithSandboxArgv>[2]
        const wrapped = await globalSandboxManager.wrapWithSandboxArgv(innerCommand, undefined, customConfig)
        return {
          command: wrapped.argv[0],
          args: wrapped.argv.slice(1),
          env: wrapped.env,
          detached: true,
        }
      },
      terminate: killProcessTree,
      onChild: (child) => {
        if (child) trackRunningChild(session, child)
      },
    }
  )
}

// ─── Sandbox lifecycle (continued) ───────────────────────────────────

export async function resetSandbox(sessionId?: string): Promise<{ success: boolean; error?: string }> {
  const id = sessionId || DEFAULT_SESSION
  clearFailedCommandRetries(id)
  const session = sessions.get(id)
  if (!session) {
    return { success: true }
  }

  try {
    killRunningCommand(sessionId)
    sessions.delete(id)
    log.info(`Sandbox session ${id} reset`)
    return { success: true }
  } catch (error) {
    sessions.delete(id)
    const msg = error instanceof Error ? error.message : String(error)
    log.error('Sandbox reset error:', msg)
    return { success: false, error: msg }
  }
}

/** Reset all active sandbox sessions. Called on app quit to clean up. */
export async function resetAllSessions(): Promise<void> {
  clearFailedCommandRetries()
  const ids = [...sessions.keys()]
  for (const id of ids) {
    try {
      killRunningCommand(id)
      sessions.delete(id)
    } catch {
      sessions.delete(id)
    }
  }
  if (ids.length > 0) {
    log.info(`Cleaned up ${ids.length} sandbox session(s) on quit`)
  }
}

export function getStatus(sessionId?: string): SandboxStatus {
  const session = getSession(sessionId)
  return {
    state: session?.state ?? 'idle',
    workingDirectory: session?.workingDirectory ?? null,
    platform: process.platform,
    homeDirectory: homedir(),
  }
}

export async function checkAvailability(): Promise<{ available: boolean; reason?: string }> {
  if (isHarmonyBuild()) {
    // The HAP cannot launch bubblewrap/socat, but Electron's utility process provides the
    // packaged Node runtime without going through the blocked child_process/appspawn path.
    return { available: true }
  }

  if (process.platform === 'darwin') {
    return { available: true }
  }

  if (process.platform === 'linux') {
    // Linux sandbox-runtime requires bubblewrap (bwrap) and socat
    try {
      if (!globalSandboxManager) {
        const { SandboxManager } = await import(getSandboxRuntimeImportTarget())
        globalSandboxManager = SandboxManager
      }
      const deps = globalSandboxManager!.checkDependencies()
      if (deps.errors.length > 0) {
        return { available: false, reason: `Missing Linux dependencies: ${deps.errors.join('; ')}` }
      }
      return { available: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { available: false, reason: `Dependency check failed: ${msg}` }
    }
  }

  if (process.platform === 'win32') {
    // Native Windows runs code without an OS sandbox (see docs/technical/windows-sandbox.md).
    // The bundled Node runtime is always present, so `node` is available; the `bash` language
    // additionally needs Git Bash or WSL on PATH, which execCode checks at call time.
    return { available: true }
  }

  return { available: false, reason: `Unsupported platform: ${process.platform}` }
}

// ─── Temp directory management ───────────────────────────────────────

/**
 * Initialize a sandbox with a temporary directory for a given session.
 * Creates os.tmpdir()/chatbox-sandbox/<sessionId>/ as the working directory.
 */
export async function initSandboxWithTempDir(
  sessionId: string,
  userWritePaths: string[] = []
): Promise<{
  success: boolean
  workingDirectory?: string
  acceptedWorkingDirectories?: string[]
  error?: string
}> {
  // Validate sessionId to prevent path traversal
  if (!sessionId || /[/\\]/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    return { success: false, error: 'Invalid session ID' }
  }

  const tempBase = path.join(getSandboxTmpRoot(), sessionId)
  try {
    mkdirSync(tempBase, { recursive: true })
    const result = await initSandbox(tempBase, sessionId, userWritePaths)
    if (result.success) {
      return {
        success: true,
        workingDirectory: tempBase,
        acceptedWorkingDirectories: result.acceptedWorkingDirectories,
      }
    }
    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error('initSandboxWithTempDir failed:', msg)
    return { success: false, error: msg }
  }
}

/**
 * Compute the deterministic working directory for a session's temp sandbox without
 * creating it or initializing the sandbox. Mirrors the tempBase path used by
 * initSandboxWithTempDir, so callers can tell the model its working directory before the
 * sandbox lazily initializes on first tool call. Returns null for invalid session ids.
 */
export function resolveSandboxWorkingDir(sessionId: string): string | null {
  if (!sessionId || /[/\\]/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    return null
  }
  return path.join(getSandboxTmpRoot(), sessionId)
}

type SandboxCopyTarget = { ok: true; workDir: string; targetPath: string } | { ok: false; error: string }

/**
 * Shared prologue for copy-into-sandbox entry points: resolve the session working
 * directory, reject invalid filenames, and validate the target against path traversal,
 * protected paths, and the attachment seed manifest.
 */
async function resolveSandboxCopyTarget(targetFilename: string, sessionId?: string): Promise<SandboxCopyTarget> {
  const session = getSession(sessionId)
  if (!session?.workingDirectory) {
    return { ok: false, error: 'Sandbox not initialized' }
  }
  const workDir = session.workingDirectory

  // Reject empty or invalid filenames
  if (!targetFilename || targetFilename === '.' || targetFilename === '..') {
    return { ok: false, error: 'Invalid filename' }
  }

  // Prevent path traversal (with symlink check)
  const targetPath = path.resolve(workDir, targetFilename)
  const validation = await validateWritePath(targetPath, workDir)
  if (!validation.valid) {
    return { ok: false, error: validation.error || 'Invalid filename: path traversal detected' }
  }
  if (pathContainsAttachmentSeedManifest(targetPath)) {
    return { ok: false, error: 'Invalid filename' }
  }
  return { ok: true, workDir, targetPath }
}

/**
 * Copy a file into the sandbox working directory.
 * Content can be a data URL (base64 encoded) or plain text.
 */
export async function copyFileToSandbox(
  content: string,
  targetFilename: string,
  sessionId?: string
): Promise<{ success: boolean; sandboxPath?: string; error?: string }> {
  const target = await resolveSandboxCopyTarget(targetFilename, sessionId)
  if (!target.ok) {
    return { success: false, error: target.error }
  }

  try {
    await writeContentToFile(target.targetPath, content)
    return { success: true, sandboxPath: target.targetPath }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error('copyFileToSandbox failed:', msg)
    return { success: false, error: msg }
  }
}

/**
 * Copy a file from the blob store directly into the sandbox working directory.
 * Reads the blob from disk in the main process — avoids sending large content through IPC.
 */
export async function copyBlobToSandbox(
  blobKey: string,
  targetFilename: string,
  sessionId?: string
): Promise<{ success: boolean; sandboxPath?: string; error?: string }> {
  try {
    return await seedAttachmentBlob(blobKey, targetFilename, sessionId, false)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error('copyBlobToSandbox failed:', msg)
    return { success: false, error: msg }
  }
}

/**
 * Seed many attachment blobs in one call. Already-seeded destinations (same blob
 * still on disk) are skipped without reading the blob store. First-time or
 * relocated attachments still go through seedAttachmentBlob.
 */
export async function seedBlobsToSandbox(
  items: SandboxSeedBlobItem[],
  sessionId?: string
): Promise<{ success: boolean; results: SandboxSeedBlobResult[]; error?: string }> {
  const results: SandboxSeedBlobResult[] = []
  if (items.length === 0) {
    return { success: true, results }
  }

  const session = getSession(sessionId)
  if (!session?.workingDirectory) {
    return { success: false, error: 'Sandbox not initialized', results }
  }

  const workDir = session.workingDirectory
  const manifest = readAttachmentSeedManifest(workDir)
  const pending: SandboxSeedBlobItem[] = []

  for (const item of items) {
    const target = await resolveSandboxCopyTarget(item.targetFilename, sessionId)
    if (!target.ok) {
      results.push({ targetFilename: item.targetFilename, success: false, skipped: false, error: target.error })
      continue
    }
    const { action } = classifyAttachmentSeedCopyAgainstManifest(workDir, target.targetPath, item.blobKey, manifest)
    if (action === 'skip') {
      results.push({
        targetFilename: item.targetFilename,
        success: true,
        skipped: true,
        sandboxPath: target.targetPath,
      })
      continue
    }
    pending.push(item)
  }

  for (const item of pending) {
    try {
      const seeded = await seedAttachmentBlob(item.blobKey, item.targetFilename, sessionId, false)
      results.push({
        targetFilename: item.targetFilename,
        success: seeded.success,
        skipped: false,
        sandboxPath: seeded.sandboxPath,
        error: seeded.error,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('seedBlobsToSandbox item failed:', msg)
      results.push({ targetFilename: item.targetFilename, success: false, skipped: false, error: msg })
    }
  }

  const success = results.every((result) => result.success)
  return success ? { success: true, results } : { success: false, results, error: 'Some attachments failed to seed' }
}

/**
 * Seed one attachment blob. When the requested name is already occupied by a
 * different file, write the incoming blob to an identity-derived path so both
 * uploads remain. `alreadyRelocated` prevents a second hop if that unique path
 * is also occupied.
 */
async function seedAttachmentBlob(
  blobKey: string,
  targetFilename: string,
  sessionId: string | undefined,
  alreadyRelocated: boolean
): Promise<{ success: boolean; sandboxPath?: string; error?: string }> {
  const target = await resolveSandboxCopyTarget(targetFilename, sessionId)
  if (!target.ok) {
    return { success: false, error: target.error }
  }
  const { workDir, targetPath } = target
  const { action, seedKey } = classifyAttachmentSeedCopy(workDir, targetPath, blobKey)
  if (action === 'skip') {
    return { success: true, sandboxPath: targetPath }
  }

  const { getStoreBlob } = await import('../store-node')
  const content = await getStoreBlob(blobKey)
  if (!content) {
    if (action === 'reconcile') {
      // The working copy stays untouched either way; a missing blob is not an error here.
      return { success: true, sandboxPath: targetPath }
    }
    return { success: false, error: `Blob not found for key: ${blobKey}` }
  }

  if (action === 'reconcile') {
    // Untracked existing file: a workdir seeded before the manifest existed, a file the
    // model created, or a seed whose manifest entry was lost. Never overwrite it.
    // Matching bytes mean this is the unedited seed of the same attachment — record that
    // baseline so later reseeds can skip. Different bytes mean another file needs this
    // name; relocate the incoming blob, keeping the working copy if there is nowhere
    // else for the blob to go.
    const existing = await fsReadFile(targetPath)
    if (contentToFileBuffer(content).equals(toByteView(existing))) {
      recordAttachmentSeed(workDir, seedKey, blobKey)
      return { success: true, sandboxPath: targetPath }
    }
    return writeOrRelocateAttachmentSeed({
      blobKey,
      content,
      workDir,
      targetPath,
      targetFilename,
      sessionId,
      seedKey,
      alreadyRelocated,
      neverOverwrite: true,
    })
  }

  if (action === 'relocate') {
    return writeOrRelocateAttachmentSeed({
      blobKey,
      content,
      workDir,
      targetPath,
      targetFilename,
      sessionId,
      seedKey,
      alreadyRelocated,
      neverOverwrite: false,
    })
  }

  await writeContentToFile(targetPath, content)
  recordAttachmentSeed(workDir, seedKey, blobKey)
  return { success: true, sandboxPath: targetPath }
}

async function writeOrRelocateAttachmentSeed(params: {
  blobKey: string
  content: string
  workDir: string
  targetPath: string
  targetFilename: string
  sessionId: string | undefined
  seedKey: string
  alreadyRelocated: boolean
  /** From `reconcile`: the destination holds an untracked working copy that must survive. */
  neverOverwrite: boolean
}): Promise<{ success: boolean; sandboxPath?: string; error?: string }> {
  const {
    blobKey,
    content,
    workDir,
    targetPath,
    targetFilename,
    sessionId,
    seedKey,
    alreadyRelocated,
    neverOverwrite,
  } = params
  const uniqueRel = sandboxAttachmentRelPath(path.basename(targetFilename), blobKey)
  const currentRel = path.relative(workDir, targetPath).split(path.sep).join('/')
  if (alreadyRelocated || uniqueRel === currentRel) {
    if (neverOverwrite) {
      // The blob's own identity path is the occupied destination, so there is nowhere to
      // relocate it. This is an edited seed whose manifest entry was lost (deleted sidecar,
      // or a crash between write and record). Keep the working copy and restore the
      // baseline so later reseeds skip without rereading bytes.
      recordAttachmentSeed(workDir, seedKey, blobKey)
      return { success: true, sandboxPath: targetPath }
    }
    await writeContentToFile(targetPath, content)
    recordAttachmentSeed(workDir, seedKey, blobKey)
    return { success: true, sandboxPath: targetPath }
  }
  return seedAttachmentBlob(blobKey, uniqueRel, sessionId, true)
}

/**
 * Transient sandbox working directories live in the OS temp dir and are reaped by
 * cleanupStaleSandboxDirs(). Persisted download artifacts live under userData so they
 * survive OS temp eviction and the 7-day cleanup, keeping create_download outputs
 * downloadable indefinitely. The path intentionally contains `chatbox-sandbox` so the
 * renderer's sandbox-path detection (preview gating) keeps working.
 */
export function getSandboxTmpRoot(): string {
  return getChatboxQaPaths()?.sandboxTmpRoot ?? path.join(tmpdir(), 'chatbox-sandbox')
}

export function getSandboxArtifactsRoot(): string {
  return getChatboxQaPaths()?.sandboxArtifactsRoot ?? path.join(app.getPath('userData'), 'chatbox-sandbox', 'artifacts')
}

/**
 * All directory roots that may legitimately contain sandbox files, with symlinks
 * resolved (macOS: /var → /private/var). Used by export/read/preview security checks.
 * The artifacts root is listed first so previews of persisted files resolve to the
 * durable copy rather than a same-named transient temp file.
 */
export function getSandboxAllowedRoots(): string[] {
  const roots = new Set<string>()
  // Persisted artifacts are always accessible (listed first so previews resolve to the
  // durable copy rather than a same-named transient temp file).
  roots.add(safeRealpathSync(getSandboxArtifactsRoot()))
  // Live sessions: scope to each session's own working directory (per-session isolation).
  let hasLiveSession = false
  for (const session of sessions.values()) {
    if (session.workingDirectory) {
      roots.add(safeRealpathSync(session.workingDirectory))
      hasLiveSession = true
    }
  }
  // Post-restart fallback only: the sessions Map is empty but temp dirs still exist on
  // disk. Add the shared temp root solely to recover those — never alongside live
  // sessions, so one active session can't read another's working directory.
  if (!hasLiveSession) {
    roots.add(safeRealpathSync(getSandboxTmpRoot()))
  }
  return [...roots]
}

/**
 * Extra roots the sandbox is allowed to write to beyond per-session working dirs
 * (e.g. /tmp and the OS temp dir). create_download may persist files produced here
 * too, since the sandbox can legitimately write outputs to them. Kept in sync with the
 * allowWrite list built in initSandbox() (TASK_SANDBOX_EXTRA_WRITE_PATHS + temp dirs).
 */
export function getSandboxExtraWriteRoots(): string[] {
  if (process.platform === 'win32') return []
  const roots = new Set<string>()
  for (const p of [tmpdir(), '/tmp', ...TASK_SANDBOX_EXTRA_WRITE_PATHS]) {
    roots.add(p)
    roots.add(safeRealpathSync(p))
  }
  return [...roots]
}

/**
 * Export a file from the sandbox to a user-chosen location.
 * Opens a save dialog and copies the file.
 */
export async function exportFileFromSandbox(
  sandboxPath: string,
  suggestedName?: string
): Promise<{ success: boolean; localPath?: string; error?: string }> {
  try {
    const { dialog } = await import('electron')

    // Resolve path relative to a sandbox session's working directory.
    // Security: only files inside a known sandbox root are allowed.
    let resolvedPath: string | null = null
    const sandboxRoots = getSandboxAllowedRoots()

    if (path.isAbsolute(sandboxPath)) {
      resolvedPath = safeRealpathSync(sandboxPath)
    } else {
      for (const session of sessions.values()) {
        if (session.workingDirectory) {
          const candidate = path.join(session.workingDirectory, sandboxPath)
          if (existsSync(candidate)) {
            resolvedPath = safeRealpathSync(candidate)
            break
          }
        }
      }
    }

    if (!resolvedPath) {
      return { success: false, error: 'Cannot resolve relative path: sandbox not initialized' }
    }

    // Security: ensure resolved path is inside a known sandbox working directory
    const isInsideSandbox = sandboxRoots.some(
      (root) => resolvedPath === root || resolvedPath!.startsWith(root + path.sep)
    )
    if (!isInsideSandbox) {
      return { success: false, error: 'Access denied: path is outside the sandbox' }
    }

    if (!existsSync(resolvedPath)) {
      return { success: false, error: `File not found: ${sandboxPath}` }
    }

    const defaultPath = suggestedName || path.basename(resolvedPath)
    const result = await dialog.showSaveDialog({
      defaultPath,
      title: 'Save File',
    })

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Save dialog cancelled' }
    }

    await fsCopyFile(resolvedPath, result.filePath)
    return { success: true, localPath: result.filePath }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error('exportFileFromSandbox failed:', msg)
    return { success: false, error: msg }
  }
}

// ─── Temp directory cleanup ──────────────────────────────────────────

const SANDBOX_ROOT = getSandboxTmpRoot()
const STALE_DIR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Clean up stale sandbox temp directories older than 7 days.
 * Called on app startup. Only touches the transient temp root — persisted download
 * artifacts under userData (getSandboxArtifactsRoot) are intentionally never cleaned.
 */
export function cleanupStaleSandboxDirs(): void {
  try {
    if (!existsSync(SANDBOX_ROOT)) return

    const now = Date.now()
    const entries = readdirSync(SANDBOX_ROOT)

    for (const entry of entries) {
      const dirPath = path.join(SANDBOX_ROOT, entry)
      try {
        const stat = statSync(dirPath)
        if (stat.isDirectory() && now - stat.mtimeMs > STALE_DIR_MAX_AGE_MS) {
          // Don't delete dirs belonging to active sessions
          if (!sessions.has(entry)) {
            rmSync(dirPath, { recursive: true, force: true })
            log.info(`Cleaned up stale sandbox dir: ${entry}`)
          }
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  } catch (error) {
    log.error('Failed to clean up stale sandbox dirs:', error)
  }
}
