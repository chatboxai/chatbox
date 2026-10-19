/**
 * Shared types for context building
 * Platform abstraction for attachment handling
 */

import type { CompactionPoint } from '../types'

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
 * Options for {@link selectContextMessages} — the which-messages half of
 * context building (ordering, eligibility, compaction slicing, error filter,
 * message-count limit) without any content rewriting.
 */
export interface ContextSelectionOptions {
  compactionPoints?: CompactionPoint[]
  maxContextMessageCount?: number
}

/** The model-facing send window: selection plus its projection. */
export interface ContextPreparationOptions extends ContextSelectionOptions {
  /** App language code (`Settings['language']`) for the wording the projection adds. */
  language?: string
}

/**
 * Options for context building
 */
export interface ContextBuilderOptions extends ContextPreparationOptions {
  /**
   * Resolver for accessing attachments
   */
  attachmentResolver: AttachmentResolver

  /**
   * Whether the model supports tool use for file reading (optional)
   * When true, large files are truncated with instructions to use tools
   * Default: false
   */
  modelSupportToolUseForFile?: boolean

  /**
   * When true, inject <ATTACHMENT_FILE> metadata instead of file content.
   * Files are available in the sandbox for read_file and script tools.
   * Default: false
   */
  sandboxMode?: boolean
}
