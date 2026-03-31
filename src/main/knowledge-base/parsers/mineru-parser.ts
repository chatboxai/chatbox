import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { DocumentParserType } from '../../../shared/types/settings'
import { getLogger } from '../../util'
import type {
  DocumentParser,
  MineruBatchResultResponse,
  MineruBatchUploadResponse,
  MineruErrorCode,
  MineruExtractResult,
  ParserFileMeta,
} from './types'
import { MineruError } from './types'

const log = getLogger('knowledge-base:mineru-parser')

const MINERU_API_BASE = 'https://mineru.net/api/v4'
const POLL_INTERVAL_MS = 10000 // 10 seconds
const MAX_POLL_ATTEMPTS = 30 // 5 minutes total timeout
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB

/**
 * Map MinerU API error codes to internal error codes
 */
function mapErrorCode(code: string | number): MineruErrorCode {
  const codeStr = String(code)
  if (codeStr === 'A0202' || codeStr === 'A0211') {
    return 'AUTH_FAILED'
  }
  if (codeStr === '-60005' || codeStr === '-60006') {
    return 'FILE_TOO_LARGE'
  }
  if (codeStr === '-60002') {
    return 'UNSUPPORTED_FORMAT'
  }
  if (codeStr === '-60010') {
    return 'PARSE_FAILED'
  }
  return 'NETWORK_ERROR'
}

/**
 * Sleep utility with abort support
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new MineruError('Operation cancelled', 'CANCELLED'))
      return
    }

    let timeoutId: NodeJS.Timeout | undefined

    // Define abort handler so we can remove it later
    const onAbort = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      reject(new MineruError('Operation cancelled', 'CANCELLED'))
    }

    timeoutId = setTimeout(() => {
      // Remove abort listener when sleep completes normally
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * MinerU document parser implementation
 * Uses MinerU batch upload API for file parsing
 */
export class MineruParser implements DocumentParser {
  readonly type: DocumentParserType = 'mineru'

  constructor(private apiToken: string) {}

