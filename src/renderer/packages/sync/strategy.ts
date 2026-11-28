import type { SyncBaseline, SyncService } from '@shared/sync'

export type SyncAction = 'upload-local' | 'replace-local-from-cloud' | 'none'

export function decideSyncAction(input: {
  service: SyncService
  baseline?: SyncBaseline
  selectionKey: string
  localFingerprint: string
  cloudRevision: string
}): SyncAction {
  const { service, baseline, selectionKey, localFingerprint, cloudRevision } = input
  const selectionChanged = baseline && baseline.selectionKey !== selectionKey
  if (service === 'baidu-netdisk' && selectionChanged) return 'upload-local'
  if (!baseline || baseline.cloudRevision !== cloudRevision) return 'replace-local-from-cloud'
  if (service === 'webdav' && (!baseline.localFingerprint || !baseline.selectionKey)) {
    return 'replace-local-from-cloud'
  }
  if (selectionChanged || baseline.localFingerprint !== localFingerprint) return 'upload-local'
  return 'none'
}
