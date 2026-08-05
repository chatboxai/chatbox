/**
 * Session Module Public API
 *
 * This module provides all session-related operations for Chatbox.
 * Internal helpers (prefixed with _) are intentionally not exported.
 *
 * Public exports: 40 functions + types + state
 * - CRUD (8): Session lifecycle operations
 * - Messages (5): Message CRUD and user input handling
 * - Threads (9): Thread/history management
 * - Forks (5): Message branching operations
 * - Generation (8): AI generation orchestration
 * - Naming (4): Session/thread naming
 * - Export (1): Export functionality
 */

export {
  createDefaultAgentModeEntry,
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
// Export operations (1 function)
export { exportSessionChat } from './export'
// Fork operations (5 functions)
export { createNewFork, deleteFork, expandFork, findMessageLocation, switchFork } from './forks'
// Generation operations (8 functions)
export {
  generate,
  generateMore,
  generateMoreInNewFork,
  genMessageContext,
  getMessageThreadContext,
  getSessionWebBrowsing,
  regenerateInNewFork,
} from './generation'
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
  scheduleGenerateNameAndThreadName,
  scheduleGenerateThreadName,
} from './naming'
export { getOCRModel, ocrImagesInMessages } from './ocr-helper'
// Orchestration and AI helpers
export {
  continuePausedToolCall,
  isRetryableToolCallStep,
  orchestrateGeneration,
  retryFromLastToolCallAfterApiError,
  stopPausedToolCall,
} from './orchestration'
export { createLoadingPictures } from './pictures'
export type { GenerationOutcome, NewQueuedSubmission, SubmissionOutcome } from './submission-queue'
export {
  acceptSubmission,
  clearSessionSubmissionQueue,
  drainSubmissionQueue,
  pauseSubmissionQueue,
  removeQueuedSubmission,
  resumeSubmissionQueue,
  updateQueuedSubmission,
  wakeSubmissionQueueAfterToolResolution,
} from './submission-queue'
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