  async parse(filePath: string, meta: ParserFileMeta, signal?: AbortSignal): Promise<string> {
    const dataId = `chatbox-${meta.fileId}-${Date.now()}`

    log.info(`[MINERU] Starting parse for ${meta.filename} (dataId=${dataId})`)

    // Check if already cancelled
    if (signal?.aborted) {
      throw new MineruError('Operation cancelled', 'CANCELLED')
    }

    // Check file size
    const stats = await fs.promises.stat(filePath)
    if (stats.size > MAX_FILE_SIZE) {
      throw new MineruError(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`, 'FILE_TOO_LARGE')
    }

    // 1. Get batch upload URL
    const { batchId, uploadUrl } = await this.getBatchUploadUrl(meta.filename, dataId)
    log.debug(`[MINERU] Got upload URL for ${meta.filename}, batchId=${batchId}`)

    if (signal?.aborted) {
      throw new MineruError('Operation cancelled', 'CANCELLED')
    }

    // 2. Upload file (no Content-Type needed)
    await this.uploadFile(filePath, uploadUrl)
    log.debug(`[MINERU] Uploaded file ${meta.filename}`)

    if (signal?.aborted) {
      throw new MineruError('Operation cancelled', 'CANCELLED')
    }

    // 3. Poll for result
    const result = await this.pollBatchResult(batchId, dataId, signal)
    log.debug(`[MINERU] Got result for ${meta.filename}, state=${result.state}`)

    // 4. Download and extract markdown
    if (!result.full_zip_url) {
      throw new MineruError('No result URL returned from MinerU', 'PARSE_FAILED')
    }

    const content = await this.downloadAndExtract(result.full_zip_url)
    log.info(`[MINERU] Parse completed for ${meta.filename}, content length=${content.length}`)

    return content
  }

  /**
   * Get batch upload URL from MinerU API
   */
  private async getBatchUploadUrl(filename: string, dataId: string): Promise<{ batchId: string; uploadUrl: string }> {
    const response = await fetch(`${MINERU_API_BASE}/file-urls/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: [{ name: filename, data_id: dataId }],
        model_version: 'vlm',
        enable_formula: true,
        enable_table: true,
      }),
    })

    const data: MineruBatchUploadResponse = await response.json()

    if (data.code !== 0) {
      throw new MineruError(data.msg || 'Failed to get upload URL', mapErrorCode(data.code))
    }

    return {
      batchId: data.data.batch_id,
      uploadUrl: data.data.file_urls[0],
    }
  }

  /**
   * Upload file to MinerU OSS
   */
  private async uploadFile(filePath: string, uploadUrl: string): Promise<void> {
    const fileBuffer = await fs.promises.readFile(filePath)

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(fileBuffer),
      // Note: No Content-Type header needed per MinerU API docs
    })

    if (!response.ok) {
      throw new MineruError(`File upload failed with status ${response.status}`, 'NETWORK_ERROR')
    }
  }

  /**
   * Poll for batch parsing result
   */
  private async pollBatchResult(batchId: string, dataId: string, signal?: AbortSignal): Promise<MineruExtractResult> {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      // Check for cancellation before sleeping
      if (signal?.aborted) {
        throw new MineruError('Operation cancelled', 'CANCELLED')
      }

      await sleep(POLL_INTERVAL_MS, signal)

      // Check for cancellation after sleeping
      if (signal?.aborted) {
        throw new MineruError('Operation cancelled', 'CANCELLED')
      }

      const response = await fetch(`${MINERU_API_BASE}/extract-results/batch/${batchId}`, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
        signal, // Pass signal to fetch for network cancellation
      })

      const data: MineruBatchResultResponse = await response.json()

      if (data.code !== 0) {
        throw new MineruError(data.msg || 'Failed to get result', mapErrorCode(data.code))
      }

      // Find our file result by data_id
      const result = data.data.extract_result.find((r) => r.data_id === dataId)
      if (!result) {
        log.debug(`[MINERU] Result not found yet for dataId=${dataId}, attempt ${i + 1}/${MAX_POLL_ATTEMPTS}`)
        continue
      }

      log.debug(`[MINERU] Polling status: ${result.state} for dataId=${dataId}`)

      if (result.state === 'done') {
        return result
      }

      if (result.state === 'failed') {
        throw new MineruError(result.err_msg || 'Parsing failed', 'PARSE_FAILED')
      }

      // Continue polling for other states: waiting-file, pending, running, converting
    }

    throw new MineruError(`Polling timeout after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000} seconds`, 'TIMEOUT')
  }

  /**
   * Download ZIP and extract markdown content
   */
  private async downloadAndExtract(zipUrl: string): Promise<string> {
    // Download ZIP file
    const response = await fetch(zipUrl)
    if (!response.ok) {
      throw new MineruError(`Failed to download result: ${response.status}`, 'NETWORK_ERROR')
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Create temp directory for extraction
    const tempDir = path.join(os.tmpdir(), `mineru-${Date.now()}`)
    await fs.promises.mkdir(tempDir, { recursive: true })

    try {
      // Extract ZIP
      const zip = new AdmZip(buffer)
      zip.extractAllTo(tempDir, true)

      // Find markdown file
      const files = await this.findMarkdownFiles(tempDir)
      if (files.length === 0) {
        throw new MineruError('No markdown file found in result', 'PARSE_FAILED')
      }

      // Read the first markdown file
      const mdContent = await fs.promises.readFile(files[0], 'utf-8')
      return mdContent
    } finally {
      // Cleanup temp directory
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch((err) => {
        log.warn(`[MINERU] Failed to cleanup temp dir: ${err.message}`)
      })
    }
  }

  /**
   * Recursively find markdown files in directory
   */
  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const subResults = await this.findMarkdownFiles(fullPath)
        results.push(...subResults)
      } else if (entry.name.endsWith('.md')) {
        results.push(fullPath)
      }
    }

    return results
  }
}

/**
 * Test MinerU connection by validating the API token
 * Uses the single file extract API with an invalid URL to test token validity
 */
export async function testMineruConnection(apiToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    // We use the batch upload API with an empty files array to validate the token
    // This won't create any actual tasks but will validate the token
    const response = await fetch(`${MINERU_API_BASE}/file-urls/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: [],
        model_version: 'vlm',
      }),
    })

    const data = await response.json()

    // Check for auth errors
    if (data.msgCode === 'A0202' || data.msgCode === 'A0211') {
      return { success: false, error: 'Token invalid or expired' }
    }

    // Any other response (including error for empty files) means token is valid
    return { success: true }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, error: `Network error: ${errorMessage}` }
  }
}
