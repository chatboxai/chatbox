import type { WorkArtifact } from '../work-artifacts'
import type { WorkspaceFiles } from './workspace-path'

export interface LocalWorkspacePort {
  snapshot(sessionId: string): Promise<WorkspaceFiles>
  commit(sessionId: string, files: WorkspaceFiles, signal: AbortSignal): Promise<void>
  readText(sessionId: string, path: string): Promise<string>
  readBase64(sessionId: string, path: string): Promise<string>
  deliver(sessionId: string, path: string): Promise<WorkArtifact>
}
