import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { copyFile as fsCopyFile } from 'node:fs/promises'
import path from 'node:path'
import { getLogger } from '../util'
import {
  getSandboxArtifactsRoot,
  getSandboxExtraWriteRoots,
  getSandboxTmpRoot,
  getSessionWorkingDirectory,
  normalizeWindowsShellPath,
} from './manager'
import { safeRealpathSync } from './path-safety'

/**
 * Durable download artifacts for create_download. Transient sandbox working directories
 * live in the OS temp dir and are reaped; persisted artifacts live under userData (see
 * getSandboxArtifactsRoot) so they stay downloadable indefinitely. Layout:
 * `<artifactsRoot>/<sessionId>/<artifactSourceKey(sourcePath)>/<basename>`.
 */

const log = getLogger('sandbox:persist-artifact')

/**
 * Stable hash of a resolved source path. Groups each persisted artifact by origin so
 * distinct files sharing a basename (charts/report.html vs tables/report.html) don't
 * overwrite each other, while re-persisting the same source updates the copy in place.
 */
export function artifactSourceKey(resolvedSource: string): string {
  return createHash('sha1').update(resolvedSource).digest('hex').slice(0, 12)
}

async function refreshPersistedArtifactFromWorkingCopy(
  artifactPath: string,
  sessionWorkingRoot: string
): Promise<void> {
  const sourceKey = path.basename(path.dirname(artifactPath))
  const basename = path.basename(artifactPath)
  if (!basename || basename === '.' || basename === '..') return
  const candidate = path.join(sessionWorkingRoot, basename)
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return
  const resolvedCandidate = safeRealpathSync(candidate)
  if (resolvedCandidate !== sessionWorkingRoot && !resolvedCandidate.startsWith(sessionWorkingRoot + path.sep)) {
    return
  }
  if (artifactSourceKey(resolvedCandidate) !== sourceKey) return
  if (resolvedCandidate === artifactPath) return
  await fsCopyFile(resolvedCandidate, artifactPath)
}

/**
 * Persist a sandbox file to durable storage under userData so it stays downloadable
 * even after the transient temp working directory is evicted or cleaned up.
 * Idempotent: a path that is already inside the artifacts root is returned as-is,
 * after refreshing it from the original working-directory file when the source hash matches.
 * Returns the absolute path of the persisted copy.
 */
export async function persistSandboxArtifact(
  sandboxPath: string,
  sessionId: string,
  _displayName?: string
): Promise<{ success: boolean; artifactPath?: string; error?: string }> {
  // Validate sessionId to prevent path traversal
  if (!sessionId || /[/\\]/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    return { success: false, error: 'Invalid session ID' }
  }
  // On Windows the path may arrive in bash/POSIX form (e.g. /c/... from Git Bash realpath);
  // normalize to native Windows form before absolute/root validation.
  sandboxPath = normalizeWindowsShellPath(sandboxPath)
  if (!path.isAbsolute(sandboxPath)) {
    const workingDirectory = getSessionWorkingDirectory(sessionId) ?? path.join(getSandboxTmpRoot(), sessionId)
    const resolvedRelativePath = path.resolve(workingDirectory, sandboxPath)
    if (resolvedRelativePath !== workingDirectory && !resolvedRelativePath.startsWith(workingDirectory + path.sep)) {
      return { success: false, error: 'Access denied: relative artifact path escapes the sandbox' }
    }
    sandboxPath = resolvedRelativePath
  }
  try {
    // Security: scope session-managed paths to this session. getSandboxAllowedRoots() is
    // intentionally broader for preview/recovery, so using it here would allow one live
    // session to persist another session's working file or durable artifact.
    const resolvedSource = safeRealpathSync(sandboxPath)
    const sessionWorkingRoot = safeRealpathSync(
      getSessionWorkingDirectory(sessionId) ?? path.join(getSandboxTmpRoot(), sessionId)
    )
    const sessionArtifactsRoot = safeRealpathSync(path.join(getSandboxArtifactsRoot(), sessionId))
    const sharedSandboxTmpRoot = safeRealpathSync(getSandboxTmpRoot())
    const sharedArtifactsRoot = safeRealpathSync(getSandboxArtifactsRoot())
    const isInsideRoot = (root: string) => resolvedSource === root || resolvedSource.startsWith(root + path.sep)
    const insideSessionManagedRoot = [sessionWorkingRoot, sessionArtifactsRoot].some(isInsideRoot)
    const insideSharedManagedRoot = [sharedSandboxTmpRoot, sharedArtifactsRoot].some(isInsideRoot)
    const insideExtraWriteRoot = getSandboxExtraWriteRoots().some(
      (root) => resolvedSource === root || resolvedSource.startsWith(root + path.sep)
    )
    if (!insideSessionManagedRoot && (insideSharedManagedRoot || !insideExtraWriteRoot)) {
      return { success: false, error: 'Access denied: path is outside the sandbox' }
    }
    if (!existsSync(resolvedSource)) {
      return { success: false, error: `File not found: ${sandboxPath}` }
    }
    if (!statSync(resolvedSource).isFile()) {
      return { success: false, error: `Not a file: ${sandboxPath}` }
    }

    // Already persisted — refresh from the original working-directory file when the
    // model edited that same source path and then re-downloaded the durable copy.
    if (isInsideRoot(sessionArtifactsRoot)) {
      await refreshPersistedArtifactFromWorkingCopy(resolvedSource, sessionWorkingRoot)
      return { success: true, artifactPath: resolvedSource }
    }

    const sourceKey = artifactSourceKey(resolvedSource)
    const destDir = path.join(getSandboxArtifactsRoot(), sessionId, sourceKey)
    mkdirSync(destDir, { recursive: true })
    // Keep the original basename for the on-disk name. NOTE: _displayName is LLM-controlled
    // and intentionally NOT used here — do not wire it into the path without sanitizing
    // (path traversal). The download dialog uses display_name only as a save-as suggestion.
    const destPath = path.join(destDir, path.basename(resolvedSource))
    await fsCopyFile(resolvedSource, destPath)
    return { success: true, artifactPath: safeRealpathSync(destPath) }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error('persistSandboxArtifact failed:', msg)
    return { success: false, error: msg }
  }
}

/** Whether a session has any persisted download artifacts on disk. */
export function hasSessionArtifacts(sessionId: string): boolean {
  if (!sessionId || /[/\\]/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    return false
  }
  try {
    const dir = path.join(getSandboxArtifactsRoot(), sessionId)
    return existsSync(dir) && readdirSync(dir).length > 0
  } catch {
    return false
  }
}

/** Remove all persisted download artifacts for a session (called on session deletion). */
export function removeSessionArtifacts(sessionId: string): { success: boolean; error?: string } {
  if (!sessionId || /[/\\]/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    return { success: false, error: 'Invalid session ID' }
  }
  try {
    const dir = path.join(getSandboxArtifactsRoot(), sessionId)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error('removeSessionArtifacts failed:', msg)
    return { success: false, error: msg }
  }
}
