import { setTimeout } from 'node:timers/promises'
import { MDocument } from '@mastra/rag'
import { embedMany } from 'ai'
import {
  KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE,
  KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR,
} from '../../shared/knowledge-base'
import { rerank } from '../../shared/models/rerank'
import type { DocumentParserConfig } from '../../shared/types/settings'
import { sentry } from '../adapters/sentry'
import { getLogger } from '../util'
import { checkProcessingTimeouts, getDatabase, getVectorStore } from './db'
import { isExpectedKnowledgeBaseRerankError } from './error-reporting'
import { normalizeKnowledgeBaseFileError } from './file-error'
import { getEmbeddingProvider, getRerankProvider } from './model-providers'
import { getEffectiveParserConfig, type ParserFileMeta, parseFileWithRouter } from './parsers'

const log = getLogger('knowledge-base:file-loaders')

// Parse file to MDocument using the parser router
async function parseFileToDocumentWithRouter(
  filePath: string,
  fileMeta: ParserFileMeta,
  kbId: number,
  parserConfig: DocumentParserConfig
): Promise<{ document: MDocument; parserUsed: string }> {
  log.info(`[FILE] Parsing ${fileMeta.filename} with ${parserConfig.type} parser`)

  const result = await parseFileWithRouter(filePath, fileMeta, parserConfig, kbId)

  log.info(`[FILE] Parse completed for ${fileMeta.filename}, parser used: ${result.parserUsed}`)

  const parsedContentByteLength = Buffer.byteLength(result.content, 'utf8')
  if (parsedContentByteLength > KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE) {
    log.info(
      `[FILE] Parsed content too large: filename=${fileMeta.filename}, bytes=${parsedContentByteLength}, limit=${KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE}`
    )
    throw new Error(KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR)
  }

  // Convert content to MDocument based on content type
  const document = MDocument.fromText(result.content)
  return { document, parserUsed: result.parserUsed }
}

