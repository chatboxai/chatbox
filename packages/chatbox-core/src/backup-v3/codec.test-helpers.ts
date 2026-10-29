import { TextDecoder } from 'node:util'
import type { BackupCodec } from './types'

export function trackedNodeCodec() {
  let decodes = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const codec: BackupCodec = {
    decodeUtf8(bytes) {
      decodes++
      return decoder.decode(bytes)
    },
  }
  return { codec, decodes: () => decodes }
}
