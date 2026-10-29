import type { BackupCodec } from './types'

const decoder = new TextDecoder('utf-8', { fatal: true })

export const defaultBackupCodec: BackupCodec = {
  decodeUtf8: (bytes) => decoder.decode(bytes),
}
