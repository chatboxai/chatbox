/**
 * Stable error codes produced by the desktop local file parser (src/main/file-parser.ts)
 * and surfaced to the user by the renderer's FileParseError modal.
 *
 * These are shared so the main process can tag a parse failure with a specific
 * reason and the renderer can render an accurate, actionable message instead of
 * the generic "unsupported file" fallback.
 */

/** A password-protected PDF that pdfjs cannot read without the password. */
export const LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR = 'pdf_password_protected'

/** A file that exceeds the local parser size guard (see LOCAL_PARSER_MAX_PDF_FILE_SIZE). */
export const LOCAL_PARSER_FILE_TOO_LARGE_ERROR = 'local_parser_file_too_large'

/** File preprocessing completed without producing any readable attachment content. */
export const EMPTY_ATTACHMENT_CONTENT_ERROR = 'empty_attachment_content'

/** Chatbox AI cloud parsing was requested, but no license key is configured. */
export const CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR = 'chatbox_ai_parser_license_key_required'

/**
 * Upper bound on PDF size for local parsing. pdfjs reads the whole file into a
 * Buffer and keeps another copy internally, so a very large PDF can hold 2-3x its
 * size in the main process and OOM low-memory machines. Mirrors the remote path's
 * KNOWLEDGE_BASE_MAX_FILE_SIZE (50 MB).
 */
export const LOCAL_PARSER_MAX_PDF_FILE_SIZE = 50 * 1024 * 1024
export const LOCAL_PARSER_MAX_PDF_FILE_SIZE_LABEL = '50 MB'

/**
 * Error codes the local parser raises intentionally. The IPC layer only forwards
 * a failure's message to the renderer as an `errorCode` when it is one of these,
 * so arbitrary internal error text never leaks to the UI.
 */
export const KNOWN_LOCAL_PARSER_ERROR_CODES: ReadonlySet<string> = new Set([
  LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR,
  LOCAL_PARSER_FILE_TOO_LARGE_ERROR,
])

/** Local parser errors that cloud fallback cannot recover (encrypted / oversized). */
export const NON_RECOVERABLE_LOCAL_PARSER_ERROR_CODES: ReadonlySet<string> = new Set([
  LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR,
  LOCAL_PARSER_FILE_TOO_LARGE_ERROR,
])
