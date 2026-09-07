import {
  WORKSPACE_INSTRUCTIONS_MAX_DIRECTORIES,
  type WorkspaceInstructionsResult,
} from '@shared/types/workspace-instructions'
import platform from '@/platform'

export function normalizeWorkspaceDirectory(directory: string): string {
  const normalized = directory.trim().replace(/\\/g, '/')
  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/, '')
}

export async function buildWorkspaceInstructions(userWorkingDirectories?: string[]): Promise<string> {
  const directories = [
    ...new Set(
      userWorkingDirectories?.map(normalizeWorkspaceDirectory).filter((directory) => directory.length > 0) ?? []
    ),
  ]
  if (directories.length === 0) return ''

  let result: WorkspaceInstructionsResult = {
    directories: directories.slice(0, WORKSPACE_INSTRUCTIONS_MAX_DIRECTORIES),
    files: [],
    skippedDirectoryCount: Math.max(0, directories.length - WORKSPACE_INSTRUCTIONS_MAX_DIRECTORIES),
    budgetExhausted: false,
  }
  try {
    if (platform.readWorkspaceInstructions) {
      result = await platform.readWorkspaceInstructions(userWorkingDirectories ?? [])
    }
  } catch {
    // Workspace instruction discovery is best-effort and must not block generation.
  }

  const displayDirectories = result.directories.map(normalizeWorkspaceDirectory)
  const files = result.files.filter((file) => file.content.trim().length > 0)
  const loadedInstructions = files.length
    ? `\nAutomatically loaded workspace instructions:\n\n${files
        .map(
          ({ filePath, content, truncated }) =>
            `<AGENTS_MD path="${filePath.replace(/\\/g, '/').replace(/"/g, '&quot;')}">\n${content}\n</AGENTS_MD>${
              truncated
                ? '\nThis AGENTS.md was truncated for context safety. Read the remaining content before changing files whose instructions may appear later.'
                : ''
            }`
        )
        .join('\n\n')}\n`
    : '\nNo root AGENTS.md was found while preparing this turn.\n'
  const safetyNotices = [
    result.budgetExhausted
      ? 'Some workspace instruction content was truncated or omitted to stay within the shared context budget.'
      : '',
    result.skippedDirectoryCount > 0
      ? `${result.skippedDirectoryCount} working director${result.skippedDirectoryCount === 1 ? 'y was' : 'ies were'} skipped because the safe directory limit was reached or the path could not be validated.`
      : '',
  ].filter(Boolean)

  return `
## Workspace Instructions
Chatbox automatically checks each user-selected working directory for a root AGENTS.md and injects its content below. Follow those instructions for every file in their scope. When working in a nested directory, check whether a closer AGENTS.md applies and follow the most specific instructions. System and user instructions take precedence.

User-selected working directories:
${displayDirectories.map((directory) => `- ${directory}`).join('\n')}
${loadedInstructions}
${safetyNotices.join('\n')}
`
}
