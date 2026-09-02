import type { SandboxProvider } from '@shared/sandbox-provider'
import { TASK_SANDBOX_EXTRA_WRITE_PATHS } from '@shared/task-sandbox'
import {
  isWindowsAbsolutePath,
  isWindowsFilesystemRoot,
  isWindowsPathInside,
  normalizeWindowsAbsolutePath,
} from '@shared/utils/windows-path'
import { jsonSchema, type ToolSet } from 'ai'
import { trackAgentModeFullAccessBypass } from '@/analytics/agent-mode'
import { requestFileMutationApproval } from '@/packages/user-exec-approval'
import platform from '@/platform'
import { buildEditStats, buildWriteStats } from './file-mutation-stats'
import { asRecord, contentOrErrorText, numberField, stringField, toTextModelOutput } from './model-output'
import { remapPhantomHomePathForProvider } from './sandbox-paths'
import { editSoulVirtualFile, isSoulVirtualPath, writeSoulVirtualFile } from './soul-file'

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

const editFileInputSchema = jsonSchema({
  type: 'object',
  description:
    'Provide either edits for one or more replacements, or legacy old_text and new_text for a single replacement.',
  properties: {
    file_path: {
      type: 'string',
      description: 'File path to edit',
    },
    old_text: {
      type: 'string',
      description: 'Legacy single edit: exact text to replace; must be unique',
    },
    new_text: {
      type: 'string',
      description: 'Legacy single edit: replacement text',
    },
    edits: {
      type: 'array',
      minItems: 1,
      description: 'Multiple exact search-and-replace edits to apply atomically in order',
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
  required: ['file_path'],
  additionalProperties: false,
})

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
  if (error) return `Error: ${error}`
  const filePath = stringField(record, 'file_path')
  const edits = numberField(record, 'edits')
  if (filePath && edits !== undefined) {
    return `Status: success\nAction: edit_file\nPath: ${filePath}\nEdits applied: ${edits}`
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
  if (input.edits?.length) return { edits: input.edits }
  if (input.old_text !== undefined && input.new_text !== undefined) return { edits: normalizeEdits(input) }
  return { error: 'Provide edits[] or both old_text and new_text.' }
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

async function writeSandboxFile(context: FilesystemContext, filePath: string, content: string) {
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
  return result.exitCode === 0 ? { success: true } : { success: false, error: result.stderr || result.stdout }
}

async function editSandboxFile(context: FilesystemContext, filePath: string, edits: EditOperation[]) {
  const setup = await ensureSandbox(context)
  if (!setup.success) return setup
  if (!context.provider) return { success: false, error: 'Sandbox is not available' }
  const result = await context.provider.exec({
    language: 'node',
    code: `
const fs = require('fs')
const filePath = ${JSON.stringify(filePath)}
const edits = ${JSON.stringify(edits)}
let text = fs.readFileSync(filePath, 'utf8')
for (let i = 0; i < edits.length; i++) {
  const { old_text, new_text } = edits[i]
  const first = text.indexOf(old_text)
  if (first === -1) {
    console.error('Edit ' + (i + 1) + ': search text not found')
    process.exit(1)
  }
  if (text.indexOf(old_text, first + old_text.length) !== -1) {
    console.error('Edit ' + (i + 1) + ': search text is not unique')
    process.exit(1)
  }
  text = text.slice(0, first) + new_text + text.slice(first + old_text.length)
}
fs.writeFileSync(filePath, text, 'utf8')
`,
    timeout: 10_000,
  })
  return result.exitCode === 0 ? { success: true } : { success: false, error: result.stderr || result.stdout }
}

export function buildFilesystemTools(context: FilesystemContext): { tools: ToolSet; description: string } {
  // create_download only exists when the session has a sandbox provider (code execution
  // enabled), so only reference it in tool contracts when it is actually callable.
  const hasCreateDownload = Boolean(context.provider)

  const list_files: ToolSet[string] = {
    description:
      'List files in a directory. Relative paths are resolved in the session sandbox. Absolute paths read the user filesystem.',
    inputSchema: jsonSchema({
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
      'Search file contents. Relative paths search the session sandbox; absolute paths search the user filesystem. ' +
      'By default the query is matched literally; set regex=true to use the bounded ripgrep/Rust regex syntax ' +
      '(look-around and backreferences are not supported). ' +
      'Heavy directories (node_modules, .git, build output) are skipped and results are capped for speed.',
    inputSchema: jsonSchema({
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
    description:
      'Write a file. Relative sandbox paths are written directly. Writing absolute user filesystem paths requires user approval unless Full Access is enabled.' +
      (hasCreateDownload
        ? ' Writing a sandbox file does NOT deliver it to the user — call create_download for that.'
        : ''),
    inputSchema: jsonSchema({
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
      'Edit a file with one or more exact search-and-replace edits. Prefer edits[] for multiple changes in one call. Each old_text must be unique at the time it is applied. Relative sandbox paths are edited directly. Editing absolute user filesystem paths requires user approval unless Full Access is enabled.',
    inputSchema: editFileInputSchema,
    execute: async (input, toolOptions) => {
      const editInput = input as EditFileInput
      const validatedForSoul = isSoulVirtualPath(editInput.file_path) ? validateEditInput(editInput) : null
      if (validatedForSoul) {
        return 'error' in validatedForSoul
          ? { error: validatedForSoul.error }
          : editSoulVirtualFile(validatedForSoul.edits)
      }
      editInput.file_path = await remapPhantomHomePathForProvider(editInput.file_path, context.provider)
      editInput.file_path = normalizeToolPathForPlatform(editInput.file_path)
      const alreadyApproved = (toolOptions as typeof toolOptions & { approved?: boolean }).approved
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
          })
          return result.success
            ? { success: true, file_path: editInput.file_path, edits: edits.length }
            : { error: result.error }
        }
        const result = await editSandboxFile(context, editInput.file_path, edits)
        return result.success
          ? { success: true, file_path: editInput.file_path, edits: edits.length }
          : { error: result.error }
      }
      const pathError = requireAbsoluteRealPath(editInput.file_path)
      if (pathError) return pathError
      if (!platform.fsEdit) return { error: 'Filesystem access is not available on this platform' }
      const fullAccessBypassedApproval = !alreadyApproved && context.fullAccess === true
      let approved = Boolean(alreadyApproved || context.fullAccess)
      if (!approved) {
        const editStats = buildEditStats(edits)
        approved = await requestFileMutationApproval(
          toolOptions.toolCallId,
          `Edit file: ${editInput.file_path}`,
          '',
          editStats
        )
      }
      if (!approved) return { success: false, error: 'File edit denied by user.' }
      if (fullAccessBypassedApproval) {
        trackAgentModeFullAccessBypass({ tool: 'edit_file' })
      }
      const result = await platform.fsEdit({
        filePath: editInput.file_path,
        edits: edits.map((edit) => ({ search: edit.old_text, replace: edit.new_text })),
      })
      return result.success
        ? { success: true, file_path: editInput.file_path, edits: edits.length }
        : { error: result.error }
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
Use these tools (write_file / edit_file / list_files / search_files) as the primary way to create and modify files — prefer them over writing files through code_execution.
- Relative paths are resolved in the session sandbox working directory and can be written or edited without confirmation. Prefer relative paths.
- Do NOT use phantom home paths like /home/user or /root — they do not exist. Use relative paths instead.
- Absolute paths access the user's real filesystem. Read/list/search only when the user provided or clearly requested the path.
- Writing or editing an absolute user filesystem path requires user approval unless it is inside a bound working directory or Full Access is enabled. Do not attempt destructive operations; file deletion is not available.
- Keep tool results small. For large generated outputs, write a file and return a path plus a short summary.${
      hasCreateDownload
        ? '\n- Writing a sandbox file does NOT give the user access to it. To deliver a file, call create_download after writing it. NEVER present sandbox paths (sandbox:, /mnt/data/, or raw file paths) as download links in your reply — they are not clickable.'
        : ''
    }
`,
  }
}
