import type { SessionRowRecord } from '../../session/session-tree/types'
import type { SessionHeader } from '../../types/session'

export function sessionRowHeader(record: SessionRowRecord): SessionHeader {
  const {
    storageFormat: _format,
    rowFormatVersion: _version,
    rowAuthority: _authority,
    activeThreadId: _thread,
    ...header
  } = record
  return header
}
