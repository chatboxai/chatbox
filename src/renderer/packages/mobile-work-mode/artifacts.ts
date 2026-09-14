import { buildWorkArtifactPreview } from '@shared/mobile-work/artifact-preview'
import { base64ToText, workspacePath } from '@shared/mobile-work/workspace-path'
import type { WorkArtifact } from '@shared/work-artifacts'

const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024

export async function readLocalWorkArtifact(sessionId: string, artifact: WorkArtifact): Promise<string> {
  workspacePath(artifact.path)
  if (!artifact.path.startsWith('artifacts/') || artifact.size > MAX_ARTIFACT_BYTES)
    throw new Error('File is missing or too large')
  let base64: string | undefined
  if (artifact.storageKey) {
    const { currentBlobStorage } = await import('@/adapters/CurrentBlobStorage')
    const stored = await currentBlobStorage.get(artifact.storageKey)
    if (stored && stored.length <= Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 1024) {
      base64 = /^data:[^,]*;base64,([\s\S]*)$/.exec(stored)?.[1]
    }
  }
  if (base64 === undefined) {
    const { CapacitorWorkspace } = await import('./CapacitorWorkspace')
    base64 = await new CapacitorWorkspace().readBase64(sessionId, artifact.path)
  }
  if (
    base64.length > Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 ||
    (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) > MAX_ARTIFACT_BYTES ||
    base64.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(base64) ||
    !/^[^=]*={0,2}$/.test(base64)
  ) {
    throw new Error('File is missing or too large')
  }
  return base64
}

export async function shareLocalWorkArtifact(artifact: WorkArtifact, base64: string): Promise<void> {
  const { Capacitor } = await import('@capacitor/core')
  if (!Capacitor.isNativePlatform()) {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.download = artifact.path.split('/').pop() ?? 'artifact'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const filename = workspacePath(artifact.path).split('/').pop() ?? 'artifact'
  const path = `work-exports/${crypto.randomUUID()}/${filename}`
  try {
    const { uri } = await Filesystem.writeFile({ directory: Directory.Cache, path, data: base64, recursive: true })
    await Share.share({ title: artifact.name, files: [uri], dialogTitle: artifact.name })
  } finally {
    await Filesystem.deleteFile({ directory: Directory.Cache, path }).catch(() => undefined)
  }
}

export function localWorkPreviewDocument(base64: string): string {
  return buildWorkArtifactPreview(base64ToText(base64))
}
