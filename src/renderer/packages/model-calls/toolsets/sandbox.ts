import { tool } from 'ai'
import z from 'zod'
import platform from '@/platform'

const toolSetDescription = `
Use these tools to interact with a sandboxed environment for executing code, reading/writing files, and exploring the file system.
All file paths are relative to the sandbox working directory.
Write access is limited to the selected working directory and /tmp.
Prefer operating within granted directories;
if a task needs global/system-level changes, ask the user to run those steps.

## sandbox_bash
Execute a shell command in the sandbox. Returns stdout, stderr, and exit code.
Use for running scripts, installing packages, building projects, or any command-line operation.
Default timeout is 120 seconds (120000ms).

## sandbox_read
Read the content of a file. Returns the file content as a string.
Use when you need to examine file contents.

## sandbox_write
Write content to a file, creating it if it doesn't exist or overwriting if it does.
Use for creating new files or replacing entire file contents.

## sandbox_edit
Perform a search-and-replace edit within a file. The search text must be an exact, unique match.
Use for making targeted modifications to existing files without rewriting the whole file.

## sandbox_grep
Search file contents using regex or literal patterns. Returns matching lines with file paths and line numbers.
Use to find specific code patterns, function definitions, or text across multiple files.

## sandbox_ls
List directory contents with details (permissions, size, dates).
Use to explore the file system structure.

## sandbox_find
Find files by name pattern (glob). Returns matching file paths.
Use to locate files when you know part of the name but not the exact path.
`

const DEFAULT_BASH_TIMEOUT = 120_000

function abortableExec(
  execPromise: Promise<{ stdout: string; stderr: string; exitCode: number }>,
  abortSignal?: AbortSignal
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!abortSignal) return execPromise

  return Promise.race([
    execPromise,
    new Promise<{ stdout: string; stderr: string; exitCode: number }>((_, reject) => {
      if (abortSignal.aborted) {
        platform.sandboxKill?.()
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      abortSignal.addEventListener(
        'abort',
        () => {
          platform.sandboxKill?.()
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true }
      )
    }),
  ])
}

const sandbox_bash = tool({
  description: 'Execute a shell command in the sandbox environment.',
  inputSchema: z.object({
    command: z.string().describe('The shell command to execute in the sandbox'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000)'),
  }),
  execute: async (input: { command: string; timeout?: number }, { abortSignal }: { abortSignal?: AbortSignal }) => {
    if (!platform.sandboxExec) {
      throw new Error('Sandbox not available on this platform')
    }
    try {
      const timeout = input.timeout ?? DEFAULT_BASH_TIMEOUT
      const result = await abortableExec(platform.sandboxExec({ command: input.command, timeout }), abortSignal)
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Cancellation is a result, not an error — the stream is being torn down.
        return { stdout: '', stderr: '[Command cancelled]', exitCode: 130 }
      }
      throw error
    }
  },
})

const sandbox_read = tool({
  description: 'Read the content of a file in the sandbox.',
  inputSchema: z.object({
    file_path: z.string().describe('File path relative to working directory'),
  }),
  execute: async (input: { file_path: string }, _context: { abortSignal?: AbortSignal }) => {
    if (!platform.sandboxRead) {
      throw new Error('Sandbox not available on this platform')
    }
    const result = await platform.sandboxRead({ filePath: input.file_path })
    if (!result.success) {
      throw new Error(`Error reading file: ${result.error}`)
    }
    return { content: result.content ?? '' }
  },
})

const sandbox_write = tool({
  description: 'Write content to a file in the sandbox, creating or overwriting it.',
  inputSchema: z.object({
    file_path: z.string().describe('File path relative to working directory'),
    content: z.string().describe('Full content to write to the file'),
  }),
  execute: async (input: { file_path: string; content: string }, _context: { abortSignal?: AbortSignal }) => {
    if (!platform.sandboxWrite) {
      throw new Error('Sandbox not available on this platform')
    }
    const result = await platform.sandboxWrite({ filePath: input.file_path, content: input.content })
    if (!result.success) {
      throw new Error(`Error writing file: ${result.error}`)
    }
    return `Successfully wrote to ${input.file_path}`
  },
})

const sandbox_edit = tool({
  description: 'Search and replace text in a file. The search text must be an exact unique match within the file.',
  inputSchema: z.object({
    file_path: z.string().describe('File path to edit'),
    old_text: z.string().describe('Exact text to find (must be unique in file)'),
    new_text: z.string().describe('Replacement text'),
  }),
  execute: async (
    input: { file_path: string; old_text: string; new_text: string },
    _context: { abortSignal?: AbortSignal }
  ) => {
    if (!platform.sandboxEdit) {
      throw new Error('Sandbox not available on this platform')
    }
    const result = await platform.sandboxEdit({
      filePath: input.file_path,
      search: input.old_text,
      replace: input.new_text,
    })
    if (!result.success) {
      throw new Error(`Error editing file: ${result.error}`)
    }
    return `Successfully edited ${input.file_path}`
  },
})

const sandbox_grep = tool({
  description: 'Search file contents using a regex or literal pattern. Returns matching lines with file paths.',
  inputSchema: z.object({
    pattern: z.string().describe('Search pattern (regex or literal)'),
    path: z.string().optional().describe('Directory to search (default: .)'),
    include: z.string().optional().describe('File filter glob (e.g., "*.ts")'),
  }),
  execute: async (
    input: { pattern: string; path?: string; include?: string },
    _context: { abortSignal?: AbortSignal }
  ) => {
    if (!platform.sandboxGrep) {
      throw new Error('Sandbox not available on this platform')
    }
    const result = await platform.sandboxGrep({
      pattern: input.pattern,
      dirPath: input.path,
      include: input.include,
    })
    if (!result.success) {
      throw new Error(`Error searching: ${result.error}`)
    }
    return { content: result.content ?? '' }
  },
})

const sandbox_ls = tool({
  description: 'List directory contents in the sandbox.',
  inputSchema: z.object({
    path: z.string().optional().describe('Directory path (default: .)'),
  }),
  execute: async (input: { path?: string }, _context: { abortSignal?: AbortSignal }) => {
    if (!platform.sandboxLs) {
      throw new Error('Sandbox not available on this platform')
    }
    const result = await platform.sandboxLs({ dirPath: input.path || '.' })
    if (!result.success) {
      throw new Error(`Error listing directory: ${result.error}`)
    }
    return { content: result.content ?? '' }
  },
})

const sandbox_find = tool({
  description: 'Find files by name pattern (glob) in the sandbox.',
  inputSchema: z.object({
    pattern: z.string().optional().describe('Glob pattern for file name search'),
    path: z.string().optional().describe('Directory to search (default: .)'),
  }),
  execute: async (input: { pattern?: string; path?: string }, _context: { abortSignal?: AbortSignal }) => {
    if (!platform.sandboxFind) {
      throw new Error('Sandbox not available on this platform')
    }
    const result = await platform.sandboxFind({ dirPath: input.path || '.', pattern: input.pattern })
    if (!result.success) {
      throw new Error(`Error finding files: ${result.error}`)
    }
    return { content: result.content ?? '' }
  },
})

export default {
  description: toolSetDescription,
  tools: {
    sandbox_bash,
    sandbox_read,
    sandbox_write,
    sandbox_edit,
    sandbox_grep,
    sandbox_ls,
    sandbox_find,
  },
}