// Use mastra to parse, chunk, embed, and store files
export async function processFileWithMastra(
  filePath: string,
  fileMeta: { fileId: number; filename: string; mimeType: string },
  kbId: number,
  parserConfig: DocumentParserConfig
) {
  const startTime = Date.now()
  log.debug(
    `[FILE] Starting file processing: ${fileMeta.filename} (id=${fileMeta.fileId}, parser=${parserConfig.type})`
  )

  try {
    const db = getDatabase()

    // Check current processing status and get processed chunk count
    const fileRecord = await db.execute('SELECT chunk_count, total_chunks, status FROM kb_file WHERE id = ?', [
      fileMeta.fileId,
    ])
    const currentChunkCount = (fileRecord.rows[0]?.chunk_count as number) || 0
    const currentTotalChunks = (fileRecord.rows[0]?.total_chunks as number) || 0

    // 1. Parse file using the parser router
    const parseResult = await parseFileToDocumentWithRouter(filePath, fileMeta, kbId, parserConfig)
    const doc = parseResult.document
    const parserUsed = parseResult.parserUsed

    // Update parser_type in database
    await db.execute({
      sql: 'UPDATE kb_file SET parser_type = ? WHERE id = ?',
      args: [parserUsed, fileMeta.fileId],
    })

    // 2. Chunking
    const allChunks = await doc.chunk({
      strategy: 'recursive',
      maxSize: 1200,
      overlap: 150,
    })

    if (!allChunks || allChunks.length === 0) {
      // Cloud parsing (chatbox-ai, mineru) resulted in 0 chunks - mark as done (truly empty file)
      // Local parsing resulted in 0 chunks - mark as failed so user can retry with server parsing
      if (parserConfig.type === 'chatbox-ai' || parserConfig.type === 'mineru') {
        await db.execute({
          sql: 'UPDATE kb_file SET chunk_count = 0, status = ? WHERE id = ?',
          args: ['done', fileMeta.fileId],
        })
      } else {
        throw new Error('No content extracted from file')
      }
      return
    }

    // Record total chunks if not already recorded
    if (currentTotalChunks === 0 || currentTotalChunks !== allChunks.length) {
      await db.execute({
        sql: 'UPDATE kb_file SET total_chunks = ? WHERE id = ?',
        args: [allChunks.length, fileMeta.fileId],
      })
      log.debug(`[FILE] Recorded total chunks: ${allChunks.length} for file ${fileMeta.fileId}`)
    }

    log.debug(`[FILE] Processing progress: ${currentChunkCount}/${allChunks.length} chunks already processed`)

    // 3. Check if processing is already complete
    if (currentChunkCount >= allChunks.length) {
      log.info(`[FILE] File already fully processed: ${fileMeta.filename} (id=${fileMeta.fileId})`)
      return
    }

    // 4. Get remaining chunks to process
    const remainingChunks = allChunks.slice(currentChunkCount)
    log.debug(`[FILE] Processing remaining ${remainingChunks.length} chunks from index ${currentChunkCount}`)

    // 5. If no remaining chunks, processing is complete
    if (remainingChunks.length === 0) {
      log.info(`[FILE] File processing already complete: ${fileMeta.filename} (id=${fileMeta.fileId})`)
      return
    }

    // 6. Process remaining chunks in batches
    const embeddingInstance = await getEmbeddingProvider(kbId)
    const vectorStore = getVectorStore()
    const indexName = `kb_${kbId}`
    const BATCH_SIZE = 50 // Process chunks in batches of 50

    // Ensure vector index exists by getting dimension from first remaining chunk
    const firstEmbedding = await embedMany({
      model: embeddingInstance,
      values: [`filename: ${fileMeta.filename}\nchunk:\n${remainingChunks[0].text}`],
      // Embeddings are billable; network-error retries could double-charge.
      maxRetries: 0,
    })
    await vectorStore.createIndex({ indexName, dimension: firstEmbedding.embeddings[0].length })

    for (let i = 0; i < remainingChunks.length; i += BATCH_SIZE) {
      // Check if file has been paused before processing each batch
      const statusCheck = await db.execute('SELECT status FROM kb_file WHERE id = ?', [fileMeta.fileId])
      const currentStatus = statusCheck.rows[0]?.status as string
      if (currentStatus === 'paused') {
        log.info(`[FILE] File processing paused by user: ${fileMeta.filename} (id=${fileMeta.fileId})`)
        return
      }

      const batchChunks = remainingChunks.slice(i, i + BATCH_SIZE)
      const batchTexts = batchChunks.map((chunk: any) => `filename: ${fileMeta.filename}\nchunk:\n${chunk.text}`)

      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(remainingChunks.length / BATCH_SIZE)
      log.debug(`[FILE] Processing batch ${batchNumber}/${totalBatches}, chunks: ${batchTexts.length}`)

      // Generate embeddings for this batch
      const embeddingResult = await embedMany({
        model: embeddingInstance,
        values: batchTexts,
        // Embeddings are billable; network-error retries could double-charge.
        maxRetries: 0,
      })

      if (!embeddingResult.embeddings || embeddingResult.embeddings.length !== batchTexts.length) {
        throw new Error(
          `Embedding batch failed: expected ${batchTexts.length}, got ${embeddingResult.embeddings?.length || 0}`
        )
      }

      // Store vectors for this batch
      log.debug(`[FILE] Storing batch ${batchNumber}/${totalBatches} to vector store`)
      await vectorStore.upsert({
        indexName,
        vectors: embeddingResult.embeddings,
        metadata: batchChunks.map((chunk: any, chunkIndex: number) => ({
          text: chunk.text,
          fileId: fileMeta.fileId,
          filename: fileMeta.filename,
          mimeType: fileMeta.mimeType,
          chunkIndex: currentChunkCount + i + chunkIndex, // Use absolute chunk index
        })),
      })

      // Update processed chunk count in database
      const newChunkCount = currentChunkCount + i + batchChunks.length
      await db.execute({
        sql: 'UPDATE kb_file SET chunk_count = ? WHERE id = ?',
        args: [newChunkCount, fileMeta.fileId],
      })

      log.debug(`[FILE] Updated chunk count to ${newChunkCount} for file ${fileMeta.fileId}`)

      // Small delay between batches to avoid overwhelming the API
      if (i + BATCH_SIZE < remainingChunks.length) {
        await setTimeout(100) // 100ms delay between batches
      }
    }

    const duration = Date.now() - startTime
    log.info(
      `[FILE] File processed successfully: ${fileMeta.filename} (id=${fileMeta.fileId}), total chunks: ${allChunks.length}, duration: ${duration}ms`
    )
    // Mark as done and clear processing timestamp
    await db.execute({
      sql: 'UPDATE kb_file SET status = ?, processing_started_at = NULL WHERE id = ?',
      args: ['done', fileMeta.fileId],
    })
  } catch (error: unknown) {
    const errMsg =
      error instanceof Error
        ? error.message
        : typeof error === 'object' &&
            error !== null &&
            'message' in error &&
            typeof (error as Record<string, unknown>).message === 'string'
          ? ((error as Record<string, unknown>).message as string)
          : String(error)
    const duration = Date.now() - startTime
    log.error(`[FILE] File processing failed after ${duration}ms: ${fileMeta.filename} (id=${fileMeta.fileId})`, error)

    // Determine the operation type based on error message for better debugging
    let operation = 'file_processing'
    if (errMsg.includes('parse')) {
      operation = 'file_parsing'
    } else if (errMsg.includes('chunk')) {
      operation = 'document_chunking'
    } else if (errMsg.includes('embedding')) {
      operation = 'generate_embeddings'
    } else if (errMsg.includes('store') || errMsg.includes('vector')) {
      operation = 'vector_storage'
    } else if (errMsg.includes('vision') || errMsg.includes('OCR') || errMsg.includes('image')) {
      operation = 'image_ocr_processing'
    }

    // Report processing failures to Sentry with unified context
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-file')
      scope.setTag('operation', operation)
      scope.setExtra('fileId', fileMeta.fileId)
      scope.setExtra('filename', fileMeta.filename)
      scope.setExtra('mimeType', fileMeta.mimeType)
      scope.setExtra('kbId', kbId)
      scope.setExtra('duration', duration)
      scope.setExtra('filePath', filePath)
      sentry.captureException(error)
    })

    throw error
  }
}

