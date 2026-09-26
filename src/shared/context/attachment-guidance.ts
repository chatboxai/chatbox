export const WHOLE_DOCUMENT_READ_GUIDANCE =
  'For whole-document organization, translation, conversion, or exhaustive extraction, use an available text path: read PARSED_SANDBOX_PATH ' +
  'sequentially with read_file; for original text files, use SANDBOX_PATH. Start at offset=1 with bounded limits. ' +
  'Check range and truncation notices on every result, including the final page. Only after the returned text is complete, continue from endLine + 1 until totalLines is covered. ' +
  'If the total output is shortened, reread the same offset with a smaller limit before advancing. If individual lines are shortened, reducing limit cannot recover them: ' +
  'read the same text file in bounded Unicode-safe character chunks with a script, track character offsets, and recover all omitted text before advancing. ' +
  'Line-number coverage alone does not establish complete text coverage. ' +
  'Use retrieval only to supplement specific gaps, not as evidence of full-document coverage. ' +
  'Preserve section headings and page markers when present; do not invent missing page mappings. ' +
  'For text-processing tasks, inspect the original document only if extracted text is unavailable, unreadable, ' +
  'or has verified gaps, and target the affected sections or pages. Do not re-OCR or render an entire PDF when its extracted text is sufficient.'

export const FOCUSED_ATTACHMENT_QUERY_GUIDANCE =
  'For focused questions about a ready indexed attachment, use query_session_attachment followed by ' +
  'read_session_attachment_parents. For questions unrelated to attachments, answer normally without retrieval.'

export const ATTACHMENT_INDEX_STATUS_GUIDANCE =
  'INDEX_STATUS describes retrieval readiness, not extracted-text availability or completeness. ' +
  'If indexing is pending or failed but a readable sandbox text path is available, use that path. ' +
  'If neither readable text nor ready retrieval is available, explain the access limitation instead of guessing.'
