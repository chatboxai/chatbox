import { describe, expect, it } from 'vitest'
import { textToBase64 } from '@shared/mobile-work/workspace-path'
import { readWorkspaceAgentsMd, WORKSPACE_AGENTS_MD_MAX_CHARS } from './workspace-agents-md'

/** Minimal in-memory FilesystemPlugin: paths are keys such as `workspaces/<hex>/AGENTS.md`. */
function makeFilesystem(files: Record<string, { content?: string; directory?: boolean }>) {
  return {
    async stat({ path }: { path: string }) {
      const entry = files[path]
      if (!entry) {
        const error = new Error(`ENOENT: ${path}`) as Error & { code: string }
        error.code = 'OS-PLUG-FILE-0006'
        throw error
      }
      return { type: entry.directory ? ('directory' as const) : ('file' as const), size: entry.content?.length ?? 0, mtime: 0, ctime: 0, uri: `file:///data/${path}` }
    },
    async readFile({ path }: { path: string }) {
      const entry = files[path]
      if (!entry || entry.content === undefined) {
        const error = new Error(`ENOENT: ${path}`) as Error & { code: string }
        error.code = 'OS-PLUG-FILE-0006'
        throw error
      }
      return { data: entry.content, uri: `file:///data/${path}` }
    },
  }
}

const SESSION_ID = 'session-1'

function hexSessionId(sessionId: string): string {
  return Array.from(new TextEncoder().encode(sessionId), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function workspaceKey(sessionId: string, file: string): string {
  return `workspaces/${hexSessionId(sessionId)}/${file}`
}

describe('readWorkspaceAgentsMd', () => {
  it('returns the decoded AGENTS.md content for an existing workspace file', async () => {
    const fs = makeFilesystem({ [workspaceKey(SESSION_ID, 'AGENTS.md')]: { content: textToBase64('# Protocol\nProve honestly.') } })
    await expect(readWorkspaceAgentsMd(SESSION_ID, fs as never)).resolves.toBe('# Protocol\nProve honestly.')
  })

  it('returns null when the workspace has no AGENTS.md', async () => {
    const fs = makeFilesystem({ [workspaceKey(SESSION_ID, 'notes.txt')]: { content: textToBase64('hi') } })
    await expect(readWorkspaceAgentsMd(SESSION_ID, fs as never)).resolves.toBeNull()
  })

  it('returns null when the workspace directory does not exist at all', async () => {
    const fs = makeFilesystem({})
    await expect(readWorkspaceAgentsMd(SESSION_ID, fs as never)).resolves.toBeNull()
  })

  it('returns null when the entry is a directory rather than a file', async () => {
    const fs = makeFilesystem({ [workspaceKey(SESSION_ID, 'AGENTS.md')]: { directory: true } })
    await expect(readWorkspaceAgentsMd(SESSION_ID, fs as never)).resolves.toBeNull()
  })

  it('returns null for blank or whitespace-only content', async () => {
    const fs = makeFilesystem({ [workspaceKey(SESSION_ID, 'AGENTS.md')]: { content: textToBase64('  \n ') } })
    await expect(readWorkspaceAgentsMd(SESSION_ID, fs as never)).resolves.toBeNull()
  })

  it('truncates content beyond the cap', async () => {
    const big = 'a'.repeat(WORKSPACE_AGENTS_MD_MAX_CHARS + 100)
    const fs = makeFilesystem({ [workspaceKey(SESSION_ID, 'AGENTS.md')]: { content: textToBase64(big) } })
    const result = await readWorkspaceAgentsMd(SESSION_ID, fs as never)
    expect(result).toHaveLength(WORKSPACE_AGENTS_MD_MAX_CHARS)
  })

  it('returns null for an invalid session id instead of throwing', async () => {
    const fs = makeFilesystem({})
    await expect(readWorkspaceAgentsMd('', fs as never)).resolves.toBeNull()
  })
})
