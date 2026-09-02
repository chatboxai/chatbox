import type { ElectronIPC } from '@shared/electron-types'
import type { SessionAttachmentQueryPlan, SessionAttachmentRagMaintenanceScope } from '@shared/types'
import type { SessionAttachmentRagController } from './interface'

class DesktopSessionAttachmentRagController implements SessionAttachmentRagController {
  constructor(private ipc: ElectronIPC) {}

  async create(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    mimeType: string
    fileSize: number
    tokenEstimate: number
    parserType?: string
  }) {
    return this.ipc.invoke('session-attachment-rag:create', params)
  }

  async getAttachments(ids: number[]) {
    return this.ipc.invoke('session-attachment-rag:get-attachments', ids)
  }

  async retryAttachment(attachmentId: number) {
    return this.ipc.invoke('session-attachment-rag:retry', attachmentId)
  }

  async rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }) {
    return this.ipc.invoke('session-attachment-rag:rebind', params)
  }

  async deleteAttachment(attachmentId: number) {
    return this.ipc.invoke('session-attachment-rag:delete-attachment', attachmentId)
  }

  async deleteMessageAttachments(messageId: string) {
    return this.ipc.invoke('session-attachment-rag:delete-message-attachments', messageId)
  }

  async deleteSessionAttachments(sessionId: string) {
    return this.ipc.invoke('session-attachment-rag:delete-session-attachments', sessionId)
  }

  async cleanupOrphans(params: { sessionIds: string[]; messageIds: string[] }) {
    return this.ipc.invoke('session-attachment-rag:cleanup-orphans', params)
  }

  async getDebugSnapshot() {
    return this.ipc.invoke('session-attachment-rag:get-debug-snapshot')
  }

  async clearAll() {
    return this.ipc.invoke('session-attachment-rag:clear-all')
  }

  async runMaintenance(params: SessionAttachmentRagMaintenanceScope) {
    return this.ipc.invoke('session-attachment-rag:run-maintenance', params)
  }

  async query(params: { attachmentIds: number[]; query: string; plan: SessionAttachmentQueryPlan }) {
    return this.ipc.invoke('session-attachment-rag:query', params)
  }

  async readParents(params: { parentIds: number[]; attachmentIds: number[] }) {
    return this.ipc.invoke('session-attachment-rag:read-parents', params)
  }
}

export default DesktopSessionAttachmentRagController
