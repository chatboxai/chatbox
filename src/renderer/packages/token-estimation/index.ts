/**
 * Token Estimation Module
 *
 * Unified export file for the token estimation system.
 * Provides types, hooks, and utilities for computing token counts across different models.
 */

// ============================================================================
// Types
// ============================================================================

export { getDraftTokenizationText, seedExactDraftTokens } from './draft-tokenization'
export type {
  ComputationTask,
  ContentMode,
  ExactDraftTokens,
  QueueState,
  TaskResult,
  TokenBreakdown,
  TokenCacheKey,
  TokenEstimationResult,
  TokenizerType,
} from './types'

// ============================================================================
// Hook
// ============================================================================

export { useTokenEstimation } from './hooks/useTokenEstimation'

// ============================================================================
// Queue
// ============================================================================

export { computationQueue, getPriority, PRIORITY } from './computation-queue'

// ============================================================================
// Persister
// ============================================================================

export { ResultPersister, resultPersister } from './result-persister'

// ============================================================================
// Executor
// ============================================================================

export { initializeExecutor, setResultPersister } from './task-executor'

// ============================================================================
// Cache utilities
// ============================================================================

export { getTokenCacheKey, isAttachmentCacheValid, isMessageTextCacheValid } from './cache-keys'

// ============================================================================
// Tokenizer
// ============================================================================

export { estimateTokens, getTokenizerType, isDeepSeekModel } from './tokenizer'
