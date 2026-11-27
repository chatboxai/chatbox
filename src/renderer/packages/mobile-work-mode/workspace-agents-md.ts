import { Directory, type FilesystemPlugin } from '@capacitor/filesystem'
import { base64ToText, sessionDirectoryName } from '@shared/mobile-work/workspace-path'

export const WORKSPACE_AGENTS_MD_PATH = 'AGENTS.md'
export const WORKSPACE_AGENTS_MD_MAX_CHARS = 32 * 1024

/**
 * Read the AGENTS.md protocol file from a session workspace root, if present.
 * Mirrors how Kimi Code picks up a project ./AGENTS.md: silent null when the
 * file or the workspace does not exist, truncated to the context-safe cap.
 */
export async function readWorkspaceAgentsMd(
  sessionId: string,
  filesystem: FilesystemPlugin
): Promise<string | null> {
  let path: string
  try {
    path = `workspaces/${sessionDirectoryName(sessionId)}/${WORKSPACE_AGENTS_MD_PATH}`
  } catch {
    return null
  }
  try {
    const stat = await filesystem.stat({ path, directory: Directory.Data })
    if (stat.type !== 'file') return null
    const { data } = await filesystem.readFile({ path, directory: Directory.Data })
    const raw = typeof data === 'string' ? data : ''
    if (!raw) return null
    const text = base64ToText(raw).trim()
    if (!text) return null
    return text.slice(0, WORKSPACE_AGENTS_MD_MAX_CHARS)
  } catch {
    return null
  }
}
