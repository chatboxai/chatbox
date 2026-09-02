import { isTextFilePath } from '@shared/file-extensions'
import {
  type SandboxSeedAttachment,
  sandboxAttachmentIdentity,
  sandboxAttachmentParsedRelPath,
  sandboxAttachmentRelPath,
} from '@shared/sandbox/attachment-path'
import { DEFAULT_EXEC_TIMEOUT, type SandboxExecLanguage, type SandboxProvider } from '@shared/sandbox-provider'
import { jsonSchema, type ToolSet } from 'ai'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { asRecord, contentOrErrorText, numberField, stringField, toTextModelOutput } from './model-output'
import { remapPhantomHomePath, remapPhantomHomePathForProvider } from './sandbox-paths'
import { isSoulVirtualPath, readSoulVirtualFile } from './soul-file'

const log = getLogger('toolset:code-execution')

const MAX_STDOUT_LENGTH = 50_000

interface CodeExecutionContext {
  sessionId: string
  files: SandboxSeedAttachment[]
  provider: SandboxProvider
}

type SeedCopyTask = { blobKey: string; targetName: string; label: string }
type SeedCopyResult = { name: string; success: boolean; error?: string }

async function seedAttachmentsInBatch(provider: SandboxProvider, copyTasks: SeedCopyTask[]): Promise<SeedCopyResult[]> {
  if (!provider.seedBlobsIn) return seedAttachmentsWithLimitedConcurrency(provider, copyTasks)
  try {
    const seeded = await provider.seedBlobsIn(
      copyTasks.map((task) => ({ blobKey: task.blobKey, targetFilename: task.targetName }))
    )
    const byTarget = new Map(seeded.results.map((result) => [result.targetFilename, result]))
    return copyTasks.map((task) => {
      const result = byTarget.get(task.targetName)
      if (!result) return { name: task.label, success: seeded.success, error: seeded.error }
      return { name: task.label, success: result.success, error: result.error }
    })
  } catch (err) {
    log.error('Failed to seed attachments in batch:', err)
    return copyTasks.map((task) => ({ name: task.label, success: false, error: String(err) }))
  }
}

async function seedAttachmentsWithLimitedConcurrency(
  provider: SandboxProvider,
  copyTasks: SeedCopyTask[]
): Promise<SeedCopyResult[]> {
  const MAX_CONCURRENT = 5
  const copyResults: SeedCopyResult[] = []
  for (let i = 0; i < copyTasks.length; i += MAX_CONCURRENT) {
    const batch = copyTasks.slice(i, i + MAX_CONCURRENT)
    const batchResults = await Promise.all(
      batch.map(async (task) => {
        try {
          const result = await provider.copyBlobIn(task.blobKey, task.targetName)
          return { name: task.label, success: result.success, error: result.error }
        } catch (err) {
          log.error(`Failed to copy file ${task.label} to sandbox:`, err)
          return { name: task.label, success: false, error: String(err) }
        }
      })
    )
    copyResults.push(...batchResults)
  }
  return copyResults
}

function truncateOutput(output: string, maxLength = MAX_STDOUT_LENGTH): string {
  if (output.length <= maxLength) return output
  const half = Math.floor(maxLength / 2)
  return `${output.slice(0, half)}\n\n... [truncated ${output.length - maxLength} characters] ...\n\n${output.slice(-half)}`
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)
}

