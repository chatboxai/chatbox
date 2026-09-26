import { compactFileEditSummary, summarizeFileEdit } from '@shared/file-edit-summary'
import {
  applyTextEdits,
  FILE_EDIT_ERROR_MESSAGES,
  type FileEditResult,
  fileEditError,
  MAX_EDIT_FILE_BYTES,
  type TextEdit,
} from '@shared/file-edits'
import type { SandboxProvider } from '@shared/sandbox-provider'
import { TASK_SANDBOX_EXTRA_WRITE_PATHS } from '@shared/task-sandbox'
import { isUploadedFilePath } from '@shared/uploaded-file-tools'
import {
  isWindowsAbsolutePath,
  isWindowsFilesystemRoot,
  isWindowsPathInside,
  normalizeWindowsAbsolutePath,
} from '@shared/utils/windows-path'
import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ToolSet } from 'ai'
import { trackAgentModeFullAccessBypass } from '@/analytics/agent-mode'
import { getLogger } from '@/lib/utils'
import { requestFileMutationApproval } from '@/packages/user-exec-approval'
import platform from '@/platform'
import { buildEditStats, buildWriteStats } from './file-mutation-stats'
import { asRecord, contentOrErrorText, numberField, stringField, toTextModelOutput } from './model-output'
import { remapPhantomHomePathForProvider } from './sandbox-paths'
import { editSoulVirtualFile, isSoulVirtualPath, writeSoulVirtualFile } from './soul-file'

const log = getLogger('toolset:filesystem')

interface FilesystemContext {
  sessionId?: string
  provider?: SandboxProvider
  // Real directories the user granted the sandbox (working-directory feature). Paths under
  // these are routed through the sandbox and written without approval, like /tmp.
  userWorkingDirectories?: string[]
  fullAccess?: boolean
}

interface EditOperation {
  old_text: string
  new_text: string
}

interface EditFileInput {
  file_path: string
  old_text?: string
  new_text?: string
  edits?: EditOperation[]
}

const editFileInputSchema = validatedToolSchema(
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'File path to edit',
      },
      edits: {
        type: 'array',
        minItems: 1,
        description: 'Exact search-and-replace edits, applied atomically in order',
        items: {
          type: 'object',
          properties: {
            old_text: {
              type: 'string',
              description: 'Exact text to replace; must be unique within the current file content',
            },
            new_text: {
              type: 'string',
              description: 'Replacement text',
            },
          },
          required: ['old_text', 'new_text'],
          additionalProperties: false,
        },
      },
    },
    required: ['file_path', 'edits'],
    additionalProperties: false,
  },
  { normalize: normalizeEditArguments }
)

function normalizeEditArguments(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const input = value as Record<string, unknown>
  if (input.edits !== undefined || typeof input.old_text !== 'string' || typeof input.new_text !== 'string')
    return value
  const { old_text, new_text, ...rest } = input
  return { ...rest, edits: [{ old_text, new_text }] }
}

function formatWriteFileOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return `Error: ${error}`
  const filePath = stringField(record, 'file_path')
  return filePath ? `Status: success\nAction: write_file\nPath: ${filePath}` : contentOrErrorText(output)
}

function formatEditFileOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error)
    return `Error: ${error}${stringField(record, 'errorCode') ? `\nReason: ${stringField(record, 'errorCode')}` : ''}${Array.isArray(record?.candidateLines) && record.candidateLines.length ? `\nCandidate lines: ${record.candidateLines.join(', ')}` : ''}`
  const filePath = stringField(record, 'file_path')
  const edits = numberField(record, 'edits')
  if (filePath && edits !== undefined) {
    return `Status: ${record?.changed === false ? 'no_op' : 'success'}\nAction: edit_file\nPath: ${filePath}\nEdits applied: ${record?.changed === false ? 0 : edits}${stringField(record, 'diff') ? `\n\n${stringField(record, 'diff')}` : ''}${record?.diffTruncated ? '\nDiff preview is incomplete. Read the changed file to inspect further.' : ''}`
  }
  return contentOrErrorText(output)
}

export function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || isWindowsAbsolutePath(filePath)
}

