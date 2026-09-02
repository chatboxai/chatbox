export const WORKSPACE_INSTRUCTIONS_MAX_CHARS = 80_000
export const WORKSPACE_INSTRUCTIONS_MAX_DIRECTORIES = 20

export interface WorkspaceInstructionFile {
  filePath: string
  content: string
  truncated: boolean
}

export interface WorkspaceInstructionsResult {
  directories: string[]
  files: WorkspaceInstructionFile[]
  skippedDirectoryCount: number
  budgetExhausted: boolean
}
