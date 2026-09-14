export interface TextEdit {
  search: string
  replace: string
}

export interface FileEditError {
  success: false
  error: string
  errorCode:
    | 'INVALID_EDIT'
    | 'NOT_FOUND'
    | 'AMBIGUOUS_MATCH'
    | 'STALE_CONTENT'
    | 'WRITE_FAILED'
    | 'READ_FAILED'
    | 'FILE_NOT_FOUND'
    | 'PATH_REJECTED'
    | 'SANDBOX_UNAVAILABLE'
    | 'RESULT_UNCONFIRMED'
    | 'FILE_TOO_LARGE'
    | 'NOT_REGULAR_FILE'
  editIndex?: number
  matches?: number
  candidateLines?: number[]
}

export const MAX_EDIT_PREVIEW_CHARACTERS = 8000

export const MAX_EDIT_FILE_BYTES = 4 * 1024 * 1024

/** Actionable categories without file contents, locations, or platform error details. */
export const FILE_EDIT_ERROR_MESSAGES: Record<FileEditError['errorCode'], string> = {
  INVALID_EDIT: 'Provide a non-empty old_text and a string new_text.',
  NOT_FOUND: 'Search text was not found. Read the target region and use its current text.',
  AMBIGUOUS_MATCH: 'Search text is not unique. Include more surrounding text to select one occurrence.',
  STALE_CONTENT: 'File content changed. Read the file and submit a new edit.',
  FILE_TOO_LARGE: 'The file exceeds the 4 MiB edit limit. Use a bounded file-processing workflow.',
  NOT_REGULAR_FILE: 'The target must be a regular text file. Choose a regular file path.',
  FILE_NOT_FOUND: 'The file does not exist. Check the path, or use write_file to create it.',
  SANDBOX_UNAVAILABLE: 'Could not prepare sandbox file access. Check sandbox availability and permissions.',
  PATH_REJECTED: 'The target is not writable under the sandbox policy. Choose an allowed path or request access.',
  RESULT_UNCONFIRMED: 'Could not confirm the file operation. The file may have changed; read it before retrying.',
  READ_FAILED: 'Could not read the file. Check the path and read permissions before retrying.',
  WRITE_FAILED: 'Could not complete the write. Read the file to verify its state before retrying.',
}

export function fileEditError(errorCode: FileEditError['errorCode'], editIndex?: number): FileEditError {
  const index = editIndex !== undefined && Number.isSafeInteger(editIndex) && editIndex > 0 ? editIndex : undefined
  return {
    success: false,
    errorCode,
    error: `${index === undefined ? '' : `Edit ${index}: `}${FILE_EDIT_ERROR_MESSAGES[errorCode]}`,
    ...(index === undefined ? {} : { editIndex: index }),
  }
}

export interface FileEditSummary {
  success: true
  changed: boolean
  edits: number
  diff?: string
  diffTruncated?: boolean
  addedLines?: number
  removedLines?: number
  version?: string
}

export type FileEditResult = FileEditError | FileEditSummary

export interface FileEditRequest {
  filePath: string
  search?: string
  replace?: string
  edits?: TextEdit[]
  dryRun?: boolean
  expectedVersion?: string
}

/** Dependency-free so the same matcher can run inside a remote Node sandbox. */
export function applyTextEdits(content: string, edits: TextEdit[]): FileEditError | { success: true; content: string } {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { success: false, errorCode: 'INVALID_EDIT', error: 'Provide at least one edit.' }
  }
  let text = content
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index]
    if (!edit || typeof edit.search !== 'string' || !edit.search || typeof edit.replace !== 'string') {
      return {
        success: false,
        errorCode: 'INVALID_EDIT',
        editIndex: index + 1,
        error: `Edit ${index + 1}: old_text must be non-empty and new_text must be a string. No edits applied.`,
      }
    }
    // Normalize only the search view. Offsets map back to the original bytes so
    // mixed line endings and text outside the replacement stay untouched.
    const bomLength = text.startsWith('\uFEFF') ? 1 : 0
    const body = text.slice(bomLength)
    const view = body.replace(/\r\n/g, '\n')
    const search = edit.search.replace(/\r\n/g, '\n')
    const positions: number[] = []
    let count = 0
    for (let at = view.indexOf(search); at !== -1; at = view.indexOf(search, at + 1)) {
      count++
      if (positions.length < 5) positions.push(at)
    }
    if (count !== 1) {
      return {
        success: false,
        errorCode: count === 0 ? 'NOT_FOUND' : 'AMBIGUOUS_MATCH',
        editIndex: index + 1,
        matches: count,
        candidateLines: positions.map((at) => view.slice(0, at).split('\n').length),
        error:
          count === 0
            ? `Edit ${index + 1}: search text not found. No edits applied. Read the target region again and use its current text.`
            : `Edit ${index + 1}: search text is not unique (${count} matches). No edits applied. Include surrounding text to select one occurrence.`,
      }
    }
    const start = positions[0]
    const end = start + search.length
    let normalizedOffset = 0
    let rawStart = -1
    let rawEnd = body.length
    for (let raw = 0; raw <= body.length; raw++) {
      if (normalizedOffset === start && rawStart === -1) rawStart = raw
      if (normalizedOffset === end) {
        rawEnd = raw
        break
      }
      if (body[raw] === '\r' && body[raw + 1] === '\n') raw++
      normalizedOffset++
    }
    const matched = body.slice(rawStart, rawEnd)
    if (search === edit.replace.replace(/\r\n/g, '\n')) continue
    const lineEnding = matched.match(/\r?\n/)?.[0] ?? body.match(/\r?\n/)?.[0] ?? '\n'
    const replacement = edit.replace.replace(/\r\n/g, '\n').replace(/\n/g, lineEnding)
    text = text.slice(0, rawStart + bomLength) + replacement + text.slice(rawEnd + bomLength)
  }
  return { success: true, content: text }
}
