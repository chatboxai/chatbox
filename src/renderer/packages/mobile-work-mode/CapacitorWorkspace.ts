import { WorkspaceLifecycle } from '@shared/mobile-work/workspace-lifecycle'
import { Directory, Filesystem, type FilesystemPlugin } from '@capacitor/filesystem'
import type { BlobStoragePort, Message } from '@chatbox/core'
import { throwIfWorkAborted } from '@shared/mobile-work/abort'
import { bundleStaticSite } from '@shared/mobile-work/site-preview'
import { collectWorkspaceInputs, type AttachmentMessages } from '@shared/mobile-work/workspace-inputs'
import {
  base64ToText,
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_FILES,
  sessionDirectoryName,
  textToBase64,
  validateWorkspaceFiles,
  type WorkspaceFiles,
  workspacePath,
} from '@shared/mobile-work/workspace-path'
import type { LocalWorkspacePort } from '@shared/mobile-work/workspace-port'
import { workArtifactMimeType, type WorkArtifact } from '@shared/work-artifacts'

export { WorkspaceAttachmentCapacityError } from '@shared/mobile-work/workspace-inputs'

export async function blobToBase64(blob: Blob): Promise<string> {
  let binary = ''
  for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class CapacitorWorkspace implements LocalWorkspacePort {
  private readonly lifecycle = new WorkspaceLifecycle()

  reopen(sessionId: string): void {
    this.lifecycle.reopen(sessionId)
  }

  constructor(private readonly filesystem: FilesystemPlugin = Filesystem) {}

  async remove(sessionId: string): Promise<void> {
    await this.lifecycle.remove(sessionId, async () => {
      const path = `workspaces/${sessionDirectoryName(sessionId)}`
      try {
        await this.filesystem.rmdir({ path, directory: Directory.Data, recursive: true })
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'OS-PLUG-FILE-0008') throw error
      }
    })
  }

  private root(sessionId: string): string {
    this.lifecycle.assertOpen(sessionId)
    return `workspaces/${sessionDirectoryName(sessionId)}`
  }
  private path(sessionId: string, path: string): string {
    return `${this.root(sessionId)}/${workspacePath(path)}`
  }

  private async ensureDirectory(path: string, directory = Directory.Data): Promise<void> {
    try {
      await this.filesystem.mkdir({ path, directory, recursive: true })
    } catch (error) {
      const existing = await this.filesystem.stat({ path, directory }).catch(() => null)
      if (existing?.type !== 'directory') throw error
    }
  }

  async getUri(sessionId: string, path: string): Promise<string> {
    return (await this.filesystem.getUri({ path: this.path(sessionId, path), directory: Directory.Data })).uri
  }

  async readBase64(sessionId: string, path: string): Promise<string> {
    const fullPath = this.path(sessionId, path)
    const stat = await this.filesystem.stat({ path: fullPath, directory: Directory.Data })
    if (stat.type !== 'file' || stat.size > MAX_WORKSPACE_BYTES) throw new Error('File missing or too large')
    const { data } = await this.filesystem.readFile({ path: fullPath, directory: Directory.Data })
    return typeof data === 'string' ? data : blobToBase64(data)
  }

  async readText(sessionId: string, path: string): Promise<string> {
    return base64ToText(await this.readBase64(sessionId, path))
  }

  async snapshot(sessionId: string): Promise<WorkspaceFiles> {
    return this.lifecycle.run(sessionId, async () => {
      await this.ensureDirectory(this.root(sessionId))
      const files: WorkspaceFiles = Object.create(null)
      let bytes = 0
      const visit = async (prefix: string): Promise<void> => {
        const { files: entries } = await this.filesystem.readdir({
          path: `${this.root(sessionId)}/${prefix}`,
          directory: Directory.Data,
        })
        for (const entry of entries) {
          if (!prefix && entry.name === 'artifacts') continue
          const path = workspacePath(prefix + entry.name)
          if (entry.type === 'directory') await visit(`${path}/`)
          else {
            bytes += entry.size
            if (bytes > MAX_WORKSPACE_BYTES || Object.keys(files).length >= MAX_WORKSPACE_FILES)
              throw new Error('Workspace exceeds execution limits')
            files[path] = { base64: await this.readBase64(sessionId, path) }
          }
        }
      }
      await visit('')
      return files
    })
  }

  private async writeRaw(sessionId: string, path: string, base64: string): Promise<void> {
    return this.lifecycle.run(sessionId, async () => {
      const fullPath = this.path(sessionId, path)
      await this.ensureDirectory(fullPath.slice(0, fullPath.lastIndexOf('/')))
      await this.filesystem.writeFile({ path: fullPath, data: base64, directory: Directory.Data })
    })
  }

  async write(sessionId: string, path: string, base64: string): Promise<void> {
    validateWorkspaceFiles({ ...(await this.snapshot(sessionId)), [path]: { base64 } })
    await this.writeRaw(sessionId, path, base64)
  }

  async commit(sessionId: string, files: WorkspaceFiles, signal: AbortSignal): Promise<void> {
    validateWorkspaceFiles({ ...(await this.snapshot(sessionId)), ...files })
    for (const path of Object.keys(files)) {
      if (path.startsWith('input/') || path.startsWith('artifacts/'))
        throw new Error('Input and delivered files are read-only')
    }
    throwIfWorkAborted(signal)
    for (const [path, file] of Object.entries(files)) {
      throwIfWorkAborted(signal)
      await this.writeRaw(sessionId, path, file.base64)
    }
  }

  async preflight(
    sessionId: string | null,
    messages: AttachmentMessages,
    blobs: BlobStoragePort
  ): Promise<WorkspaceFiles> {
    return collectWorkspaceInputs(sessionId ? await this.snapshot(sessionId) : {}, messages, blobs, hash)
  }

  async seed(sessionId: string, messages: Message[], blobs: BlobStoragePort): Promise<void> {
    const pending = await this.preflight(sessionId, messages, blobs)
    for (const [path, file] of Object.entries(pending)) await this.writeRaw(sessionId, path, file.base64)
  }

  async importPhoto(sessionId: string, asset: { filename: string; base64: string }): Promise<{ path: string }> {
    const name = asset.filename.replace(/[\\/:%\u0000-\u001f]/g, '_').slice(-100) || 'photo.jpg'
    const path = `input/photo-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`
    await this.write(sessionId, path, asset.base64)
    return { path }
  }

  async preparePhotoExport(sessionId: string, path: string): Promise<{ uri: string; cleanup(): Promise<void> }> {
    if (!/\.(?:png|jpe?g|gif|webp|heic)$/i.test(path)) throw new Error('Choose an image file')
    const data = await this.readBase64(sessionId, path)
    const name = workspacePath(path).split('/').pop() ?? 'photo.png'
    const cachePath = `work-photo-exports/${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`
    await this.ensureDirectory('work-photo-exports', Directory.Cache)
    await this.filesystem.writeFile({ path: cachePath, directory: Directory.Cache, data })
    const { uri } = await this.filesystem.getUri({ path: cachePath, directory: Directory.Cache })
    return {
      uri,
      cleanup: async () => {
        await this.filesystem.deleteFile({ path: cachePath, directory: Directory.Cache })
      },
    }
  }

  async deliver(sessionId: string, path: string): Promise<WorkArtifact> {
    const name = workspacePath(path).split('/').pop() ?? 'file'
    const base64 = /\.html?$/i.test(name)
      ? textToBase64(bundleStaticSite(path, await this.snapshot(sessionId)))
      : await this.readBase64(sessionId, path)
    const artifactPath = `artifacts/${Date.now()}-${Math.random().toString(36).slice(2)}/${name}`
    await this.writeRaw(sessionId, artifactPath, base64)
    const size = (base64.length * 3) / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
    return {
      path: artifactPath,
      name,
      mimeType: workArtifactMimeType(name),
      size,
    }
  }
}
