import { ipcMain } from 'electron'
import type { SandboxExecLanguage } from '../../shared/sandbox-provider'
import { getLogger } from '../util'
import {
  checkAvailability,
  copyBlobToSandbox,
  copyFileToSandbox,
  editFile,
  execCode,
  exportFileFromSandbox,
  findFiles,
  getSandboxAllowedRoots,
  getStatus,
  initSandboxWithTempDir,
  killRunningCommand,
  listDir,
  readFile,
  resetSandbox,
  resolveSandboxWorkingDir,
  runSandboxCommand,
  searchFiles,
  seedBlobsToSandbox,
  writeFile,
} from './manager'
import { hasSessionArtifacts, persistSandboxArtifact, removeSessionArtifacts } from './persist-artifact'
import { createSandboxHtmlPreviewUrl } from './preview-server'
import { bufferToArrayBuffer, readSandboxFileBase64, readSandboxFileBytes } from './read-file-base64'

const log = getLogger('sandbox:ipc-handlers')

export function registerSandboxIPCHandlers() {
  // Single code-execution entry point for all platforms. The renderer sends raw {code, language};
  // execCode feeds it to the sandboxed process via stdin (macOS/Linux under SRT confinement,
  // Windows natively with no OS sandbox). No base64 encoding or host-shell command building.
  ipcMain.handle(
    'sandbox:exec-code',
    async (
      _event,
      params: {
        code: string
        language: SandboxExecLanguage
        timeout?: number
        sessionId?: string
        toolCallId?: string
      }
    ) => {
      try {
        log.debug(`sandbox:exec-code language=${params.language} bytes=${params.code.length}`)
        return await execCode(params)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:exec-code failed', msg)
        return { stdout: '', stderr: msg, exitCode: 1 }
      }
    }
  )

  ipcMain.handle(
    'sandbox:run-command',
    async (
      _event,
      params: {
        command: string
        shell: 'bash' | 'powershell'
        workdir?: string
        timeout?: number
        sessionId?: string
        toolCallId: string
      }
    ) => {
      try {
        log.debug(`sandbox:run-command shell=${params.shell} bytes=${params.command.length}`)
        return await runSandboxCommand(params)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:run-command failed', msg)
        return { stdout: '', stderr: msg, exitCode: 1, cwd: params.workdir }
      }
    }
  )

  ipcMain.handle(
    'sandbox:read',
    async (_event, params: { filePath: string; offset?: number; limit?: number; sessionId?: string }) => {
      try {
        log.debug(`sandbox:read path=${params.filePath}`)
        return await readFile(params.filePath, params.sessionId, { offset: params.offset, limit: params.limit })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:read failed', msg)
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle('sandbox:write', async (_event, params: { filePath: string; content: string; sessionId?: string }) => {
    try {
      log.debug(`sandbox:write path=${params.filePath}`)
      return await writeFile(params.filePath, params.content, params.sessionId)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:write failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    'sandbox:edit',
    async (
      _event,
      params: {
        filePath: string
        search?: string
        replace?: string
        edits?: Array<{ search: string; replace: string }>
        sessionId?: string
      }
    ) => {
      try {
        log.debug(`sandbox:edit path=${params.filePath}`)
        return await editFile(params.filePath, params, params.sessionId)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:edit failed', msg)
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle('sandbox:ls', async (_event, params: { dirPath: string; sessionId?: string }) => {
    try {
      log.debug(`sandbox:ls path=${params.dirPath}`)
      return await listDir(params.dirPath, params.sessionId)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:ls failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    'sandbox:search',
    async (
      _event,
      params: { pattern: string; dirPath?: string; regex?: boolean; include?: string; sessionId?: string }
    ) => {
      try {
        log.debug(`sandbox:search pattern=${params.pattern}`)
        return await searchFiles(
          params.pattern,
          params.dirPath,
          { regex: params.regex, include: params.include },
          params.sessionId
        )
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:search failed', msg)
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle('sandbox:find', async (_event, params: { dirPath: string; pattern?: string; sessionId?: string }) => {
    try {
      log.debug(`sandbox:find dir=${params.dirPath}`)
      return await findFiles(params.dirPath, params.pattern, params.sessionId)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:find failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:kill', (_event, params?: { sessionId?: string; toolCallId?: string }) => {
    try {
      log.info('sandbox:kill')
      return killRunningCommand(params?.sessionId, params?.toolCallId)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:kill failed', msg)
      return { killed: false }
    }
  })

  ipcMain.handle('sandbox:reset', async (_event, params?: { sessionId?: string }) => {
    try {
      log.info(`sandbox:reset session=${params?.sessionId || 'default'}`)
      return await resetSandbox(params?.sessionId)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:reset failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:status', (_event, params?: { sessionId?: string }) => {
    return getStatus(params?.sessionId)
  })

  ipcMain.handle('sandbox:resolve-working-dir', (_event, params: { sessionId: string }) => {
    return { workingDirectory: resolveSandboxWorkingDir(params.sessionId) }
  })

  ipcMain.handle('sandbox:check-availability', async () => {
    try {
      return await checkAvailability()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:check-availability failed', msg)
      return { available: false, reason: msg }
    }
  })

  ipcMain.handle('sandbox:init-temp', async (_event, params: { sessionId: string; workingDirectories?: string[] }) => {
    try {
      log.info(`sandbox:init-temp sessionId=${params.sessionId}`)
      return await initSandboxWithTempDir(params.sessionId, params.workingDirectories ?? [])
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:init-temp failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    'sandbox:copy-file',
    async (_event, params: { content: string; targetFilename: string; sessionId?: string }) => {
      try {
        log.debug(`sandbox:copy-file target=${params.targetFilename}`)
        return await copyFileToSandbox(params.content, params.targetFilename, params.sessionId)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:copy-file failed', msg)
        return { success: false, error: msg }
      }
    }
  )

  // Copy a blob from the store directly to the sandbox (avoids sending content through IPC)
  ipcMain.handle(
    'sandbox:copy-blob',
    async (_event, params: { blobKey: string; targetFilename: string; sessionId?: string }) => {
      try {
        log.debug(`sandbox:copy-blob key=${params.blobKey} target=${params.targetFilename}`)
        return await copyBlobToSandbox(params.blobKey, params.targetFilename, params.sessionId)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:copy-blob failed', msg)
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle(
    'sandbox:seed-blobs',
    async (_event, params: { items: Array<{ blobKey: string; targetFilename: string }>; sessionId?: string }) => {
      try {
        log.debug(`sandbox:seed-blobs count=${params.items.length}`)
        return await seedBlobsToSandbox(params.items, params.sessionId)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:seed-blobs failed', msg)
        return { success: false, error: msg, results: [] }
      }
    }
  )

  ipcMain.handle('sandbox:export-file', async (_event, params: { sandboxPath: string; suggestedName?: string }) => {
    try {
      log.debug(`sandbox:export-file path=${params.sandboxPath}`)
      return await exportFileFromSandbox(params.sandboxPath, params.suggestedName)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:export-file failed', msg)
      return { success: false, error: msg }
    }
  })

  // Persist a generated file to durable storage (userData) so it stays downloadable
  // even after the transient temp working directory is evicted or cleaned up.
  ipcMain.handle(
    'sandbox:persist-artifact',
    async (_event, params: { sandboxPath: string; sessionId: string; displayName?: string }) => {
      try {
        log.debug(`sandbox:persist-artifact path=${params.sandboxPath}`)
        return await persistSandboxArtifact(params.sandboxPath, params.sessionId, params.displayName)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('sandbox:persist-artifact failed', msg)
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle('sandbox:has-artifacts', (_event, params: { sessionId: string }) => {
    return { has: hasSessionArtifacts(params.sessionId) }
  })

  ipcMain.handle('sandbox:remove-artifacts', (_event, params: { sessionId: string }) => {
    try {
      log.debug(`sandbox:remove-artifacts session=${params.sessionId}`)
      return removeSessionArtifacts(params.sessionId)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:remove-artifacts failed', msg)
      return { success: false, error: msg }
    }
  })

  // Read a file as base64 directly from disk (no sandbox init required).
  // Restricted to files within a known sandbox root (temp working dirs or persisted artifacts).
  ipcMain.handle('sandbox:read-file-base64', async (_event, params: { filePath: string; maxBytes?: number }) => {
    try {
      const sandboxRoots = getSandboxAllowedRoots()
      return await readSandboxFileBase64(params, sandboxRoots)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, error: msg }
    }
  })

  // Binary transport for image decoding. Avoids expanding large files into base64 in the
  // main process and synchronously decoding that string again on the renderer main thread.
  ipcMain.handle('sandbox:read-file-bytes', async (_event, params: { filePath: string; maxBytes?: number }) => {
    try {
      const sandboxRoots = getSandboxAllowedRoots()
      const result = await readSandboxFileBytes(params, sandboxRoots)
      if (!result.success) return result
      return { success: true, bytes: bufferToArrayBuffer(result.bytes) }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:create-html-preview', async (_event, params: { filePath: string }) => {
    return await createSandboxHtmlPreviewUrl(params.filePath)
  })

  log.info('Sandbox IPC handlers registered')
}
