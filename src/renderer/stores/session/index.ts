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
  acceptParallelOutputSlot,
  createLoadingPictures,
  generate,
  generateMore,
  generateMoreInNewFork,
  generateParallelOutput,
  genMessageContext,
  getMessageThreadContext,
  getSessionWebBrowsing,
  regenerateInNewFork,
} from './generation'
// Message operations (5 functions)
export { insertMessage, insertMessageAfter, modifyMessage, removeMessage, submitNewUserMessage } from './messages'

// Naming operations (4 functions)
export {
  modifyNameAndThreadName,
  modifyThreadName,
  scheduleGenerateNameAndThreadName,
  scheduleGenerateThreadName,
} from './naming'
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
// Types and state
export * from './types'