function normalizeEdits(input: EditFileInput): EditOperation[] {
  if (input.edits?.length) return input.edits
  return [{ old_text: input.old_text ?? '', new_text: input.new_text ?? '' }]
}

function validateEditInput(input: EditFileInput): { edits: EditOperation[] } | { error: string } {
  const edits = input.edits?.length
    ? input.edits
    : input.old_text !== undefined && input.new_text !== undefined
      ? normalizeEdits(input)
      : null
  if (!edits) return { error: 'Provide edits[] or both old_text and new_text.' }
  if (
    !Array.isArray(edits) ||
    edits.some(
      (edit) =>
        !edit || typeof edit.old_text !== 'string' || edit.old_text.length === 0 || typeof edit.new_text !== 'string'
    )
  ) {
    return { error: 'Each edit requires a non-empty old_text and a string new_text.' }
  }
  return { edits }
}

function ensureSandbox(context: FilesystemContext): Promise<{ success: boolean; error?: string }> {
  if (!context.provider || !context.sessionId) {
    return Promise.resolve({ success: false, error: 'Sandbox is not available' })
  }
  return context.provider.init(context.sessionId)
}

async function getSandboxRoot(context: FilesystemContext): Promise<string | null> {
  if (!context.provider) return null
  const status = await context.provider.getStatus().catch(() => null)
  return status?.workingDirectory ?? null
}

