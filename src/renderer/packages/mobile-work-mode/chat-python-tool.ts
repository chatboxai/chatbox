import { PYTHON_ENVIRONMENT } from '@shared/mobile-work/execution-contract'
import type { WorkspaceFiles } from '@shared/mobile-work/workspace-path'
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolSet } from 'ai'
import { capacitorPython } from './python-service'

/**
 * Python for plain chat sessions (agent/work mode is off).
 *
 * Work mode registers the full `code_execution` tool through `LocalWorkMode`, but that tool only
 * exists while agent mode is on. Chat sessions still want Python on mobile, so this is a small
 * standalone tool wired to the same Pyodide runtime and the same per-session workspace: files the
 * script writes land in the conversation workspace and come back next time.
 */

const CHAT_PYTHON_DESCRIPTION = `Execute Python (CPython in a WebAssembly sandbox) and return its stdout.

${PYTHON_ENVIRONMENT}`

/** Appended to the system prompt whenever the chat-mode Python tool is registered. */
export const CHAT_PYTHON_INSTRUCTIONS = `

## Python
You can run Python with the \`code_execution\` tool. numpy, pandas, matplotlib and scipy are preinstalled; there is no network access. Drawings must use the Agg backend and be saved into \`output/\`.
`

const MAX_CODE_LENGTH = 100_000

export interface ChatPythonToolOptions {
  sessionId: string
  /** Reads/writes the conversation workspace; omitted when the workspace is unavailable. */
  workspace?: {
    snapshot(sessionId: string): Promise<WorkspaceFiles>
    commit(sessionId: string, files: WorkspaceFiles, signal?: AbortSignal): Promise<unknown>
  }
}

export function buildChatPythonTools(options: ChatPythonToolOptions): ToolSet {
  return {
    code_execution: tool({
      description: CHAT_PYTHON_DESCRIPTION,
      inputSchema: z.object({
        code: z.string().max(MAX_CODE_LENGTH).describe('Python source code to run.'),
      }),
      execute: async ({ code }, { abortSignal }) => {
        const signal = abortSignal ?? new AbortController().signal
        const files: WorkspaceFiles = options.workspace
          ? await options.workspace.snapshot(options.sessionId).catch(() => ({}))
          : {}
        const result = await capacitorPython.execute(code, files, signal)
        if (options.workspace && !result.error && Object.keys(result.files).length > 0) {
          await options.workspace.commit(options.sessionId, result.files, signal).catch((error) => {
            console.warn('[chat-python] failed to save workspace files', error)
          })
        }
        return {
          stdout: result.stdout,
          ...(result.error ? { error: result.error } : {}),
        }
      },
    }),
  }
}
