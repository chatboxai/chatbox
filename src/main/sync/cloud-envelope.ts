import { type CloudSyncPayload, isSyncSelection, maxSyncArchiveBytes } from '../../shared/sync'
import { decryptBytes, encryptBytes, type NodeEncryptedEnvelope } from './e2ee-node'

interface StoredCloudEnvelope extends Omit<CloudSyncPayload, 'backup'> {
  format: 'chatany-sync-v1'
  version: 1
  encrypted: boolean
  payload: string | NodeEncryptedEnvelope
}

const maxEnvelopeBytes = Math.ceil(maxSyncArchiveBytes / 3) * 4 + 16 * 1024

export async function readCloudEnvelopeText(response: Response): Promise<string> {
  if (!response.body) throw new Error('unsupported_cloud_sync_payload')
  if (Number(response.headers.get('content-length')) > maxEnvelopeBytes) {
    await response.body.cancel().catch(() => {})
    throw new Error('sync_archive_too_large')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const chunks: string[] = []
  let size = 0
  try {
    let item = await reader.read()
    while (!item.done) {
      size += item.value.byteLength
      if (size > maxEnvelopeBytes) throw new Error('sync_archive_too_large')
      chunks.push(decoder.decode(item.value, { stream: true }))
      item = await reader.read()
    }
    chunks.push(decoder.decode())
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return chunks.join('')
}

export async function readCloudEnvelope(response: Response, token?: string): Promise<CloudSyncPayload> {
  return decodeCloudEnvelope(await readCloudEnvelopeText(response), token)
}

export function encodeCloudEnvelope(payload: CloudSyncPayload, encrypt: boolean, token?: string): string {
  const { backup, ...metadata } = payload
  if (backup.byteLength > maxSyncArchiveBytes) throw new Error('sync_archive_too_large')
  const envelope: StoredCloudEnvelope = {
    ...metadata,
    format: 'chatany-sync-v1',
    version: 1,
    encrypted: encrypt,
    payload: encrypt ? encryptBytes(backup, token || '') : Buffer.from(backup).toString('base64'),
  }
  return JSON.stringify(envelope)
}

export function decodeCloudEnvelope(source: string, token?: string): CloudSyncPayload {
  let envelope: StoredCloudEnvelope
  try {
    envelope = JSON.parse(source)
  } catch {
    throw new Error('unsupported_cloud_sync_payload')
  }
  if (
    envelope?.format !== 'chatany-sync-v1' ||
    envelope.version !== 1 ||
    typeof envelope.encrypted !== 'boolean' ||
    typeof envelope.revision !== 'string' ||
    !envelope.revision ||
    typeof envelope.deviceId !== 'string' ||
    !Number.isFinite(envelope.updatedAt) ||
    typeof envelope.contentFingerprint !== 'string' ||
    (envelope.parentRevision !== undefined && typeof envelope.parentRevision !== 'string') ||
    !isSyncSelection(envelope.selection)
  ) {
    throw new Error('unsupported_cloud_sync_payload')
  }
  const { revision, parentRevision, deviceId, updatedAt, selection, contentFingerprint } = envelope
  let backup: Uint8Array
  if (envelope.encrypted) {
    if (!token) throw new Error('encryption_token_required')
    try {
      backup = decryptBytes(envelope.payload as NodeEncryptedEnvelope, token)
    } catch {
      throw new Error('cloud_decryption_failed')
    }
  } else {
    if (typeof envelope.payload !== 'string' || !envelope.payload) throw new Error('unsupported_cloud_sync_payload')
    backup = new Uint8Array(Buffer.from(envelope.payload, 'base64'))
  }
  if (backup.byteLength > maxSyncArchiveBytes) throw new Error('sync_archive_too_large')
  if (!backup.byteLength) throw new Error('unsupported_cloud_sync_payload')
  return { revision, parentRevision, deviceId, updatedAt, selection, contentFingerprint, backup }
}