function isInsideRoot(root: string, filePath: string): boolean {
  if (isWindowsRenderer() && isWindowsAbsolutePath(root) && isWindowsAbsolutePath(filePath)) {
    return isWindowsPathInside(root, filePath)
  }
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`
  return filePath === root || filePath.startsWith(normalizedRoot)
}

function requireAbsoluteRealPath(filePath: string) {
  return isAbsolutePath(filePath) ? null : { error: 'Relative paths require an active session sandbox' }
}

// Lexically collapse '.'/'..' segments the same way the main process does (path.resolve)
// before writing, so the exemption is decided on the actual write target. Without this,
// a crafted path like `/tmp/../Users/alice/.zshrc` would textually pass the /tmp prefix
// check while resolving to a file outside the exempt root.
function normalizeAbsolutePosixPath(filePath: string): string {
  const out: string[] = []
  for (const segment of filePath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return `/${out.join('/')}`
}

// Mirrors getOS() === 'Windows' without pulling navigator.ts (and its Sentry dep) into
// this hot path. Read at call time so tests can stub navigator.
function isWindowsRenderer(): boolean {
  return typeof navigator !== 'undefined' && (navigator.userAgent ?? '').includes('Windows')
}

export function normalizeToolPathForPlatform(filePath: string): string {
  if (!isWindowsRenderer()) return filePath
  return normalizeWindowsAbsolutePath(filePath) ?? filePath
}

// Absolute paths under these roots (e.g. /tmp) are writable by the sandbox runtime, so
// writes/edits are routed through the sandbox (see shouldUseSandbox) rather than the real
// filesystem — that way the sandbox's own confinement/symlink checks apply and no user
// approval is needed. Kept in sync with TASK_SANDBOX_EXTRA_WRITE_PATHS as the single
// source of truth. The roots are POSIX-only and are NOT sandbox-writable on Windows
// (getSandboxExtraWriteRoots() returns [] there, and path.resolve('/tmp/x') maps to
// C:\tmp\x), so this is disabled on Windows. The candidate is normalized first so '..'
// traversal can't make an out-of-root path match.
function isSandboxWritableTempPath(filePath: string): boolean {
  if (isWindowsRenderer()) return false
  if (!filePath.startsWith('/')) return false
  const normalized = normalizeAbsolutePosixPath(filePath)
  return TASK_SANDBOX_EXTRA_WRITE_PATHS.some((root) => isInsideRoot(root, normalized))
}

// Absolute paths under a user-granted working directory are routed through the sandbox
// (no approval), like /tmp. The directory is in the sandbox's allowWrite set, so writes
// succeed under confinement. Normalized first so '..' traversal can't spoof a match.
function isInsideWorkingDirectories(directories: readonly string[] | undefined, filePath: string): boolean {
  if (!directories?.length) return false
  if (isWindowsRenderer()) {
    const normalized = normalizeWindowsAbsolutePath(filePath)
    if (!normalized) return false
    return directories.some((dir) => {
      const normalizedDir = normalizeWindowsAbsolutePath(dir)
      if (!normalizedDir || isWindowsFilesystemRoot(normalizedDir)) return false
      return isWindowsPathInside(normalizedDir, normalized)
    })
  }
  if (!filePath.startsWith('/')) return false
  const normalized = normalizeAbsolutePosixPath(filePath)
  return directories.some((dir) => {
    const normDir = normalizeAbsolutePosixPath(dir)
    // Never treat the whole filesystem as a granted dir — isInsideRoot('/', x) is always
    // true, which would route every absolute path through the sandbox and skip approval.
    if (normDir === '/' || normDir === '') return false
    return isInsideRoot(normDir, normalized)
  })
}

function isInsideUserWorkingDir(context: FilesystemContext, filePath: string): boolean {
  return isInsideWorkingDirectories(context.userWorkingDirectories, filePath)
}

async function isAcceptedUserWorkingDir(context: FilesystemContext, filePath: string): Promise<boolean> {
  if (!isInsideUserWorkingDir(context, filePath)) return false
  const setup = await ensureSandbox(context)
  if (!setup.success) return false
  const acceptedDirectories = context.provider?.getAcceptedExtraWritableDirs?.()
  return acceptedDirectories === undefined || isInsideWorkingDirectories(acceptedDirectories, filePath)
}

async function shouldUseSandbox(context: FilesystemContext, filePath: string): Promise<boolean> {
  if (!context.provider) return false
  if (!isAbsolutePath(filePath)) return true
  // /tmp and other sandbox-writable temp roots are handled by the sandbox itself.
  if (isSandboxWritableTempPath(filePath)) return true
  // User-granted working directories behave like /tmp: sandbox-routed, no approval.
  if (isInsideUserWorkingDir(context, filePath)) return true
  const root = await getSandboxRoot(context)
  return root ? isInsideRoot(root, filePath) : false
}

// Node-script mutations share a session queue because their paths can be aliases.
// Native host file operations coordinate separately in the main process.
const sandboxMutations = new Map<string, Promise<void>>()
async function withSandboxMutation<T>(context: FilesystemContext, action: () => Promise<T>): Promise<T> {
  const key = context.sessionId ?? ''
  const previous = sandboxMutations.get(key) ?? Promise.resolve()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  sandboxMutations.set(key, tail)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (sandboxMutations.get(key) === tail) sandboxMutations.delete(key)
  }
}

function writeSandboxFile(context: FilesystemContext, filePath: string, content: string) {
  return withSandboxMutation(context, async () => {
    const setup = await ensureSandbox(context)
    if (!setup.success) return setup
    if (!context.provider) return { success: false, error: 'Sandbox is not available' }
    // Write via a node script with the content safely embedded through JSON.stringify (same pattern
    // as editSandboxFile). The script is fed to node over stdin, so there is no shell escaping and no
    // base64 round-trip, and the write still runs inside the sandbox (subject to allowWrite rules).
    const result = await context.provider.exec({
      language: 'node',
      code: `
const fs = require('fs')
const path = require('path')
const filePath = ${JSON.stringify(filePath)}
const content = ${JSON.stringify(content)}
fs.mkdirSync(path.dirname(filePath), { recursive: true })
fs.writeFileSync(filePath, content)
`,
      timeout: 10_000,
    })
    if (result.exitCode === 0) return { success: true }
    log.warn('Sandbox write failed', { exitCode: result.exitCode, stderr: result.stderr.slice(0, 2000) })
    return fileEditError('RESULT_UNCONFIRMED')
  })
}

export const SANDBOX_EDIT_RESULT_PREFIX = 'CHATBOX_EDIT_RESULT:'

function editSandboxFile(
  context: FilesystemContext,
  filePath: string,
  edits: EditOperation[],
  expectedVersion?: string
): Promise<FileEditResult> {
  return withSandboxMutation(context, async () => {
    const setup = await ensureSandbox(context)
    if (!setup.success || !context.provider) return fileEditError('SANDBOX_UNAVAILABLE')
    const result = await context.provider.exec({
      language: 'node',
      code: `
const fs = require('fs')
const filePath = ${JSON.stringify(filePath)}
const maxBytes = ${MAX_EDIT_FILE_BYTES}
const errors = ${JSON.stringify(FILE_EDIT_ERROR_MESSAGES)}
const resultPrefix = ${JSON.stringify(SANDBOX_EDIT_RESULT_PREFIX)}
function emit(json) { process.stdout.write('\\n' + resultPrefix + json + '\\n') }
function readBounded() {
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) throw {errorCode:'NOT_REGULAR_FILE'}
    if (stat.size > maxBytes) throw {errorCode:'FILE_TOO_LARGE'}
    // The descriptor remains authoritative if the file grows after fstat.
    const buffer = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    if (length > maxBytes) throw {errorCode:'FILE_TOO_LARGE'}
    return buffer.toString('utf8', 0, length)
  } finally { fs.closeSync(fd) }
}
let phase = 'READ_FAILED'
try {
const before = readBounded()
const apply = (${applyTextEdits.toString()})
const edits = ${JSON.stringify(edits.map((edit) => ({ search: edit.old_text, replace: edit.new_text })))}
const expectedVersion = ${JSON.stringify(expectedVersion ?? null)}
const stale = expectedVersion && require('crypto').createHash('sha256').update(before).digest('hex') !== expectedVersion
const result = stale ? {success:false,errorCode:'STALE_CONTENT',error:errors.STALE_CONTENT} : apply(before, edits)
if (!result.success) {
  emit(JSON.stringify(result))
} else {
  if (readBounded() !== before) {
    emit(JSON.stringify({success:false,errorCode:'STALE_CONTENT',error:errors.STALE_CONTENT}))
  } else {
    const changed = result.content !== before
    phase = 'WRITE_FAILED'
    if (changed) fs.writeFileSync(filePath, result.content, 'utf8')
    const output = JSON.stringify({success:true,changed,edits:edits.length,before,after:result.content})
    emit(Buffer.byteLength(output, 'utf8') + Buffer.byteLength(resultPrefix, 'utf8') + 2 <= 12000 ? output : JSON.stringify({success:true,changed,edits:edits.length,diffTruncated:changed}))
  }
}
} catch (error) {
  const errorCode = error && errors[error.errorCode] ? error.errorCode : phase === 'READ_FAILED' && error && error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : phase
  emit(JSON.stringify({success:false,errorCode,error:errors[errorCode]}))
}
`,
      timeout: 10_000,
    })
    if (result.exitCode !== 0) {
      log.warn('Sandbox edit failed', { exitCode: result.exitCode, stderr: result.stderr.slice(0, 2000) })
      return fileEditError('RESULT_UNCONFIRMED')
    }
    try {
      const line = result.stdout
        .split('\n')
        .reverse()
        .find((line) => line.startsWith(SANDBOX_EDIT_RESULT_PREFIX))
      if (!line) throw new Error('Missing sandbox edit result')
      const output: unknown = JSON.parse(line.slice(SANDBOX_EDIT_RESULT_PREFIX.length))
      const record = asRecord(output)
      if (record?.success === false && typeof record.error === 'string') return record as unknown as FileEditResult
      if (record?.success !== true || typeof record.changed !== 'boolean')
        throw new Error('Invalid sandbox edit result')
      if (typeof record.before === 'string' && typeof record.after === 'string')
        return summarizeFileEdit(record.before, record.after, edits.length)
      return { success: true, changed: record.changed, edits: edits.length, diffTruncated: record.changed }
    } catch {
      log.warn('Sandbox edit result could not be decoded', {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 2000),
      })
      return fileEditError('RESULT_UNCONFIRMED')
    }
  })
}

function editToolResult(result: FileEditResult, filePath: string) {
  if (!result.success) return result
  const { version: _version, ...summary } = result
  return { ...compactFileEditSummary(summary), file_path: filePath }
}

export function buildFilesystemTools(context: FilesystemContext): { tools: ToolSet; description: string } {
  // A sandbox provider backs both relative paths and create_download, so only describe
  // them when the session has one.
  const hasSandbox = Boolean(context.provider)

  const list_files: ToolSet[string] = {
    description: 'List files in a directory.',
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list',
        },
      },
      required: ['path'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const listInput = input as { path: string }
      if (isUploadedFilePath(listInput.path))
        return {
          error:
            'This virtual path requires the uploaded-file read_file tool. Use a filesystem path for this operation.',
        }
      listInput.path = await remapPhantomHomePathForProvider(listInput.path, context.provider)
      listInput.path = normalizeToolPathForPlatform(listInput.path)
      const useSandbox = await shouldUseSandbox(context, listInput.path)
      // Windows bound/temporary absolute paths are real host paths. Use the native file
      // operation instead of sending a Windows path through Git Bash or WSL path parsing.
      if (useSandbox && isWindowsRenderer() && isWindowsAbsolutePath(listInput.path)) {
        if (!platform.fsList) return { error: 'Filesystem access is not available on this platform' }
        const result = await platform.fsList({ dirPath: listInput.path })
        return result.success ? { content: result.content ?? '' } : { error: result.error }
      }
      if (useSandbox) {
        const setup = await ensureSandbox(context)
        if (!setup.success) return { error: setup.error }
        if (!context.provider) return { error: 'Sandbox is not available' }
        const result = await context.provider.listFiles(listInput.path)
        return result.success
          ? { content: result.content ?? '' }
          : { error: result.error, ...(result.errorCode ? { errorCode: result.errorCode } : {}) }
      }
      const pathError = requireAbsoluteRealPath(listInput.path)
      if (pathError) return pathError
      if (!platform.fsList) return { error: 'Filesystem access is not available on this platform' }
      const result = await platform.fsList({ dirPath: listInput.path })
      return result.success ? { content: result.content ?? '' } : { error: result.error }
    },
    toModelOutput: toTextModelOutput(contentOrErrorText, { emptyFallback: 'Directory is empty.' }),
  }

  const search_files: ToolSet[string] = {
    description:
      'Search file contents. The query is literal unless regex=true. ' +
      'Heavy directories (node_modules, .git, build output) are skipped and results are capped.',
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to search',
        },
        query: {
          type: 'string',
          description: 'Text or pattern to search for',
        },
        regex: {
          type: 'boolean',
          description:
            'Treat query as a ripgrep/Rust regular expression instead of literal text. Defaults to false; look-around and backreferences are unsupported.',
        },
        include: {
          type: 'string',
          description: 'Optional file name filter, for example "*.ts"',
        },
      },
      required: ['path', 'query'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const searchInput = input as { path: string; query: string; regex?: boolean; include?: string }
      if (isUploadedFilePath(searchInput.path))
        return {
          error:
            'This virtual path requires the uploaded-file read_file tool. Use a filesystem path for this operation.',
        }
      searchInput.path = await remapPhantomHomePathForProvider(searchInput.path, context.provider)
      searchInput.path = normalizeToolPathForPlatform(searchInput.path)
      if (await shouldUseSandbox(context, searchInput.path)) {
        const setup = await ensureSandbox(context)
        if (!setup.success) return { error: setup.error }
        if (!context.provider) return { error: 'Sandbox is not available' }
        const result = await context.provider.search({
          path: searchInput.path,
          pattern: searchInput.query,
          regex: searchInput.regex,
          include: searchInput.include,
        })
        return result.success
          ? { content: result.content ?? '' }
          : { error: result.error, ...(result.errorCode ? { errorCode: result.errorCode } : {}) }
      }
      const pathError = requireAbsoluteRealPath(searchInput.path)
      if (pathError) return pathError
      if (!platform.fsSearch) return { error: 'Filesystem access is not available on this platform' }
      const result = await platform.fsSearch({
        dirPath: searchInput.path,
        pattern: searchInput.query,
        regex: searchInput.regex,
        include: searchInput.include,
      })
      return result.success ? { content: result.content ?? '' } : { error: result.error }
    },
    toModelOutput: toTextModelOutput(contentOrErrorText, { emptyFallback: 'No matches found.' }),
  }

  const write_file: ToolSet[string] = {
    description: 'Write a file with the full content.',
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'File path to write',
        },
        content: {
          type: 'string',
          description: 'Full file content',
        },
      },
      required: ['file_path', 'content'],
      additionalProperties: false,
    }),
    execute: async (input, toolOptions) => {
      const writeInput = input as { file_path: string; content: string }
      if (isUploadedFilePath(writeInput.file_path))
        return { error: 'Uploaded files are read-only. Write a copy to a filesystem path.' }
      if (isSoulVirtualPath(writeInput.file_path)) {
        return writeSoulVirtualFile(writeInput.content)
      }
      writeInput.file_path = await remapPhantomHomePathForProvider(writeInput.file_path, context.provider)
      writeInput.file_path = normalizeToolPathForPlatform(writeInput.file_path)
      const alreadyApproved = (toolOptions as typeof toolOptions & { approved?: boolean }).approved
      const useSandbox = await shouldUseSandbox(context, writeInput.file_path)
      const rejectedUserGrant =
        useSandbox &&
        isInsideUserWorkingDir(context, writeInput.file_path) &&
        !(await isAcceptedUserWorkingDir(context, writeInput.file_path))
      if (useSandbox && !rejectedUserGrant) {
        if (isWindowsRenderer()) {
          const setup = await ensureSandbox(context)
          if (!setup.success) return { error: setup.error }
          if (!platform.sandboxWrite) return { error: 'Sandbox write is not available on this platform' }
          const result = await platform.sandboxWrite({
            filePath: writeInput.file_path,
            content: writeInput.content,
            sessionId: context.sessionId,
          })
          return result.success ? { success: true, file_path: writeInput.file_path } : { error: result.error }
        }
        const result = await writeSandboxFile(context, writeInput.file_path, writeInput.content)
        return result.success ? { success: true, file_path: writeInput.file_path } : { error: result.error }
      }
      const pathError = requireAbsoluteRealPath(writeInput.file_path)
      if (pathError) return pathError
      if (!platform.fsWrite) return { error: 'Filesystem access is not available on this platform' }
      const fullAccessBypassedApproval = !alreadyApproved && context.fullAccess === true
      let approved = Boolean(alreadyApproved || context.fullAccess)
      if (!approved) {
        const writeStats = buildWriteStats(writeInput.content)
        approved = await requestFileMutationApproval(
          toolOptions.toolCallId,
          `Write file: ${writeInput.file_path}`,
          '',
          writeStats
        )
      }
      if (!approved) return { success: false, error: 'File write denied by user.' }
      // Track when Full Access skipped an approval, regardless of whether the
      // write later succeeds — failed bypassed attempts are the audit signal.
      if (fullAccessBypassedApproval) {
        trackAgentModeFullAccessBypass({ tool: 'write_file' })
      }
      const result = await platform.fsWrite({ filePath: writeInput.file_path, content: writeInput.content })
      return result.success ? { success: true, file_path: writeInput.file_path } : { error: result.error }
    },
    toModelOutput: toTextModelOutput(formatWriteFileOutput),
  }

  const edit_file: ToolSet[string] = {
    description:
      'Edit a file with exact search-and-replace edits. Always pass edits[], even for a single replacement. Each old_text must be unique when it is applied.',
    inputSchema: editFileInputSchema,
    execute: async (input, toolOptions) => {
      const editInput = input as EditFileInput
      if (!editInput || typeof editInput.file_path !== 'string' || !editInput.file_path.trim())
        return { success: false, errorCode: 'INVALID_EDIT', error: 'file_path must be a non-empty string.' }
      if (isUploadedFilePath(editInput.file_path))
        return { error: 'Uploaded files are read-only. Write a copy to a filesystem path.' }
      const validatedForSoul = isSoulVirtualPath(editInput.file_path) ? validateEditInput(editInput) : null
      if (validatedForSoul) {
        return 'error' in validatedForSoul
          ? { error: validatedForSoul.error }
          : editSoulVirtualFile(validatedForSoul.edits)
      }
      editInput.file_path = await remapPhantomHomePathForProvider(editInput.file_path, context.provider)
      editInput.file_path = normalizeToolPathForPlatform(editInput.file_path)
      const approvalContext = toolOptions as typeof toolOptions & { approved?: boolean; approvalFileVersion?: string }
      const alreadyApproved = approvalContext.approved
      const validatedInput = validateEditInput(editInput)
      if ('error' in validatedInput) return { error: validatedInput.error }
      const { edits } = validatedInput
      const useSandbox = await shouldUseSandbox(context, editInput.file_path)
      const rejectedUserGrant =
        useSandbox &&
        isInsideUserWorkingDir(context, editInput.file_path) &&
        !(await isAcceptedUserWorkingDir(context, editInput.file_path))
      if (useSandbox && !rejectedUserGrant) {
        if (isWindowsRenderer()) {
          const setup = await ensureSandbox(context)
          if (!setup.success) return { error: setup.error }
          if (!platform.sandboxEdit) return { error: 'Sandbox edit is not available on this platform' }
          const result = await platform.sandboxEdit({
            filePath: editInput.file_path,
            edits: edits.map((edit) => ({ search: edit.old_text, replace: edit.new_text })),
            sessionId: context.sessionId,
            ...(approvalContext.approvalFileVersion ? { expectedVersion: approvalContext.approvalFileVersion } : {}),
          })
          return editToolResult(result, editInput.file_path)
        }
        const result = await editSandboxFile(context, editInput.file_path, edits, approvalContext.approvalFileVersion)
        return editToolResult(result, editInput.file_path)
      }
      const pathError = requireAbsoluteRealPath(editInput.file_path)
      if (pathError) return pathError
      if (!platform.fsEdit) return { error: 'Filesystem access is not available on this platform' }
      const nativeEdits: TextEdit[] = edits.map((edit) => ({ search: edit.old_text, replace: edit.new_text }))
      const fullAccessBypassedApproval = !alreadyApproved && context.fullAccess === true
      let expectedVersion = approvalContext.approvalFileVersion
      // A persisted approval must carry the exact preview's version. Older
      // approvals get a fresh preview before they can modify a file.
      if (!context.fullAccess && (!alreadyApproved || !expectedVersion)) {
        const preview = await platform.fsEdit({ filePath: editInput.file_path, edits: nativeEdits, dryRun: true })
        if (!preview.success) return fileEditError(preview.errorCode, preview.editIndex)
        if (!preview.changed) return editToolResult(preview, editInput.file_path)
        if (!preview.version) return { error: 'This platform cannot bind an edit approval to the file version.' }
        expectedVersion = preview.version
        const approved = await requestFileMutationApproval(
          toolOptions.toolCallId,
          `Edit file: ${editInput.file_path}`,
          preview.diff ?? '',
          preview.addedLines !== undefined && preview.removedLines !== undefined
            ? { mode: 'edit', edits: edits.length, addedLines: preview.addedLines, removedLines: preview.removedLines }
            : { ...buildEditStats(edits), approximate: true },
          { version: preview.version, diffTruncated: preview.diffTruncated }
        )
        if (!approved) return { success: false, error: 'File edit denied by user.' }
      }
      if (fullAccessBypassedApproval) trackAgentModeFullAccessBypass({ tool: 'edit_file' })
      return editToolResult(
        await platform.fsEdit({
          filePath: editInput.file_path,
          edits: nativeEdits,
          ...(expectedVersion ? { expectedVersion } : {}),
        }),
        editInput.file_path
      )
    },
    toModelOutput: toTextModelOutput(formatEditFileOutput),
  }

  return {
    tools: {
      list_files,
      search_files,
      write_file,
      edit_file,
    },
    description: `
## Filesystem
Use write_file / edit_file / list_files / search_files as the primary way to inspect, create, and modify files.
${
  hasSandbox
    ? '- Relative paths resolve in the session sandbox working directory and can be written or edited without confirmation. Prefer them; phantom home paths such as /home/user or /root do not exist.'
    : '- No session sandbox is available, so these file tools reject relative paths. Use absolute paths.'
}
- Absolute paths access the user's real filesystem. Read, list, or search them only when the user provided or clearly requested the path. Writing or editing them requires user approval unless the path is inside a bound working directory or Full Access is enabled. Do not attempt destructive operations; file deletion is not available.
- Keep tool results small. For large generated outputs, write a file and return a path plus a short summary.${
      hasSandbox
        ? '\n- Writing a file does not deliver it. Call create_download, and never present sandbox paths (sandbox:, /mnt/data/, or raw file paths) as links in your reply.'
        : ''
    }
`,
  }
}
