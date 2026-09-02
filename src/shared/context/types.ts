/**
 * Shared types for context building
 * Platform abstraction for attachment handling
 */

import type { CompactionPoint } from '@shared/types'

/**
 * Platform abstraction for reading attachments
 * Implemented by renderer platform layer, used by shared context builder
 */
export interface AttachmentResolver {
  /**
   * Read attachment content as string
   * @param attachmentId - The attachment identifier
   * @returns Attachment content or null if not found
   */
  read(attachmentId: string): Promise<string | null>
}

/**
 * How historical tool-call parts are treated when building context.
 *
 * - `'none'` — keep every tool call and result intact. What pressure-aware
 *   callers use while context tokens are below the relief threshold.
 * - `'stub-old-results'` — for messages older than the recent-round window,
 *   keep the tool call (name + args) but replace the result payload with a
 *   compact stub. Preserves the record of what happened while shedding the
 *   bulk; activated under context pressure. Callers without pressure
 *   assessment that still need bounded tool history pick this unconditionally.
 */
export type ToolCleanupMode = 'none' | 'stub-old-results'

/**
 * Options for {@link selectContextMessages} — the which-messages half of
 * context building (ordering, eligibility, compaction slicing, error filter,
 * message-count limit) without any content rewriting.
 */
export interface ContextSelectionOptions {
  compactionPoints?: CompactionPoint[]
  maxContextMessageCount?: number
}

/**
 * Options for context building
 */
export interface ContextBuilderOptions {
  /**
   * Resolver for accessing attachments
   */
  attachmentResolver: AttachmentResolver

  /**
   * Maximum number of messages to include in context (optional)
   * When set, limits the context to the most recent N messages
   */
  maxContextMessageCount?: number

  /**
   * Compaction points for history compression (optional)
   * When provided, context starts from the latest compaction point
   */
  compactionPoints?: CompactionPoint[]

  /**
   * How historical tool-call parts are treated (see {@link ToolCleanupMode}).
   * Required so every caller makes an explicit choice: pressure-aware callers
   * pass 'none' below the relief threshold and 'stub-old-results' above it;
   * callers whose output never reaches a model (e.g. tool selection) pass
   * 'none'.
   */
  toolCleanupMode: ToolCleanupMode

  /**
   * Number of recent tool call rounds to keep intact (optional)
   * Older tool calls are cleaned up / stubbed depending on toolCleanupMode
   * Default: 2
   */
  keepToolCallRounds?: number

  /**
   * Message IDs whose tool call parts should always be preserved.
   * This is used for cache-friendly continuation flows where a recent
   * tool result is expected to remain in the prompt.
   */
  preserveToolCallMessageIds?: string[]

  /**
   * Whether the model supports tool use for file reading (optional)
   * When true, large files are truncated with instructions to use tools
   * Default: false
   */
  modelSupportToolUseForFile?: boolean

  /**
   * When true, inject <ATTACHMENT_FILE> metadata instead of file content.
   * Files are available in the sandbox for code_execution / read_file tools.
   * Default: false
   */
  sandboxMode?: boolean
}