function isInsideRoot(root: string, filePath: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`
  return filePath === root || filePath.startsWith(normalizedRoot)
}

function formatCodeExecutionOutput(output: unknown): string {
  const record = asRecord(output)
  const stdout = stringField(record, 'stdout') ?? ''
  const stderr = stringField(record, 'stderr') ?? ''
  const errorCode = stringField(record, 'errorCode')
  const exitCode = numberField(record, 'exitCode')
  const sections = [`Exit code: ${exitCode ?? 'unknown'}`]
  if (errorCode) sections.push(`Error code: ${errorCode}`)
  if (stdout) sections.push(`Stdout:\n${stdout}`)
  if (stderr) sections.push(`Stderr:\n${stderr}`)
  if (!stdout && !stderr) sections.push('(no output)')
  return sections.join('\n\n')
}

function formatReadFileOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return contentOrErrorText(output)
  const content = stringField(record, 'content') ?? ''
  const startLine = numberField(record, 'startLine')
  const endLine = numberField(record, 'endLine')
  const hint = stringField(record, 'hint')
  const displayContent =
    content.trim() === '' && startLine !== undefined && endLine !== undefined && endLine >= startLine
      ? '[Selected lines are blank.]'
      : content
  return hint ? `${displayContent}\n\n${hint}` : displayContent
}

function formatDownloadOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return contentOrErrorText(output)
  const displayName = stringField(record, 'display_name')
  const filePath = stringField(record, 'file_path')
  if (displayName && filePath) return `Status: download ready\nName: ${displayName}\nPath: ${filePath}`
  return contentOrErrorText(output)
}

/**
 * Build code execution tools for a session.
 * Returns tool definitions and a system prompt description.
 */
export function buildCodeExecutionTools(context: CodeExecutionContext): {
  tools: ToolSet
  description: string
  ensureSandbox: () => Promise<{ success: boolean; error?: string }>
} {
  const { provider, files } = context
  let sandboxInitialized = false
  let filesSeeded = false
  let initPromise: Promise<{ success: boolean; error?: string }> | null = null

  /**
   * Lazy initialization: init sandbox + copy files on first tool call.
   * Uses a promise lock to prevent concurrent init from parallel tool calls.
   */
  async function ensureSandbox(): Promise<{ success: boolean; error?: string }> {
    if (sandboxInitialized && filesSeeded) {
      return { success: true }
    }

    if (initPromise) return initPromise
    initPromise = doInit()
    try {
      return await initPromise
    } finally {
      initPromise = null
    }
  }

  async function doInit(): Promise<{ success: boolean; error?: string }> {
    if (!sandboxInitialized) {
      const initResult = await provider.init(context.sessionId)
      if (!initResult.success) {
        return { success: false, error: `Sandbox init failed: ${initResult.error}` }
      }
      sandboxInitialized = true
    }

    if (!filesSeeded && files.length > 0) {
      // Re-seed every generation so new uploads appear. Destinations are identity-derived
      // so two uploads that share a filename both land in the sandbox. Already-seeded
      // blobs are skipped without reading or writing the file.
      const copyTasks: Array<{ blobKey: string; targetName: string; label: string }> = []
      for (const file of files) {
        const key = file.rawStorageKey || file.storageKey
        const destRelPath = sandboxAttachmentRelPath(file.name, sandboxAttachmentIdentity(file))
        copyTasks.push({ blobKey: key, targetName: destRelPath, label: file.name })

        // For non-text files (PDF, DOCX, etc.), also copy pre-parsed text next to the original
        if (!isTextFilePath(file.name) && file.rawStorageKey && file.storageKey) {
          const parsedName = sandboxAttachmentParsedRelPath(destRelPath)
          copyTasks.push({ blobKey: file.storageKey, targetName: parsedName, label: `${file.name}_parsed.txt` })
        }
      }

      const copyResults = provider.seedBlobsIn
        ? await seedAttachmentsInBatch(provider, copyTasks)
        : await seedAttachmentsWithLimitedConcurrency(provider, copyTasks)

      const failures = copyResults.filter((r) => !r.success)
      if (failures.length > 0) {
        log.warn(`Some files failed to copy: ${failures.map((f) => f.name).join(', ')}`)
      }

      // Only mark seeded if all files copied successfully, so we can retry on next call
      if (failures.length === 0) {
        filesSeeded = true
      }
    }

    return { success: true }
  }

  const code_execution: ToolSet[string] = {
    description:
      'Run short Node.js, PowerShell (Windows), or Bash code in a sandbox for lightweight file processing, data analysis, ' +
      'calculations, simple HTML/SVG/Canvas chart generation, and file conversion. Prefer Node.js built-ins ' +
      'and shell tools. Avoid installing packages or creating projects unless the user explicitly asks for ' +
      'that and the task cannot be completed with the available runtime. To create or modify files, prefer ' +
      'the write_file/edit_file tools rather than writing through code here. Use relative paths (they resolve ' +
      'to the working directory); do not use /home/user. Generated files can be made downloadable via create_download.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The code to execute',
        },
        language: {
          type: 'string',
          enum: ['node', 'powershell', 'bash'],
          default: 'node',
          description:
            'Execution language. Prefer Node.js for cross-platform processing, PowerShell for native Windows commands, and Bash for POSIX-specific scripts.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in ms (default: 120000)',
        },
      },
      required: ['code'],
      additionalProperties: false,
    }),
    execute: async (input, { abortSignal, toolCallId }) => {
      const codeInput = input as { code: string; language?: SandboxExecLanguage; timeout?: number }
      const setupResult = await ensureSandbox()
      if (!setupResult.success) {
        return { stdout: '', stderr: setupResult.error || 'Sandbox setup failed', exitCode: 1 }
      }

      if (abortSignal?.aborted) {
        return { stdout: '', stderr: '', exitCode: 130, cancelled: true }
      }

      let cancelled = false
      const cancelExecution = () => {
        cancelled = true
        void platform.sandboxKill?.({
          sessionId: context.sessionId,
          ...(toolCallId ? { toolCallId } : {}),
        })
      }
      abortSignal?.addEventListener('abort', cancelExecution, { once: true })
      let result: Awaited<ReturnType<typeof provider.exec>>
      try {
        result = await provider.exec({
          code: codeInput.code,
          language: codeInput.language ?? 'node',
          timeout: codeInput.timeout ?? DEFAULT_EXEC_TIMEOUT,
          ...(toolCallId ? { toolCallId } : {}),
        })
      } finally {
        abortSignal?.removeEventListener('abort', cancelExecution)
      }

      return {
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
        exitCode: cancelled ? 130 : result.exitCode,
        errorCode: result.errorCode,
        ...(cancelled ? { cancelled: true } : {}),
      }
    },
    toModelOutput: toTextModelOutput(formatCodeExecutionOutput),
  }

  const READ_FILE_MAX_LINES = 2000
  const READ_FILE_DEFAULT_LINES = 500

  const read_file: ToolSet[string] = {
    description:
      'Read the content of a file in the sandbox working directory, or an absolute user filesystem path when explicitly provided. ' +
      'For document files (PDF, DOCX, etc.), read the path from <PARSED_SANDBOX_PATH> instead of the binary. ' +
      'Output is truncated to fit context. Use offset to continue reading large files.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to file in the sandbox working directory, or an absolute user filesystem path',
        },
        offset: {
          type: 'integer',
          minimum: 1,
          description: 'Line number to start reading from (1-indexed). Defaults to 1.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: READ_FILE_MAX_LINES,
          description: `Max number of lines to read. Defaults to ${READ_FILE_DEFAULT_LINES}, max ${READ_FILE_MAX_LINES}.`,
        },
      },
      required: ['file_path'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const readInput = input as { file_path: string; offset?: number; limit?: number }
      if (isSoulVirtualPath(readInput.file_path)) {
        return readSoulVirtualFile()
      }
      readInput.file_path = await remapPhantomHomePathForProvider(readInput.file_path, provider)
      if (isAbsolutePath(readInput.file_path)) {
        const status = await provider.getStatus().catch(() => null)
        const sandboxRoot = status?.workingDirectory
        if ((!sandboxRoot || !isInsideRoot(sandboxRoot, readInput.file_path)) && platform.fsRead) {
          const result = await platform.fsRead({
            filePath: readInput.file_path,
            offset: readInput.offset,
            limit: readInput.limit,
          })
          if (!result.success) return { error: result.error || `File not found: ${readInput.file_path}` }
          const hasMore = !!result.endLine && !!result.totalLines && result.endLine < result.totalLines
          return {
            file_path: readInput.file_path,
            content: truncateOutput(result.content ?? '', MAX_STDOUT_LENGTH),
            startLine: result.startLine,
            endLine: result.endLine,
            totalLines: result.totalLines,
            ...(hasMore
              ? {
                  hint: `[Showing lines ${result.startLine}-${result.endLine} of ${result.totalLines}. Use offset=${(result.endLine ?? 0) + 1} to continue.]`,
                }
              : {}),
          }
        }
      }

      const setupResult = await ensureSandbox()
      if (!setupResult.success) {
        return { error: setupResult.error || 'Sandbox setup failed' }
      }

      const startLine = readInput.offset ?? 1
      const limit = readInput.limit ?? READ_FILE_DEFAULT_LINES
      // Coerce to safe integers
      const safeStart = Math.max(1, Math.floor(Number(startLine)))
      const safeLimit = Math.max(1, Math.floor(Number(limit)))

      const result = await provider.readFileOut(readInput.file_path, { offset: safeStart, limit: safeLimit })
      if (!result.success) {
        return {
          error: result.error || `File not found: ${readInput.file_path}`,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        }
      }

      const content = result.content ?? ''
      const totalLines = result.totalLines ?? 0
      const endLine = result.endLine ?? 0
      if (totalLines === 0) {
        return { file_path: readInput.file_path, content: '', totalLines: 0 }
      }
      const hasMore = endLine < totalLines

      return {
        file_path: readInput.file_path,
        content: truncateOutput(content, MAX_STDOUT_LENGTH),
        startLine: result.startLine ?? safeStart,
        endLine,
        totalLines,
        ...(hasMore
          ? { hint: `[Showing lines ${safeStart}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue.]` }
          : {}),
      }
    },
    toModelOutput: toTextModelOutput(formatReadFileOutput, { emptyFallback: 'File is empty.' }),
  }

  const create_download: ToolSet[string] = {
    description:
      'Persist a sandbox-generated file to durable storage and mark it downloadable. The app renders a ' +
      'download card in the chat. This is the ONLY way to deliver a file to the user — writing a file alone ' +
      'does not make it accessible. Use after creating a file by any means (write_file, edit_file, or ' +
      'code_execution). The file must be inside the sandbox — the working directory (relative paths), or on ' +
      'macOS/Linux a sandbox-writable temp dir such as /tmp. If the file cannot be persisted, this returns an ' +
      'error instead of a download; write the file inside the sandbox and try again. Never present sandbox ' +
      'paths as download links in your reply text.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description:
            'Path to the file the sandbox generated, in the working directory (relative paths preferred) or a ' +
            'sandbox-writable temp dir such as /tmp on macOS/Linux',
        },
        display_name: {
          type: 'string',
          description: 'Display name for the download button',
        },
      },
      required: ['file_path', 'display_name'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const downloadInput = input as { file_path: string; display_name: string }
      // Downloads must originate inside the sandbox, so phantom-home paths always map
      // there even when the host's real home happens to be /home/user.
      downloadInput.file_path = remapPhantomHomePath(downloadInput.file_path)

      const setupResult = await ensureSandbox()
      if (!setupResult.success) {
        return { error: setupResult.error || 'Sandbox setup failed' }
      }

      if (provider.type === 'local') {
        const persisted = await provider
          .persistArtifact(downloadInput.file_path, downloadInput.display_name)
          .catch((error) => ({
            success: false as const,
            error: error instanceof Error ? error.message : String(error),
          }))
        if (!persisted.success || !persisted.artifactPath) {
          return {
            error:
              persisted.error ||
              'Failed to prepare file for download. Make sure the file was written inside the sandbox working directory.',
          }
        }
        return {
          downloadable: true,
          file_path: persisted.artifactPath,
          display_name: downloadInput.display_name,
          provider_type: provider.type,
        }
      }

      // Verify the file exists and resolve to absolute path (so download survives app restart)
      const checkResult = await provider.exec({
        code: `
const fs = require('fs')
const filePath = ${JSON.stringify(downloadInput.file_path)}
if (!fs.statSync(filePath).isFile()) throw new Error('not_found')
process.stdout.write(fs.realpathSync(filePath))
`,
        language: 'node',
        timeout: 5000,
      })
      const resolved = checkResult.stdout.trim()
      if (checkResult.exitCode !== 0 || !resolved) {
        return { error: `File not found: ${downloadInput.file_path}` }
      }

      // Persist the file to durable storage so it stays downloadable even after the
      // transient sandbox temp dir is evicted/cleaned.
      let downloadPath = resolved
      const persisted = await provider
        .persistArtifact(resolved, downloadInput.display_name)
        .catch((error) => ({ success: false as const, error: error instanceof Error ? error.message : String(error) }))
      if (persisted.success && persisted.artifactPath) {
        downloadPath = persisted.artifactPath
      }
      // Cloud/unsupported providers: fall back to the resolved sandbox path.

      return {
        downloadable: true,
        file_path: downloadPath,
        display_name: downloadInput.display_name,
        provider_type: provider.type,
      }
    },
    toModelOutput: toTextModelOutput(formatDownloadOutput),
  }

  const description = `
## Code Execution
You have access to a sandboxed environment for lightweight code execution and file processing. Use it primarily for concrete tasks such as calculating spreadsheet data, cleaning CSV/JSON files, extracting document information, creating simple charts, converting files, and producing downloadable outputs.
Uploaded files are described in <ATTACHMENT_FILE> tags. In sandbox mode, those tags include <SANDBOX_PATH> for the original file and, when available, <PARSED_SANDBOX_PATH> for extracted document text.

### Available Runtime
- Bash
- Node.js
- PowerShell (Windows only; PowerShell 7 preferred, Windows PowerShell fallback)

Use the preinstalled runtime first:
- CSV/TSV/JSON/table calculations: use Node.js built-ins such as fs, path, stream, readline, URL, TextDecoder, Intl, crypto, zlib, and child_process when needed.
- XLSX, DOCX, PPTX, PDF, and image files: prefer <PARSED_SANDBOX_PATH> for extracted text. If direct binary manipulation requires unavailable libraries, explain the limitation or produce a text/CSV/HTML alternative.
- Charts and visual outputs: generate standalone HTML with inline SVG or Canvas. Keep JavaScript, CSS, and small data inline in the HTML instead of referencing sibling .js/.css/data files. Save the HTML file, then call create_download when the user needs the result. Do not rely on Python plotting libraries.
- File outputs: prefer CSV, JSON, Markdown, HTML, or other text-based formats that can be generated with Node.js, PowerShell, or Bash.
- Python is not available in this code_execution tool; choose Node.js, PowerShell on Windows, or Bash.

### Package Installation
Avoid installing packages. Most simple file-processing tasks should be completed with Node.js built-ins and shell tools.
If a package install seems necessary:
- First try an approach using the preinstalled runtime.
- Do not use sudo, apt, brew, or other system package managers.
- Be aware that network access, package indexes, npm scripts, native builds, or compiler toolchains may be unavailable, slow, or blocked in the sandbox.
- Installed packages, if any, are session-local and may be lost after the session.
- Explain the limitation to the user instead of spending tool calls on setup when the task is simple.

### read_file
Read file content from the sandbox with line-based pagination.
- Use \`offset\` (1-indexed line number) and \`limit\` (number of lines) to read large files in chunks.
- **Text files** (code, markdown, CSV, etc.): read the path in <SANDBOX_PATH> directly.
- **Document files** (PDF, DOCX, XLSX, PPTX, etc.): when <PARSED_SANDBOX_PATH> is present, read that file to get extracted text. The original binary at <SANDBOX_PATH> is also present if you need to process it with code_execution.
- Absolute paths outside the sandbox may read user filesystem files when the user provided or clearly requested that path. Use write_file/edit_file for modifications so the user can approve real filesystem changes.

### code_execution
Execute focused Node.js, PowerShell, or Bash snippets. Keep scripts small and task-oriented:
- Use Node.js for most file-processing tasks.
- On Windows, prefer PowerShell for terminal commands and native filesystem operations. Use Bash only for POSIX-specific scripts.
- Read uploaded files from <SANDBOX_PATH> or <PARSED_SANDBOX_PATH>; use those paths exactly and do not guess alternate filenames. Uploads that share a filename are stored in distinct subdirectories.
- Prefer producing explicit result files for transformed data, reports, charts, or exports.
- Avoid long-running services, project scaffolding, dependency installation, and broad environment exploration.

### create_download
After creating a file the user should receive — whether via write_file, edit_file, or code_execution — call create_download to make it downloadable. The app renders a download card in the chat. This is the ONLY way the user can download a file.
- Write downloadable outputs into the working directory (use relative paths, which resolve to the sandbox working directory). On macOS/Linux, a sandbox-writable temp dir such as \`/tmp\` also works; on Windows, keep outputs in the working directory.
- create_download copies the file into durable storage, so it stays downloadable after the session's temporary files are cleaned up.
- If it returns an error (e.g. the file is not inside the sandbox-writable area), re-create the file in the working directory and call create_download again — do not assume the download succeeded.
- NEVER hand-write download links in your reply. Links like \`[download](sandbox:/mnt/data/file.py)\`, \`sandbox:\` URLs, or raw file paths are NOT clickable for the user. After a successful create_download, refer the user to the download card shown in the chat.
`

  return {
    tools: {
      read_file,
      code_execution,
      create_download,
    },
    description,
    ensureSandbox,
  }
}