async function processPendingFiles() {
  try {
    // First check for timed out processing files
    await checkProcessingTimeouts()

    const db = getDatabase()
    // Query pending files with their KB's parser config
    const rs = await db.execute(
      `
      SELECT f.*, kb.document_parser as kb_document_parser
      FROM kb_file f
      JOIN knowledge_base kb ON f.kb_id = kb.id
      WHERE f.status = ?
    `,
      ['pending']
    )

    if (rs.rows.length === 0) {
      return
    }

    log.debug(`[FILE] Processing ${rs.rows.length} pending files`)

    for (const file of rs.rows) {
      const useRemoteParsing = Boolean(file.use_remote_parsing)

      // Parse KB parser config
      let kbParserConfig: DocumentParserConfig | undefined
      if (file.kb_document_parser) {
        try {
          kbParserConfig = JSON.parse(file.kb_document_parser as string)
        } catch {
          log.warn(`[FILE] Failed to parse KB document_parser config for file ${file.id}`)
        }
      }

      // Get effective parser config
      // When useRemoteParsing is true (user clicked "Retry with server parsing"), force use Chatbox AI parser
      // This overrides the KB's configured parser to ensure server parsing is used
      const effectiveParserConfig: DocumentParserConfig = useRemoteParsing
        ? { type: 'chatbox-ai' }
        : getEffectiveParserConfig(kbParserConfig)

      try {
        log.debug(
          `[FILE] Processing file: ${file.filename} (id=${file.id}, parser=${effectiveParserConfig.type}, useRemoteParsing=${useRemoteParsing})`
        )

        // Mark as processing, record the processing start time, save parsing method and parser_type, and clear the use_remote_parsing flag
        // We set parser_type here at the start so that if parsing fails, the error message will correctly show which parser was used
        await db.execute({
          sql: 'UPDATE kb_file SET status = ?, processing_started_at = CURRENT_TIMESTAMP, use_remote_parsing = 0, parsed_remotely = ?, parser_type = ? WHERE id = ?',
          args: ['processing', useRemoteParsing ? 1 : 0, effectiveParserConfig.type, file.id],
        })

        // Use mastra to parse, chunk, embed, and store (supports resuming from chunk_count)
        await processFileWithMastra(
          file.filepath as string,
          { fileId: file.id as number, filename: file.filename as string, mimeType: file.mime_type as string },
          file.kb_id as number,
          effectiveParserConfig
        )
      } catch (err: any) {
        log.error(`[FILE] File processing failed: ${file.filename} (id=${file.id})`, err)
        // Mark as failed - parse error message to extract user-friendly message
        const rawErrorMessage = err instanceof Error ? err.message : String(err)
        const errorMessage = normalizeKnowledgeBaseFileError(rawErrorMessage)
        await db.execute({
          sql: 'UPDATE kb_file SET status = ?, error = ?, processing_started_at = NULL WHERE id = ?',
          args: ['failed', errorMessage, file.id],
        })

        // Report individual file processing failures
        sentry.withScope((scope) => {
          scope.setTag('component', 'knowledge-base-file')
          scope.setTag('operation', 'individual_file_processing')
          scope.setExtra('fileId', file.id)
          scope.setExtra('filename', file.filename)
          scope.setExtra('kbId', file.kb_id)
          scope.setExtra('parserType', effectiveParserConfig.type)
          sentry.captureException(err)
        })
      }
    }
  } catch (error: unknown) {
    log.error('[FILE] Failed to process pending files:', error)
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-file')
      scope.setTag('operation', 'process_pending_files')
      sentry.captureException(error)
    })
  }
}

// Periodic polling
export async function startWorkerLoop() {
  log.info('[FILE] Starting worker loop')

  while (true) {
    try {
      await processPendingFiles()
    } catch (e: unknown) {
      log.error('[FILE] Worker loop error:', e)
      sentry.withScope((scope) => {
        scope.setTag('component', 'knowledge-base-file')
        scope.setTag('operation', 'worker_loop')
        sentry.captureException(e)
      })

      // Wait before retrying to prevent rapid error loops
      await setTimeout(10000) // 10 seconds
    }
    await setTimeout(3000) // Poll every 3 seconds
  }
}

