export { buildContext, injectAttachments, prepareContextMessages, selectContextMessages } from './builder'
export {
  buildCompactionHandoff,
  type CompactionHandoffMode,
  getCompactionHandoffMode,
  getContextHistoryStartNote,
} from './compaction-handoff'
export { findLatestApplicableCompactionPoint } from './compaction-points'
export { isContextEligibleMessage } from './message-eligibility'
export {
  CONTEXT_HISTORY_START_MESSAGE_ID,
  type ContextProjectionEntry,
  type ContextProjectionOptions,
  getContextProjectionText,
  projectContextMessagesForModel,
} from './model-projection'
export {
  flattenToolCallPartsToText,
  TOOL_FLATTEN_ARGS_PREVIEW_CHARS,
  TOOL_FLATTEN_RESULT_PREVIEW_CHARS,
} from './tool-flatten'
export { estimateMessageToolCallTokens, estimateToolCallPartTokens } from './tool-tokens'
export type {
  AttachmentResolver,
  ContextBuilderOptions,
  ContextPreparationOptions,
  ContextSelectionOptions,
} from './types'
