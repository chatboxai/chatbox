import type { DesktopIPC } from '@shared/desktop-ipc-types'
import type { FileMeta, KnowledgeBaseProviderMode } from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import type { KnowledgeBaseController } from './interface'

class DesktopKnowledgeBaseController implements KnowledgeBaseController {
  constructor(private ipc: DesktopIPC) {}

  async list() {
    const knowledgeBases = await this.ipc.invoke('kb:list')
    return knowledgeBases
  }

  async create(createParams: {
    name: string
    embeddingModel: string
    rerankModel: string
    visionModel?: string
    documentParser?: DocumentParserConfig
    providerMode?: KnowledgeBaseProviderMode
  }) {
    await this.ipc.invoke('kb:create', createParams)
  }

  async delete(id: number) {
    await this.ipc.invoke('kb:delete', id)
  }

  async listFiles(kbId: number) {
    const files = await this.ipc.invoke('kb:file:list', kbId)
    return files
  }

  async countFiles(kbId: number) {
    return await this.ipc.invoke('kb:file:count', kbId)
  }

  async listFilesPaginated(kbId: number, offset = 0, limit = 20) {
    return await this.ipc.invoke('kb:file:list-paginated', kbId, offset, limit)
  }

  async uploadFile(kbId: number, file: FileMeta) {
    return await this.ipc.invoke('kb:file:upload', kbId, file)
  }

  async deleteFile(fileId: number) {
    return await this.ipc.invoke('kb:file:delete', fileId)
  }

  async retryFile(fileId: number, useRemoteParsing = false) {
    return await this.ipc.invoke('kb:file:retry', fileId, useRemoteParsing)
  }

  async pauseFile(fileId: number) {
    return await this.ipc.invoke('kb:file:pause', fileId)
  }

  async resumeFile(fileId: number) {
    return await this.ipc.invoke('kb:file:resume', fileId)
  }

  async search(kbId: number, query: string) {
    const results = await this.ipc.invoke('kb:search', kbId, query)
    return results
  }

  async update(updateParams: { id: number; name?: string; rerankModel?: string; visionModel?: string }) {
    await this.ipc.invoke('kb:update', updateParams)
  }

  async getFilesMeta(kbId: number, fileIds: number[]) {
    return this.ipc.invoke('kb:file:get-metas', kbId, fileIds)
  }

  async readFileChunks(kbId: number, chunks: { fileId: number; chunkIndex: number }[]) {
    return this.ipc.invoke('kb:file:read-chunks', kbId, chunks)
  }

  async testMineruConnection(apiToken: string): Promise<{ success: boolean; error?: string }> {
    return this.ipc.invoke('parser:test-mineru', apiToken)
  }
}

export default DesktopKnowledgeBaseController
