/**
 * `SessionTree` is the row model for message-row session storage: message rows
 * forming a per-thread tree, thread rows, and a session record. The functions
 * here convert a `Session` to that model and back, and check the conversion.
 */

export { type DecodeSessionTreeResult, decodeSessionTree } from './decode'
export { diffSessionRows } from './diff'
export {
  deriveSessionRecord,
  type EncodeSessionTreeOptions,
  type EncodeSessionTreeResult,
  encodeSessionTree,
  messageRowStatus,
  messageRowUpdatedAt,
  sessionTopologyFingerprint,
} from './encode'
export { type NormalizeSessionV1Result, normalizeSessionV1 } from './normalize'
export type { MessageRow, MessageRowKind, MessageRowStatus, SessionRecordV2, SessionTree, ThreadRow } from './types'
export { type SessionTreeValidationResult, validateSessionTree } from './validate'
export { type VerifySessionTreeRoundTripResult, verifySessionTreeRoundTrip } from './verify'
