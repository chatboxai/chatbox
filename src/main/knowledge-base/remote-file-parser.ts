import fs from 'node:fs'
import os from 'node:os'
import { app } from 'electron'
import { getChatboxAPIOrigin } from '../../shared/request/chatboxai_pool'
import { createAfetch } from '../../shared/request/request'
import { getSettings, store } from '../store-node'
import { getLogger } from '../util'

const log = getLogger('knowledge-base:remote-file-parser')

// backend limit, error code 20010
const MAX_FILE_SIZE = 50 * 1024 * 1024

// Platform info for main process
function getPlatformInfo() {
  return {
    type: 'desktop',
    platform: process.platform,
    os: os.platform(),
    version: app.getVersion(),
  }
}

// Create afetch instance for main process
function getAfetch() {
  return createAfetch(getPlatformInfo())
}

// Get Chatbox API headers
function getChatboxHeaders() {
  const info = getPlatformInfo()
  return {
    'CHATBOX-PLATFORM': info.platform,
    'CHATBOX-PLATFORM-TYPE': info.type,
    'CHATBOX-OS': info.os,
    'CHATBOX-VERSION': info.version,
  }
}

/**
 * Get the license key from settings
 */
function getLicenseKey(): string | undefined {
  return store.get('settings.licenseKey') as string | undefined
}

/**
 * Generate upload URL for file
 */
async function generateUploadUrl(licenseKey: string, filename: string): Promise<{ url: string; filename: string }> {
  type Response = {
    data: {
      url: string
      filename: string
    }
  }

  const afetch = getAfetch()
  const res = await afetch(
    `${getChatboxAPIOrigin()}/api/files/generate-upload-url`,
    {
      method: 'POST',
      headers: {
        Authorization: licenseKey,
        'Content-Type': 'application/json',
        ...getChatboxHeaders(),
      },
      body: JSON.stringify({ licenseKey, filename }),
    },
    { parseChatboxRemoteError: true }
  )
  const json: Response = await res.json()
  return json.data
}

/**
 * Upload file from local path to COS using Node.js fetch
 * Unlike renderer's XMLHttpRequest, we use native fetch with Buffer
 */
async function uploadFileFromPath(filePath: string, uploadUrl: string, mimeType: string): Promise<void> {
  const fileBuffer = await fs.promises.readFile(filePath)

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Length': fileBuffer.length.toString(),
    },
    body: new Uint8Array(fileBuffer),
  })

  if (!response.ok) {
    throw new Error(`File upload failed with status ${response.status}`)
  }
}

/**
 * Create file record and get parsed content from backend
 */
async function createAndParseFile(
  licenseKey: string,
  filename: string,
  filetype: string
): Promise<{ uuid: string; content: string }> {
  type Response = {
    data: {
      uuid: string
      content: string
    }
  }

  const afetch = getAfetch()
  const res = await afetch(
    `${getChatboxAPIOrigin()}/api/files/create`,
    {
      method: 'POST',
      headers: {
        Authorization: licenseKey,
        'Content-Type': 'application/json',
        ...getChatboxHeaders(),
      },
      body: JSON.stringify({
        licenseKey,
        filename,
        filetype,
        returnContent: true,
      }),
    },
    { parseChatboxRemoteError: true }
  )
  const json: Response = await res.json()
  return json.data
}

/**
 * Parse file remotely using Chatbox AI backend
 * This is the main entry point for remote file parsing
 *
 * @param filePath - Local file path
 * @param filename - Original filename
 * @param mimeType - File MIME type
 * @returns Parsed text content
 */
export async function parseFileRemotely(filePath: string, filename: string, mimeType: string): Promise<string> {
  const licenseKey = getLicenseKey()
  if (!licenseKey) {
    throw new Error('License key not found for remote parsing')
  }

  const stats = await fs.promises.stat(filePath)
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`)
  }

  log.info(`[REMOTE] Starting remote parsing for: ${filename}`)

  // Step 1: Generate upload URL
  const { url: uploadUrl, filename: serverFilename } = await generateUploadUrl(licenseKey, filename)
  log.debug(`[REMOTE] Generated upload URL for: ${filename}`)

  // Step 2: Upload file to COS
  await uploadFileFromPath(filePath, uploadUrl, mimeType)
  log.debug(`[REMOTE] Uploaded file to COS: ${filename}`)

  // Step 3: Create file record and get parsed content
  const result = await createAndParseFile(licenseKey, serverFilename, mimeType)
  log.info(`[REMOTE] Remote parsing completed for: ${filename}, UUID: ${result.uuid}`)

  return result.content
}
