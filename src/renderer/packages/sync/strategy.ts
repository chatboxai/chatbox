import type { SyncBaseline } from '@shared/sync'

export type SyncAction = 'upload-local' | 'replace-local-from-cloud' | 'none'

export function decideSyncAction(input: {
  baseline?: SyncBaseline
  selectionKey: string
  localFingerprint: string
  cloudRevision: string
}): SyncAction {
  const { baseline, selectionKey, localFingerprint, cloudRevision } = input
  if (baseline && baseline.selectionKey !== selectionKey) return 'upload-local'
  if (!baseline || baseline.cloudRevision !== cloudRevision) return 'replace-local-from-cloud'
  if (baseline.localFingerprint !== localFingerprint) return 'upload-local'
  return 'none'
}
