/**
 * Session Module Public API
 *
 * This module provides all session-related operations for Chatbox.
 * Internal helpers (prefixed with _) are intentionally not exported.
 *
 * Public exports: 41 functions + types + state
 * - CRUD (8): Session lifecycle operations
 * - Messages (5): Message CRUD and user input handling
 * - Threads (9): Thread/history management
 * - Forks (6): Message branching operations
 * - Generation (8): AI generation orchestration
 * - Naming (4): Session/thread naming
 * - Export (1): Export functionality
 */

// Action gating (2 functions)
export { getSessionLockStateNow, guardSessionAction } from './action-guard'
export {
  createDefaultAgentModeEntry,
  createNewChatAgentModeEntry,
  getSessionAgentModeEntry,
  getSessionAgentModeFromSession,
  lockSessionAgentMode,
  setSessionAgentMode,
  useSessionAgentMode,
} from './agent-mode'
export { createAttachmentResolver } from './attachment-resolver'
// CRUD operations (8 functions)
export {
  clear,
  clearConversationList,
  copyAndSwitchSession,
  createEmpty,
  reorderSessions,
  switchCurrentSession,
  switchToIndex,
  switchToNext,
} from './crud'
// Export operations
export { exportSessionChat } from './export'
// Fork operations (7 functions)
export {
  createNewFork,
  createSaveAndResendFork,
  deleteFork,
  expandFork,
  findMessageLocation,
  switchFork,
  switchForkTo,
} from './forks'
// Generation operations (8 functions)
export {
  generate,
  generateMore,
  genMessageContext,
  getMessageThreadContext,
  getSessionWebBrowsing,
  regenerateInNewFork,
  retryFromLastToolCallAfterApiError,
  saveAndResendMessage,
} from './generation'
export type { GenerationCancellationDependencies } from './generation-cancellation'
export { stopAllMessageGenerations, stopMessageGeneration } from './generation-cancellation'
// Message queue (queue user messages while a generation is running)
export type { QueuedUserMessage, QueuePausedReason } from './message-queue'
export {
  clearQueue,
  enqueueUserMessage,
  messageQueueStore,
  removeQueuedMessage,
  resumeQueueAndDrain,
} from './message-queue'
export { hasContentForAutoTitle, hasSuccessfulUserAssistantTurn, isSuccessfulAssistantReply } from './message-success'
// Message operations (5 functions)
export {
  insertMessage,
  insertMessageAfter,
  modifyMessage,
  persistStreamingMessage,
  removeMessage,
  submitNewUserMessage,
  updateStreamingCache,
} from './messages'
// Naming operations (4 functions)
export {
  modifyNameAndThreadName,
  modifyThreadName,
  syncSessionAutoTitle,
} from './naming'
export { getOCRModel, ocrImagesInMessages } from './ocr-helper'
// Thread operations (9 functions)
export {
  compressAndCreateThread,
  editThread,
  moveCurrentThreadToConversations,
  moveThreadToConversations,
  refreshContextAndCreateNewThread,
  removeCurrentThread,
  removeThread,
  startNewThread,
  switchThread,
} from './threads'
export { buildToolsForSession } from './tools-builder'
// Types and state
export * from './types'
export {
  findTargetMessageIndex,
  handleGenerationError,
  initializeTargetMessage,
  trackGenerateEvent,
} from './utils'
export { resolveWebBrowsingMode } from './web-browsing'
