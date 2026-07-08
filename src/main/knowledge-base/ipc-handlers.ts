import { ipcMain } from 'electron'
import type { FileMeta } from 'src/shared/types'
import { KNOWLEDGE_BASE_MAX_FILE_SIZE } from '../../shared/knowledge-base'
import { sentry } from '../../shared/sentry-shim'
import { getLogger } from '../util'
import { getDatabase, getVectorStore, parseSQLiteTimestamp, withTransaction } from './db'
import { readChunks, searchKnowledgeBase } from './file-loaders'
import { MineruParser, testMineruConnection } from './parsers'

const log = getLogger('knowledge-base:ipc-handlers')

// Store active MinerU parsing tasks for cancellation support
// Key: filePath, Value: AbortController
const activeMineruParseTasks = new Map<string, AbortController>()

// Register knowledge base related APIs
export function registerKnowledgeBaseHandlers() {
  // Knowledge Base CRUD operations
  ipcMain.handle('kb:list', async () => {
    try {
      log.debug('ipcMain: kb:list')
      const db = getDatabase()
      const rs = await db.execute('SELECT * FROM knowledge_base')
      return rs.rows.map((row) => ({
        id: row.id,
        name: row.name,
        embeddingModel: row.embedding_model,
        rerankModel: row.rerank_model,
        visionModel: row.vision_model,
        providerMode: row.provider_mode || undefined,
        documentParser: row.document_parser ? JSON.parse(row.document_parser as string) : undefined,
        createdAt: row.created_at,
      }))
    } catch (error: unknown) {
      log.error('ipcMain: kb:list failed', error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'kb_list')
        sentry.captureException(error)
      })
      throw error
    }
  })

  ipcMain.handle(
    'kb:create',
    async (
      _event,
      {
        name,
        embeddingModel,
        rerankModel,
        visionModel,
        documentParser,
        providerMode,
      }: {
        name: string
        embeddingModel: string
        rerankModel: string
        visionModel?: string
        documentParser?: { type: string; mineru?: { apiToken: string } }
        providerMode?: 'custom'
      }
    ) => {
      try {
        log.info(
          `ipcMain: kb:create, name=${name}, embeddingModel=${embeddingModel}, rerankModel=${rerankModel}, visionModel=${visionModel}, documentParser=${documentParser?.type || 'default'}, providerMode=${providerMode || 'not specified'}`
        )

        // Validate required fields
        if (!name || !name.trim()) {
          throw new Error('Knowledge base name is required')
        }
        if (!embeddingModel || !embeddingModel.trim()) {
          throw new Error('Embedding model is required')
        }

        const db = getDatabase()
        const documentParserJson = documentParser ? JSON.stringify(documentParser) : null
        const rs = await db.execute({
          sql: 'INSERT INTO knowledge_base (name, embedding_model, rerank_model, vision_model, document_parser, provider_mode) VALUES (?, ?, ?, ?, ?, ?)',
          args: [
            name.trim(),
            embeddingModel,
            rerankModel || null,
            visionModel || null,
            documentParserJson,
            providerMode || null,
          ],
        })
        const id = rs.lastInsertRowid

        if (!id) {
          throw new Error('Failed to create knowledge base')
        }

        log.info(`[IPC] Knowledge base created successfully: id=${id}, name=${name}`)
        return { id, name: name.trim() }
      } catch (error: unknown) {
        log.error(`ipcMain: kb:create failed for name=${name}`, error)
        sentry.withScope((scope) => {
          scope.setTag('component', 'knowledge-base-ipc')
          scope.setTag('operation', 'kb_create')
          scope.setExtra('name', name)
          scope.setExtra('embeddingModel', embeddingModel)
          scope.setExtra('rerankModel', rerankModel)
          scope.setExtra('visionModel', visionModel)
          scope.setExtra('documentParser', documentParser?.type)
          sentry.captureException(error)
        })
        throw error
      }
    }
  )

  ipcMain.handle(
    'kb:update',
    async (
      _event,
      { id, name, rerankModel, visionModel }: { id: number; name?: string; rerankModel?: string; visionModel?: string }
    ) => {
      try {
        log.info(`ipcMain: kb:update, id=${id}, name=${name}, rerankModel=${rerankModel}, visionModel=${visionModel}`)

        if (!id || id <= 0) {
          throw new Error('Invalid knowledge base ID')
        }

        if (!name && rerankModel === undefined && visionModel === undefined) {
          return 0
        }

        const db = getDatabase()
        let sql = 'UPDATE knowledge_base SET '
        const args: (string | number)[] = []

        if (name !== undefined) {
          if (!name.trim()) {
            throw new Error('Knowledge base name cannot be empty')
          }
          sql += 'name = ?'
          args.push(name.trim())
        }
        if (rerankModel !== undefined) {
          if (args.length > 0) sql += ', '
          sql += 'rerank_model = ?'
          args.push(rerankModel ?? '')
        }
        if (visionModel !== undefined) {
          if (args.length > 0) sql += ', '
          sql += 'vision_model = ?'
          args.push(visionModel ?? '')
        }
        sql += ' WHERE id = ?'
        args.push(id)

        const rs = await db.execute(sql, args)
        log.info(`[IPC] Knowledge base updated: id=${id}, affected rows=${rs.rowsAffected ?? 'unknown'}`)
        return rs.rowsAffected
      } catch (error: unknown) {
        log.error(`ipcMain: kb:update failed for id=${id}`, error)
        sentry.withScope((scope) => {
          scope.setTag('component', 'knowledge-base-ipc')
          scope.setTag('operation', 'kb_update')
          scope.setExtra('kbId', id)
          scope.setExtra('name', name)
          scope.setExtra('rerankModel', rerankModel)
          scope.setExtra('visionModel', visionModel)
          sentry.captureException(error)
        })
        throw error
      }
    }
  )

  ipcMain.handle('kb:delete', async (_event, kbId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      log.info(`ipcMain: kb:delete, kbId=${kbId}`)

      if (!kbId || kbId <= 0) {
        throw new Error('Invalid knowledge base ID')
      }

      await withTransaction(async () => {
        const db = getDatabase()
        const vectorStore = getVectorStore()

        // Verify knowledge base exists before deletion
        const kbExists = await db.execute('SELECT id FROM knowledge_base WHERE id = ?', [kbId])
        if (!kbExists.rows[0]) {
          throw new Error(`Knowledge base ${kbId} not found`)
        }

        // 1. Delete associated files from kb_file
        await db.execute({
          sql: 'DELETE FROM kb_file WHERE kb_id = ?',
          args: [kbId],
        })
        log.info(`[IPC] Deleted file records for kbId=${kbId}`)

        // 2. Delete the knowledge base entry
        await db.execute({
          sql: 'DELETE FROM knowledge_base WHERE id = ?',
          args: [kbId],
        })
        log.info(`[IPC] Deleted knowledge base record for kbId=${kbId}`)

        // 3. Delete vector index
        await vectorStore.deleteIndex({ indexName: `kb_${kbId}` })
        log.info(`[IPC] Deleted vector index for kbId=${kbId}`)
      })

      return { success: true }
    } catch (error: unknown) {
      log.error(`ipcMain: kb:delete failed for kbId=${kbId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'kb_delete')
        scope.setExtra('kbId', kbId)
        sentry.captureException(error)
      })
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // File management operations
  ipcMain.handle('kb:file:list', async (_event, kbId: number) => {
    try {
      log.debug(`ipcMain: kb:file:list, kbId=${kbId}`)

      if (!kbId || kbId <= 0) {
        throw new Error('Invalid knowledge base ID')
      }

      const db = getDatabase()
      const rs = await db.execute({
        sql: 'SELECT * FROM kb_file WHERE kb_id = ?',
        args: [kbId],
      })
      return rs.rows.map((row) => ({
        id: row.id,
        kb_id: row.kb_id,
        filename: row.filename,
        filepath: row.filepath,
        mime_type: row.mime_type,
        file_size: row.file_size || 0,
        chunk_count: row.chunk_count || 0,
        total_chunks: row.total_chunks || 0,
        status: row.status,
        error: row.error,
        createdAt: parseSQLiteTimestamp(row.created_at as string),
        parsed_remotely: row.parsed_remotely || 0,
        parser_type: row.parser_type || 'local',
      }))
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:list failed for kbId=${kbId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_list')
        scope.setExtra('kbId', kbId)
        sentry.captureException(error)
      })
      throw error
    }
  })

  ipcMain.handle('kb:file:count', async (_event, kbId: number) => {
    try {
      // log.debug(`ipcMain: kb:file:count, kbId=${kbId}`)

      if (!kbId || kbId <= 0) {
        throw new Error('Invalid knowledge base ID')
      }

      const db = getDatabase()
      const rs = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM kb_file WHERE kb_id = ?',
        args: [kbId],
      })
      return rs.rows[0].count as number
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:count failed for kbId=${kbId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_count')
        scope.setExtra('kbId', kbId)
        sentry.captureException(error)
      })
      throw error
    }
  })

  ipcMain.handle('kb:file:list-paginated', async (_event, kbId: number, offset = 0, limit = 20) => {
    try {
      // log.debug(`ipcMain: kb:file:list-paginated, kbId=${kbId}, offset=${offset}, limit=${limit}`)

      if (!kbId || kbId <= 0) {
        throw new Error('Invalid knowledge base ID')
      }
      if (offset < 0 || limit <= 0 || limit > 100) {
        throw new Error('Invalid pagination parameters')
      }

      const db = getDatabase()
      const rs = await db.execute({
        sql: 'SELECT * FROM kb_file WHERE kb_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        args: [kbId, limit, offset],
      })
      return rs.rows.map((row) => ({
        id: row.id,
        kb_id: row.kb_id,
        filename: row.filename,
        filepath: row.filepath,
        mime_type: row.mime_type,
        file_size: row.file_size || 0,
        chunk_count: row.chunk_count || 0,
        total_chunks: row.total_chunks || 0,
        status: row.status,
        error: row.error,
        createdAt: parseSQLiteTimestamp(row.created_at as string),
        parsed_remotely: row.parsed_remotely || 0,
        parser_type: row.parser_type || 'local',
      }))
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:list-paginated failed for kbId=${kbId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_list_paginated')
        scope.setExtra('kbId', kbId)
        scope.setExtra('offset', offset)
        scope.setExtra('limit', limit)
        sentry.captureException(error)
      })
      throw error
    }
  })

  ipcMain.handle('kb:file:get-metas', async (_event, kbId: number, fileIds: number[]) => {
    try {
      log.debug(`ipcMain: kb:file:get-metas, kbId=${kbId}, fileIds=${fileIds.join(',')}`)

      if (!kbId || kbId <= 0) {
        throw new Error('Invalid knowledge base ID')
      }
      if (!fileIds || fileIds.length === 0) {
        return []
      }
      if (fileIds.length > 100) {
        throw new Error('Too many file IDs requested (max 100)')
      }

      const db = getDatabase()
      const placeholders = fileIds.map(() => '?').join(',')
      const sql = `SELECT id, kb_id, filename, mime_type, file_size, chunk_count, total_chunks, status, created_at FROM kb_file WHERE kb_id = ? AND id IN (${placeholders})`
      const rs = await db.execute({
        sql,
        args: [kbId, ...fileIds],
      })
      return rs.rows.map((row) => ({
        id: row.id,
        kbId: row.kb_id,
        filename: row.filename,
        mimeType: row.mime_type,
        fileSize: row.file_size || 0,
        chunkCount: row.chunk_count || 0,
        totalChunks: row.total_chunks || 0,
        status: row.status,
        createdAt: parseSQLiteTimestamp(row.created_at as string),
      }))
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:get-metas failed for kbId=${kbId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_get_metas')
        scope.setExtra('kbId', kbId)
        scope.setExtra('fileIdsCount', fileIds?.length || 0)
        sentry.captureException(error)
      })
      throw error
    }
  })

  ipcMain.handle(
    'kb:file:read-chunks',
    async (_event, kbId: number, chunks: { fileId: number; chunkIndex: number }[]) => {
      try {
        log.debug(`ipcMain: kb:file:read-chunks, kbId=${kbId}, chunks=${chunks.length}`)

        if (!kbId || kbId <= 0) {
          throw new Error('Invalid knowledge base ID')
        }
        if (!chunks || !Array.isArray(chunks)) {
          throw new Error('Invalid chunks parameter')
        }
        if (chunks.length > 200) {
          throw new Error('Too many chunks requested (max 200)')
        }

        return await readChunks(kbId, chunks)
      } catch (error: unknown) {
        log.error(`ipcMain: kb:file:read-chunks failed for kbId=${kbId}`, error)
        sentry.withScope((scope) => {
          scope.setTag('component', 'knowledge-base-ipc')
          scope.setTag('operation', 'file_read_chunks')
          scope.setExtra('kbId', kbId)
          scope.setExtra('chunksCount', chunks?.length || 0)
          sentry.captureException(error)
        })
        throw error
      }
    }
  )

  // File upload and create task, embeddingProvider parameter is required
  ipcMain.handle('kb:file:upload', async (_event, kbId: number, file: FileMeta): Promise<{ id: number }> => {
    try {
      log.debug(`ipcMain: kb:file:upload, kbId=${kbId}, file=${JSON.stringify(file)}`)

      if (!kbId || kbId <= 0) {
        throw new Error('Invalid knowledge base ID')
      }
      if (!file || !file.name || !file.path || !file.type) {
        throw new Error('Invalid file metadata')
      }
      if (file.size < 0 || file.size > KNOWLEDGE_BASE_MAX_FILE_SIZE) {
        throw new Error('Invalid file size')
      }

      const db = getDatabase()

      // Verify knowledge base exists
      const kbExists = await db.execute('SELECT id FROM knowledge_base WHERE id = ?', [kbId])
      if (!kbExists.rows[0]) {
        throw new Error(`Knowledge base ${kbId} not found`)
      }

      // 1. Create file record in database (status: pending)
      log.info(
        `[IPC] Creating file record: kbId=${kbId}, filename=${file.name}, filepath=${file.path}, mimeType=${file.type}, size=${file.size}`
      )
      const rs = await db.execute({
        sql: 'INSERT INTO kb_file (kb_id, filename, filepath, mime_type, file_size) VALUES (?, ?, ?, ?, ?)',
        args: [kbId, file.name, file.path, file.type, file.size],
      })
      const id = rs.lastInsertRowid
      if (!id) {
        throw new Error('File upload failed - no ID returned')
      }

      log.info(`[IPC] File created: id=${id}, kbId=${kbId}, filename=${file.name}`)
      return {
        id: Number(id),
      }
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:upload failed for kbId=${kbId}, filename=${file?.name}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_upload')
        scope.setExtra('kbId', kbId)
        scope.setExtra('filename', file?.name)
        scope.setExtra('fileSize', file?.size)
        scope.setExtra('mimeType', file?.type)
        sentry.captureException(error)
      })
      throw error
    }
  })

  // Search interface, embeddingProvider parameter is required
  ipcMain.handle('kb:search', async (_event, kbId: number, query: string) => {
    try {
      log.debug(`ipcMain: kb:search, kbId=${kbId}, query=${query}`)

      if (!kbId || kbId <= 0) {
        throw new Error('Invalid knowledge base ID')
      }
      if (!query || !query.trim()) {
        throw new Error('Search query is required')
      }
      if (query.length > 1000) {
        throw new Error('Search query too long (max 1000 characters)')
      }

      return await searchKnowledgeBase(kbId, query.trim())
    } catch (error: unknown) {
      log.error(`ipcMain: kb:search failed for kbId=${kbId}, query=${query}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'search')
        scope.setExtra('kbId', kbId)
        scope.setExtra('queryLength', query?.length || 0)
        sentry.captureException(error)
      })
      throw error
    }
  })

  // Retry failed files
  ipcMain.handle('kb:file:retry', async (_event, fileId: number, useRemoteParsing = false) => {
    try {
      log.debug(`ipcMain: kb:file:retry, fileId=${fileId}, useRemoteParsing=${useRemoteParsing}`)

      if (!fileId || fileId <= 0) {
        throw new Error('Invalid file ID')
      }

      const db = getDatabase()
      // Check if file exists and is in failed state
      const rs = await db.execute({
        sql: 'SELECT * FROM kb_file WHERE id = ?',
        args: [fileId],
      })
      const file = rs.rows[0]
      if (!file) {
        throw new Error('File not found')
      }
      if (file.status !== 'failed') {
        throw new Error('Only failed files can be retried')
      }

      // Reset file status to pending for reprocessing, also set use_remote_parsing flag
      await db.execute({
        sql: 'UPDATE kb_file SET status = ?, error = NULL, chunk_count = 0, total_chunks = 0, processing_started_at = NULL, use_remote_parsing = ? WHERE id = ?',
        args: ['pending', useRemoteParsing ? 1 : 0, fileId],
      })

      log.info(
        `[IPC] File retry request created: ${file.filename} (id=${fileId}, useRemoteParsing=${useRemoteParsing})`
      )
      return { success: true }
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:retry failed for fileId=${fileId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_retry')
        scope.setExtra('fileId', fileId)
        scope.setExtra('useRemoteParsing', useRemoteParsing)
        sentry.captureException(error)
      })
      throw error
    }
  })

  // Pause processing file
  ipcMain.handle('kb:file:pause', async (_event, fileId: number) => {
    try {
      log.debug(`ipcMain: kb:file:pause, fileId=${fileId}`)

      if (!fileId || fileId <= 0) {
        throw new Error('Invalid file ID')
      }

      const db = getDatabase()
      // Check if file exists and is processing
      const rs = await db.execute({
        sql: 'SELECT * FROM kb_file WHERE id = ?',
        args: [fileId],
      })
      const file = rs.rows[0]
      if (!file) {
        throw new Error('File not found')
      }
      if (file.status !== 'processing') {
        throw new Error('Only processing files can be paused')
      }

      // Set file status to paused
      await db.execute({
        sql: 'UPDATE kb_file SET status = ?, processing_started_at = NULL WHERE id = ?',
        args: ['paused', fileId],
      })

      log.info(`[IPC] File paused: ${file.filename} (id=${fileId})`)
      return { success: true }
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:pause failed for fileId=${fileId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_pause')
        scope.setExtra('fileId', fileId)
        sentry.captureException(error)
      })
      throw error
    }
  })

  // Resume paused file
  ipcMain.handle('kb:file:resume', async (_event, fileId: number) => {
    try {
      log.debug(`ipcMain: kb:file:resume, fileId=${fileId}`)

      if (!fileId || fileId <= 0) {
        throw new Error('Invalid file ID')
      }

      const db = getDatabase()
      // Check if file exists and is paused
      const rs = await db.execute({
        sql: 'SELECT * FROM kb_file WHERE id = ?',
        args: [fileId],
      })
      const file = rs.rows[0]
      if (!file) {
        throw new Error('File not found')
      }
      if (file.status !== 'paused') {
        throw new Error('Only paused files can be resumed')
      }

      // Set file status to pending for processing
      await db.execute({
        sql: 'UPDATE kb_file SET status = ?, error = NULL WHERE id = ?',
        args: ['pending', fileId],
      })

      log.info(`[IPC] File resume request created: ${file.filename} (id=${fileId})`)
      return { success: true }
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:resume failed for fileId=${fileId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_resume')
        scope.setExtra('fileId', fileId)
        sentry.captureException(error)
      })
      throw error
    }
  })

  // Delete file and its embeddings
  ipcMain.handle('kb:file:delete', async (_event, fileId: number) => {
    try {
      log.debug(`ipcMain: kb:file:delete, fileId=${fileId}`)

      if (!fileId || fileId <= 0) {
        throw new Error('Invalid file ID')
      }

      // `await` is required: without it the surrounding catch never sees a
      // rejected transaction, so failures would reject the IPC call instead of
      // returning the {success:false} envelope the renderer expects.
      return await withTransaction(async () => {
        const db = getDatabase()
        const vectorStore = getVectorStore()

        // Find file information
        const rs = await db.execute({
          sql: 'SELECT * FROM kb_file WHERE id = ?',
          args: [fileId],
        })
        const file = rs.rows[0]
        if (!file) {
          throw new Error('File not found')
        }

        const indexName = `kb_${file.kb_id}`

        // Delete embedding data - use vectorStore.turso for direct operation
        log.info(`[IPC] Deleting vectors: fileId=${fileId}, indexName=${indexName}`)

        try {
          // First query the number of vectors to delete
          const countResult = await (vectorStore as any).turso.execute({
            sql: `SELECT COUNT(*) as count FROM ${indexName} WHERE json_extract(metadata, '$.fileId') = ?`,
            args: [fileId],
          })
          const vectorCount = Number(countResult.rows[0]?.count || 0)
          log.info(`[IPC] Found ${vectorCount} vectors to delete`)

          if (vectorCount > 0) {
            // Delete vector data
            const deleteResult = await (vectorStore as any).turso.execute({
              sql: `DELETE FROM ${indexName} WHERE json_extract(metadata, '$.fileId') = ?`,
              args: [fileId],
            })
            const rowsDeleted = Number(deleteResult.rowsAffected || 0)
            log.info(`[IPC] Deleted ${rowsDeleted} vectors`)
          } else {
            log.info(`[IPC] No vectors to delete`)
          }
        } catch (vectorDeleteErr: unknown) {
          log.error(`[IPC] Failed to delete vectors: fileId=${fileId}`, vectorDeleteErr)
          // Continue with file record deletion even if vector deletion fails
          sentry.withScope((scope) => {
            scope.setTag('component', 'knowledge-base-ipc')
            scope.setTag('operation', 'file_delete_vectors')
            scope.setExtra('fileId', fileId)
            scope.setExtra('indexName', indexName)
            sentry.captureException(vectorDeleteErr)
          })
        }

        // Delete file record
        const res = await db.execute({
          sql: 'DELETE FROM kb_file WHERE id = ?',
          args: [fileId],
        })
        log.info(`[IPC] Deleted file record: fileId=${fileId}, affected rows=${res.rowsAffected ?? 'unknown'}`)

        return { success: true }
      })
    } catch (error: unknown) {
      log.error(`ipcMain: kb:file:delete failed for fileId=${fileId}`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-ipc')
        scope.setTag('operation', 'file_delete')
        scope.setExtra('fileId', fileId)
        sentry.captureException(error)
      })
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Parser-related handlers
  ipcMain.handle('parser:test-mineru', async (_event, apiToken: string) => {
    try {
      log.debug('ipcMain: parser:test-mineru')

      if (!apiToken || !apiToken.trim()) {
        return { success: false, error: 'API token is required' }
      }

      return await testMineruConnection(apiToken.trim())
    } catch (error: unknown) {
      log.error('ipcMain: parser:test-mineru failed', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Parse file with MinerU (for InputBox file attachments)
  ipcMain.handle(
    'parser:parse-file-with-mineru',
    async (
      _event,
      params: {
        filePath: string
        filename: string
        mimeType: string
        apiToken: string
      }
    ): Promise<{ success: boolean; content?: string; error?: string; cancelled?: boolean }> => {
      const { filePath, filename, mimeType, apiToken } = params

      try {
        log.info(`ipcMain: parser:parse-file-with-mineru, filename=${filename}, mimeType=${mimeType}`)

        if (!filePath || !filePath.trim()) {
          return { success: false, error: 'File path is required' }
        }
        if (!apiToken || !apiToken.trim()) {
          return { success: false, error: 'API token is required' }
        }

        // Create AbortController for this task
        const abortController = new AbortController()
        activeMineruParseTasks.set(filePath, abortController)

        try {
          // Create MinerU parser instance
          const parser = new MineruParser(apiToken.trim())

          // Parse file (will poll for up to 5 minutes)
          const content = await parser.parse(
            filePath,
            {
              fileId: Date.now(), // Temporary ID for this parsing session
              filename,
              mimeType,
            },
            abortController.signal
          )

          log.info(`ipcMain: parser:parse-file-with-mineru completed, content length=${content.length}`)
          return { success: true, content }
        } finally {
          // Clean up the task from the map
          activeMineruParseTasks.delete(filePath)
        }
      } catch (error: unknown) {
        // Check if this was a cancellation
        if (
          error instanceof Error &&
          (('code' in error && (error as { code?: string }).code === 'CANCELLED') || error.name === 'AbortError')
        ) {
          log.info(`ipcMain: parser:parse-file-with-mineru cancelled, filename=${filename}`)
          return { success: false, cancelled: true, error: 'Operation cancelled' }
        }

        log.error('ipcMain: parser:parse-file-with-mineru failed', error)
        sentry.withScope((scope) => {
          scope.setTag('component', 'knowledge-base-ipc')
          scope.setTag('operation', 'parse_file_with_mineru')
          scope.setExtra('filename', params?.filename)
          scope.setExtra('mimeType', params?.mimeType)
          sentry.captureException(error)
        })
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // Cancel MinerU parsing task
  ipcMain.handle('parser:cancel-mineru-parse', async (_event, filePath: string) => {
    try {
      log.info(`ipcMain: parser:cancel-mineru-parse, filePath=${filePath}`)

      const controller = activeMineruParseTasks.get(filePath)
      if (controller) {
        controller.abort()
        activeMineruParseTasks.delete(filePath)
        log.info(`ipcMain: parser:cancel-mineru-parse succeeded, filePath=${filePath}`)
        return { success: true }
      }

      log.debug(`ipcMain: parser:cancel-mineru-parse - no active task found for filePath=${filePath}`)
      return { success: true } // No task to cancel is also success
    } catch (error: unknown) {
      log.error('ipcMain: parser:cancel-mineru-parse failed', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