// Search interface, embeddingProvider parameter is required
export async function searchKnowledgeBase(kbId: number, query: string) {
  try {
    log.debug(`[FILE] Searching knowledge base: kbId=${kbId}, query=${query}`)
    const embeddingInstance = await getEmbeddingProvider(kbId)
    const embedding = await embedMany({
      model: embeddingInstance,
      values: [query],
      // Embeddings are billable; network-error retries could double-charge.
      maxRetries: 0,
    })
    const vectorStore = getVectorStore()
    const indexName = `kb_${kbId}`
    const results = await vectorStore.query({
      indexName,
      queryVector: embedding.embeddings[0],
      topK: 20,
    })
    try {
      const rerankInstance = await getRerankProvider(kbId)
      if (rerankInstance) {
        const rerankedResults = await rerank(results, query, rerankInstance, {
          topK: 5,
        })
        return rerankedResults.map((r) => ({
          id: r.result.id,
          score: r.result.score,
          ...r.result.metadata,
        }))
      }
      return results.map((r) => ({
        id: r.id,
        score: r.score,
        ...r.metadata,
      }))
    } catch (e) {
      const expectedRerankError = isExpectedKnowledgeBaseRerankError(e)
      const logMessage = `[FILE] Failed to rerank: kbId=${kbId}, queryLength=${query.length}`

      if (expectedRerankError) {
        log.warn(logMessage, e)
      } else {
        log.error(logMessage, e)
        sentry.withScope((scope) => {
          scope.setTag('component', 'knowledge-base-file')
          scope.setTag('operation', 'rerank')
          scope.setExtra('kbId', kbId)
          scope.setExtra('queryLength', query.length)
          sentry.captureException(e)
        })
      }
      return results.map((r) => ({
        id: r.id,
        score: r.score,
        ...r.metadata,
      }))
    }
  } catch (e) {
    log.error(`[FILE] Failed to search: kbId=${kbId}, queryLength=${query.length}`, e)

    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-file')
      scope.setTag('operation', 'search_knowledge_base')
      scope.setExtra('kbId', kbId)
      scope.setExtra('queryLength', query.length)
      sentry.captureException(e)
    })

    throw new Error(`Failed to search knowledge base (id: ${kbId}). Please try again later.`)
  }
}

// Read chunks from vector store
export async function readChunks(kbId: number, chunks: { fileId: number; chunkIndex: number }[]) {
  try {
    log.debug(`[FILE] Reading chunks: kbId=${kbId}, chunks=${chunks.length}`)

    if (!chunks || chunks.length === 0) {
      return []
    }

    const indexName = `kb_${kbId}`
    const results: any[] = []

    // Use single SQL query to get all chunks at once
    log.debug(`[FILE] Using single SQL query via vectorStore.turso for ${chunks.length} chunks`)

    const vectorStore = getVectorStore()
    // Build composite IN condition to avoid SQLite's 999 variable limit
    const valuePlaceholders = chunks.map(() => '(?,?)').join(',')
    const condition = `(json_extract(metadata, '$.fileId'), json_extract(metadata, '$.chunkIndex')) IN (${valuePlaceholders})`

    // Flatten chunk parameters for the query
    const args = chunks.flatMap((c) => [c.fileId, c.chunkIndex])

    const sql = `SELECT metadata FROM ${indexName} WHERE ${condition}`
    log.debug(`[FILE] Executing SQL: ${sql}`)
    log.debug(`[FILE] With args:`, args)

    const queryResult = await (vectorStore as any).turso.execute({
      sql,
      args,
    })

    log.debug(`[FILE] Single SQL query returned ${queryResult.rows.length} results`)

    // Parse results and maintain the order requested by chunks array
    const foundChunks = queryResult.rows.map((row: any) => {
      const metadata = JSON.parse(row.metadata as string)
      return {
        fileId: metadata.fileId,
        filename: metadata.filename,
        chunkIndex: metadata.chunkIndex,
        text: metadata.text,
      }
    })

    // Maintain the order of the requested chunks
    for (const chunk of chunks) {
      const found = foundChunks.find(
        (fc: any) => Number(fc.fileId) === Number(chunk.fileId) && Number(fc.chunkIndex) === Number(chunk.chunkIndex)
      )
      if (found) {
        results.push(found)
      }
    }

    return results
  } catch (sqlErr: any) {
    log.error(`[FILE] Single SQL query failed:`, sqlErr)
    sentry.withScope((scope) => {
      scope.setTag('component', 'knowledge-base-file')
      scope.setTag('operation', 'read_chunks')
      scope.setExtra('kbId', kbId)
      scope.setExtra('chunkCount', chunks.length)
      sentry.captureException(sqlErr)
    })
    throw sqlErr
  }
}
