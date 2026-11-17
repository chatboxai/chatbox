/**
 * `SessionTree` is the row model for message-row session storage: message rows
 * forming a per-thread tree, thread rows, and a session record. The external codecs
 * validate and convert historical input during import and migration.
 */

export { type DecodeSessionTreeResult, decodeSessionTree } from './decode'
export {
  type EncodeSessionTreeOptions,
  type EncodeSessionTreeResult,
  encodeSessionTree,
  messageRowStatus,
  messageRowUpdatedAt,
} from './encode'
export { type NormalizeSessionV1Result, normalizeSessionV1 } from './normalize'
export { repairSessionV1 } from './repair'
export type {
  MessageRow,
  MessageRowMetadata,
  MessageRowKind,
  MessageRowStatus,
  SessionRecordV2,
  SessionRowRecord,
  SessionMessageFacts,
  SessionThreadSummary,
  SessionTree,
  ThreadRow,
} from './types'
export { type SessionTreeValidationResult, validateSessionTree } from './validate'
export { type VerifySessionTreeRoundTripResult, verifySessionTreeRoundTrip } from './verify'
export { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../message-facts'
