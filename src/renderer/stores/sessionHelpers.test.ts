import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  blobStore,
  licenseState,
  licenseActivationState,
  authTokensState,
  sessionRagCapabilityState,
  parserState,
  defaultEmbeddingModelState,
  mockParseFileLocally,
  mockParseFileWithMineru,
  mockGetSessionRagConfig,
  mockUploadAndCreateUserFile,
  mockSetBlob,
  mockGetBlob,
  mockDelBlob,
  mockSetItem,
  mockGetItem,
  mockReportError,
  mockCleanupOrphanedBlobs,
} = vi.hoisted(() => {
  const blobs = new Map<string, string>()
  const license = { key: 'licensed-key' as string | undefined }
  const licenseActivation = { method: 'manual' as 'login' | 'manual' | undefined }
  const authTokens = { hasTokens: true }
  const sessionRagCapability = { enabled: true }
  const parser = { type: 'local' as 'local' | 'chatbox-ai' | 'none' | 'mineru' }
  const defaultEmbeddingModel = {
    value: undefined as { provider: string; model: string } | undefined,
  }

  return {
    blobStore: blobs,
    licenseState: license,
    licenseActivationState: licenseActivation,
    authTokensState: authTokens,
    sessionRagCapabilityState: sessionRagCapability,
    parserState: parser,
    defaultEmbeddingModelState: defaultEmbeddingModel,
    mockParseFileLocally: vi.fn(),
    mockParseFileWithMineru: vi.fn(),
    mockGetSessionRagConfig: vi.fn(async () => ({
      models: { embedding: 'chatbox-ai:text-embedding-3-small', rerank: 'chatbox-ai:rerank' },
      capabilities: {
        session_attachment_embedding: sessionRagCapability.enabled,
        session_attachment_rerank: false,
      },
    })),
    mockUploadAndCreateUserFile: vi.fn(),
    mockSetBlob: vi.fn(async (key: string, value: string) => {
      blobs.set(key, value)
    }),
    mockGetBlob: vi.fn(async (key: string) => blobs.get(key) ?? null),
    mockDelBlob: vi.fn(async (key: string) => {
      blobs.delete(key)
    }),
    mockSetItem: vi.fn(async () => undefined),
    mockGetItem: vi.fn(async <T>(_key: string, initialValue: T) => initialValue),
    mockReportError: vi.fn(),
    mockCleanupOrphanedBlobs: vi.fn(async () => 0),
  }
})

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    isDesktopLike: true,
    parseFileLocally: mockParseFileLocally,
    parseFileWithMineru: mockParseFileWithMineru,
  },
}))

vi.mock('@/storage', () => ({
  default: {
    getBlob: mockGetBlob,
    setBlob: mockSetBlob,
    delBlob: mockDelBlob,
    getItem: mockGetItem,
    setItem: mockSetItem,
  },
}))

vi.mock('@/packages/remote', () => ({
  getSessionRagConfig: mockGetSessionRagConfig,
  uploadAndCreateUserFile: mockUploadAndCreateUserFile,
}))

vi.mock('./settingActions', () => ({
  getLicenseKey: () => licenseState.key,
  isPro: () => Boolean(licenseState.key),
}))

vi.mock('@/stores/authInfoStore', () => ({
  authInfoStore: {
    getState: () => ({
      getTokens: () =>
        authTokensState.hasTokens ? { accessToken: 'access-token', refreshToken: 'refresh-token' } : null,
    }),
  },
}))

vi.mock('./settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      licenseKey: licenseState.key,
      licenseActivationMethod: licenseActivationState.method,
      defaultEmbeddingModel: defaultEmbeddingModelState.value,
      extension: {
        documentParser: { type: parserState.type, mineru: { apiToken: 'mineru-token' } },
      },
    }),
  },
  getPlatformDefaultDocumentParser: () => ({ type: 'local' }),
}))

vi.mock('./lastUsedModelStore', () => ({
  lastUsedModelStore: {
    getState: () => ({
      chat: undefined,
    }),
  },
}))

vi.mock('@/packages/token', () => ({
  estimateTokens: (text: string) => text.length,
  getTokenizerType: () => 'default',
}))

vi.mock('@/lib/utils', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@/utils/sentry', () => ({
  reportError: mockReportError,
}))

vi.mock('@/setup/storage_clear', () => ({
  cleanupOrphanedBlobs: mockCleanupOrphanedBlobs,
}))

vi.mock('@/lib/format-chat', () => ({
  formatChatAsHtml: vi.fn(),
  formatChatAsMarkdown: vi.fn(),
  formatChatAsTxt: vi.fn(),
}))

vi.mock('@/i18n', () => ({
  default: {},
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { initialize: vi.fn(), repository: { meta: {} } },
  },
}))

import {
  isSessionAttachmentRagAuthError,
  isSessionAttachmentRagIndexingError,
  prepareFileAttachment,
  SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING,
  SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH,
  SESSION_ATTACHMENT_RAG_REQUIRES_CHATBOX_AI_ERROR,
} from './sessionHelpers'

function createFile(name: string, content = 'binary-content'): File {
  const file = new File([content], name, { type: 'application/pdf', lastModified: 1700000000000 })
  Object.defineProperty(file, 'path', {
    value: `/tmp/${name}`,
    configurable: true,
  })
  return file
}

describe('preprocessFile local parser fallback', () => {
  beforeEach(() => {
    blobStore.clear()
    licenseState.key = 'licensed-key'
    licenseActivationState.method = 'manual'
    authTokensState.hasTokens = true
    sessionRagCapabilityState.enabled = true
    parserState.type = 'local'
    defaultEmbeddingModelState.value = undefined
    mockParseFileLocally.mockReset()
    mockParseFileWithMineru.mockReset()
    mockGetSessionRagConfig.mockClear()
    mockUploadAndCreateUserFile.mockReset()
    mockSetBlob.mockReset()
    mockSetBlob.mockImplementation(async (key: string, value: string) => {
      blobStore.set(key, value)
    })
    mockGetBlob.mockClear()
    mockDelBlob.mockClear()
    mockSetItem.mockClear()
    mockGetItem.mockClear()
    mockReportError.mockClear()
    mockCleanupOrphanedBlobs.mockReset()
    mockCleanupOrphanedBlobs.mockResolvedValue(0)
  })

  it('falls back to Chatbox AI when local parsing throws and a license is active', async () => {
    const file = createFile('report.pdf')
    blobStore.set('remote-key', 'remote parsed content')
    mockParseFileLocally.mockRejectedValueOnce(new Error('local failed'))
    mockUploadAndCreateUserFile.mockResolvedValueOnce('remote-key')

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockParseFileLocally).toHaveBeenCalledWith(file)
    expect(mockUploadAndCreateUserFile).toHaveBeenCalledWith('licensed-key', file)
    expect(result.error).toBeUndefined()
    expect(result.content).toBe('remote parsed content')
    expect(result.storageKey).toBe(`file:/tmp/${file.name}-${file.size}-${file.lastModified}`)
  })

  it('falls back to Chatbox AI when local parsing returns empty content and a license is active', async () => {
    const file = createFile('empty.pdf')
    blobStore.set('local-key', '   \n\t')
    blobStore.set('remote-key', 'remote recovered content')
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })
    mockUploadAndCreateUserFile.mockResolvedValueOnce('remote-key')

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockParseFileLocally).toHaveBeenCalledWith(file)
    expect(mockUploadAndCreateUserFile).toHaveBeenCalledWith('licensed-key', file)
    expect(result.error).toBeUndefined()
    expect(result.content).toBe('remote recovered content')
  })

  it('rejects empty content returned by the Chatbox AI fallback', async () => {
    const file = createFile('empty-cloud-result.pdf')
    blobStore.set('local-key', '   \n\t')
    blobStore.set('remote-key', '   \n\t')
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })
    mockUploadAndCreateUserFile.mockResolvedValueOnce('remote-key')

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockUploadAndCreateUserFile).toHaveBeenCalledWith('licensed-key', file)
    expect(result.content).toBe('')
    expect(result.storageKey).toBe('')
    expect(result.error).toBe('empty_attachment_content')
  })

  it('falls back to Chatbox AI for text files when local parsing fails', async () => {
    const file = createFile('readme.txt', 'text content')
    blobStore.set('remote-key', 'remote text content')
    mockParseFileLocally.mockRejectedValueOnce(new Error('local failed'))
    mockUploadAndCreateUserFile.mockResolvedValueOnce('remote-key')

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockUploadAndCreateUserFile).toHaveBeenCalledWith('licensed-key', file)
    expect(result.error).toBeUndefined()
    expect(result.content).toBe('remote text content')
  })

  it('does not fall back to Chatbox AI for pasted text when local processing fails', async () => {
    const file = createFile('pasted_text_123.txt', 'pasted text content')
    mockParseFileLocally.mockRejectedValueOnce(new Error('local failed'))

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' }, { source: 'pasted-text' })

    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(result.content).toBe('')
    expect(result.storageKey).toBe('')
    expect(result.error).toBe('local_parser_failed')
  })

  it('rejects empty local content for pasted text without falling back to Chatbox AI', async () => {
    const file = createFile('pasted_text_456.txt', 'pasted text content')
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'missing-local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' }, { source: 'pasted-text' })

    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(result.content).toBe('')
    expect(result.storageKey).toBe('')
    expect(result.error).toBe('empty_attachment_content')
  })

  it('prompts for a license when local parsing throws without a key', async () => {
    const file = createFile('no-license.pdf')
    licenseState.key = undefined
    mockParseFileLocally.mockRejectedValueOnce(new Error('local failed'))

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(result.content).toBe('')
    expect(result.storageKey).toBe('')
    expect(result.error).toBe('chatbox_ai_parser_license_key_required')
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('prompts for a license when local parsing returns empty content without a key', async () => {
    const file = createFile('empty-without-license.pdf')
    licenseState.key = undefined
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'missing-local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(result.content).toBe('')
    expect(result.storageKey).toBe('')
    expect(result.error).toBe('chatbox_ai_parser_license_key_required')
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('prompts for a license when Chatbox AI parser is selected and local parsing fails without a key', async () => {
    parserState.type = 'chatbox-ai'
    const file = createFile('cloud-without-license.pdf')
    licenseState.key = undefined
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: false })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(result.content).toBe('')
    expect(result.storageKey).toBe('')
    expect(result.error).toBe('chatbox_ai_parser_license_key_required')
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('reprocesses whitespace-only cached content instead of returning an empty attachment', async () => {
    const file = createFile('cached-empty.pdf')
    const durableKey = `file:/tmp/${file.name}-${file.size}-${file.lastModified}`
    blobStore.set(durableKey, '   \n\t')
    blobStore.set('local-key', 'reparsed content')
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockParseFileLocally).toHaveBeenCalledWith(file)
    expect(result.error).toBeUndefined()
    expect(result.content).toBe('reparsed content')
  })

  it('surfaces storage quota failures without attempting a cloud fallback', async () => {
    const file = createFile('pasted_text_123.txt', 'long pasted text')
    const quotaError = new Error('Quota exceeded while writing local storage')
    quotaError.name = 'QuotaExceededError'
    mockParseFileLocally.mockRejectedValue(quotaError)

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(mockCleanupOrphanedBlobs).toHaveBeenCalledTimes(1)
    // Retry happens even when the cleanup found no orphans: space may have been
    // freed outside the cleanup's accounting (e.g. temp parse blob reclaim).
    expect(mockParseFileLocally).toHaveBeenCalledTimes(2)
    expect(result.error).toBe('file_storage_quota_exceeded')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_storage_quota_exceeded' }),
      expect.objectContaining({
        domain: 'file-attachment',
        operation: 'preprocess-file',
        priority: 'high',
        tags: expect.objectContaining({
          error_type: 'QuotaExceededError',
          file_extension: 'txt',
          file_size_bucket: 'under_100_kb',
          freed_blob_count: 0,
          preprocess_stage: 'local_parse',
          quota_recovery: 'retry_failed',
          user_error_code: 'file_storage_quota_exceeded',
        }),
      })
    )
    const [reportedError, context] = mockReportError.mock.calls[0]
    expect(reportedError.stack).not.toContain(quotaError.message)
    expect(JSON.stringify(context)).not.toContain(file.name)
    mockParseFileLocally.mockReset()
  })

  it('retries once after freeing orphaned blobs and recovers silently', async () => {
    const file = createFile('report.pdf')
    const quotaError = new Error('Quota exceeded')
    quotaError.name = 'QuotaExceededError'
    blobStore.set('local-key', 'parsed content after cleanup')
    mockParseFileLocally.mockRejectedValueOnce(quotaError)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })
    mockCleanupOrphanedBlobs.mockResolvedValueOnce(12)

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockCleanupOrphanedBlobs).toHaveBeenCalledTimes(1)
    expect(mockParseFileLocally).toHaveBeenCalledTimes(2)
    expect(result.error).toBeUndefined()
    expect(result.content).toBe('parsed content after cleanup')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_storage_quota_exceeded' }),
      expect.objectContaining({
        tags: expect.objectContaining({
          freed_blob_count: 12,
          quota_recovery: 'recovered',
        }),
      })
    )
  })

  it('surfaces the quota error when the retry after cleanup also fails', async () => {
    const file = createFile('report.pdf')
    const quotaError = new Error('Quota exceeded')
    quotaError.name = 'QuotaExceededError'
    mockParseFileLocally.mockRejectedValue(quotaError)
    mockCleanupOrphanedBlobs.mockResolvedValueOnce(3)

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockParseFileLocally).toHaveBeenCalledTimes(2)
    expect(result.error).toBe('file_storage_quota_exceeded')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_storage_quota_exceeded' }),
      expect.objectContaining({
        tags: expect.objectContaining({
          freed_blob_count: 3,
          quota_recovery: 'retry_failed',
        }),
      })
    )
    mockParseFileLocally.mockReset()
  })

  it('recovers when the retry succeeds after reclaiming space outside cleanup accounting', async () => {
    const file = createFile('report.pdf')
    const quotaError = new Error('Quota exceeded')
    quotaError.name = 'QuotaExceededError'
    blobStore.set('local-key', 'parsed content after temp reclaim')
    mockParseFileLocally.mockRejectedValueOnce(quotaError)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })
    // Cleanup finds no orphans, but the retry succeeds anyway (temp blob reclaim).
    mockCleanupOrphanedBlobs.mockResolvedValueOnce(0)

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(result.error).toBeUndefined()
    expect(result.content).toBe('parsed content after temp reclaim')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_storage_quota_exceeded' }),
      expect.objectContaining({
        tags: expect.objectContaining({
          freed_blob_count: 0,
          quota_recovery: 'recovered',
        }),
      })
    )
  })

  it('still surfaces the quota error when orphan cleanup itself fails', async () => {
    const file = createFile('report.pdf')
    const quotaError = new Error('Quota exceeded')
    quotaError.name = 'QuotaExceededError'
    mockParseFileLocally.mockRejectedValue(quotaError)
    mockCleanupOrphanedBlobs.mockRejectedValueOnce(new Error('cleanup failed'))

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    // Retry still happens: cleanup failing does not mean no space was reclaimed elsewhere.
    expect(mockParseFileLocally).toHaveBeenCalledTimes(2)
    expect(result.error).toBe('file_storage_quota_exceeded')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_storage_quota_exceeded' }),
      expect.objectContaining({
        tags: expect.objectContaining({
          cleanup_outcome: 'cleanup_failed',
          quota_recovery: 'retry_failed',
        }),
      })
    )
    mockParseFileLocally.mockReset()
  })

  it('reclaims the temporary parse blob after copying to the durable key', async () => {
    const file = createFile('report.pdf')
    blobStore.set('parseFile-temp-key', 'parsed content')
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'parseFile-temp-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(result.error).toBeUndefined()
    expect(result.content).toBe('parsed content')
    expect(mockDelBlob).toHaveBeenCalledWith('parseFile-temp-key')
    expect(blobStore.has('parseFile-temp-key')).toBe(false)
  })

  it('reclaims the temporary parse blob even when the durable write hits quota', async () => {
    const file = createFile('report.pdf')
    const quotaError = new Error('Quota exceeded')
    quotaError.name = 'QuotaExceededError'
    // Parser re-stages the temp blob on every attempt; the durable file:* write
    // always hits quota (raw-binary writes share the prefix but swallow errors).
    mockParseFileLocally.mockImplementation(async () => {
      blobStore.set('parseFile-temp-key', 'parsed content')
      return { isSupported: true, key: 'parseFile-temp-key' }
    })
    mockSetBlob.mockImplementation(async (key: string, value: string) => {
      if (key.startsWith('file:') && !key.endsWith('_raw')) {
        throw quotaError
      }
      blobStore.set(key, value)
    })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(result.error).toBe('file_storage_quota_exceeded')
    expect(mockDelBlob).toHaveBeenCalledWith('parseFile-temp-key')
    expect(blobStore.has('parseFile-temp-key')).toBe(false)
    mockParseFileLocally.mockReset()
  })

  it('classifies MinerU persistence quota failures for recovery instead of parser errors', async () => {
    const file = createFile('report.pdf')
    parserState.type = 'mineru'
    const quotaError = new Error('Quota exceeded while persisting parsed content')
    quotaError.name = 'QuotaExceededError'
    // MinerU parses successfully, but storing the parsed content hits the quota.
    // First setBlob call is the raw-binary write (errors swallowed); the second
    // one persists the MinerU content and rejects. The post-cleanup retry then
    // succeeds with the default setBlob implementation.
    mockParseFileWithMineru.mockResolvedValue({ success: true, content: 'mineru parsed content' })
    mockSetBlob
      .mockImplementationOnce(async (key: string, value: string) => {
        blobStore.set(key, value)
      })
      .mockRejectedValueOnce(quotaError)

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    // The original failure is classified as a quota error (stage: parse), and
    // the automatic retry recovers.
    expect(result.error).toBeUndefined()
    expect(result.content).toBe('mineru parsed content')
    expect(mockCleanupOrphanedBlobs).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_storage_quota_exceeded' }),
      expect.objectContaining({
        tags: expect.objectContaining({
          preprocess_stage: 'parse',
          quota_recovery: 'recovered',
          user_error_code: 'file_storage_quota_exceeded',
        }),
      })
    )
  })

  it('rejects whitespace-only content returned by MinerU', async () => {
    const file = createFile('empty-mineru.pdf')
    parserState.type = 'mineru'
    mockParseFileWithMineru.mockResolvedValueOnce({ success: true, content: '   \n\t' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(result.content).toBe('')
    expect(result.storageKey).toBe('')
    expect(result.error).toBe('empty_attachment_content')
  })

  it('preserves storage quota failures thrown during the cloud parser fallback', async () => {
    const file = createFile('report.pdf')
    const quotaError = new Error('QuotaExceededError: the current transaction exceeded its quota limitations')
    quotaError.name = 'QuotaExceededError'
    mockParseFileLocally.mockRejectedValue(new Error('local failed'))
    mockUploadAndCreateUserFile.mockRejectedValue(quotaError)

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    // Initial attempt + one post-cleanup retry
    expect(mockUploadAndCreateUserFile).toHaveBeenCalledTimes(2)
    expect(result.error).toBe('file_storage_quota_exceeded')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_storage_quota_exceeded' }),
      expect.objectContaining({
        tags: expect.objectContaining({
          error_type: 'QuotaExceededError',
          preprocess_stage: 'cloud_parse',
          user_error_code: 'file_storage_quota_exceeded',
        }),
      })
    )
  })

  it('classifies desktop ENOSPC failures as storage quota errors', async () => {
    const file = createFile('report.pdf')
    // Desktop IPC serialization degrades the error name to plain "Error", only the message survives.
    mockParseFileLocally.mockRejectedValue(new Error("ENOSPC: no space left on device, write '/tmp/parsed'"))

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(result.error).toBe('file_storage_quota_exceeded')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_storage_quota_exceeded' }),
      expect.objectContaining({
        tags: expect.objectContaining({
          preprocess_stage: 'local_parse',
          user_error_code: 'file_storage_quota_exceeded',
        }),
      })
    )
  })

  it('reports unexpected metadata storage failures with a stable user error', async () => {
    const file = createFile('report.pdf')
    blobStore.set('local-key', 'parsed content')
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })
    mockSetItem.mockRejectedValueOnce(new Error('metadata write failed'))

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(result.error).toBe('file_preprocess_failed')
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'file_preprocess_failed' }),
      expect.objectContaining({
        tags: expect.objectContaining({
          file_extension: 'pdf',
          preprocess_stage: 'metadata_storage',
          user_error_code: 'file_preprocess_failed',
        }),
      })
    )
  })

  it('uses local parsing first when Chatbox AI parser is selected', async () => {
    parserState.type = 'chatbox-ai'
    const file = createFile('local-first.pdf')
    blobStore.set('local-key', 'local parsed content')
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockParseFileLocally).toHaveBeenCalledWith(file)
    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.content).toBe('local parsed content')
    expect(result.parserType).toBe('local')
  })

  it('falls back to Chatbox AI when Chatbox AI parser is selected and local parsing is unsupported', async () => {
    parserState.type = 'chatbox-ai'
    const file = createFile('cloud-fallback.docx')
    blobStore.set('remote-key', 'remote parsed document')
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: false })
    mockUploadAndCreateUserFile.mockResolvedValueOnce('remote-key')

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockParseFileLocally).toHaveBeenCalledWith(file)
    expect(mockUploadAndCreateUserFile).toHaveBeenCalledWith('licensed-key', file)
    expect(result.error).toBeUndefined()
    expect(result.content).toBe('remote parsed document')
    expect(result.parserType).toBe('chatbox-ai')
  })

  it('keeps high-token attachments inline when parsed content stays below byte threshold', async () => {
    const file = createFile('token-heavy.pdf')
    const parsedContent = 'a'.repeat(8000)
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('inline')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.tokenCountMap?.default).toBe(parsedContent.length)
  })

  it('uses session retrieval for over-threshold attachments when session RAG embedding is available', async () => {
    const file = createFile('licensed-large.pdf')
    const parsedContent = 'a'.repeat(256 * 1024 + 1)
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).toHaveBeenCalledWith({ licenseKey: 'licensed-key' })
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('session-retrieval')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.tokenCountMap?.default).toBeUndefined()
    expect(result.tokenCountMap?.default_preview).toBeDefined()
  })

  it('keeps over-threshold CSV attachments inline instead of session retrieval', async () => {
    const file = createFile('large-data.csv')
    const parsedContent = 'a,b,c\n'.repeat(64 * 1024)
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('inline')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.tokenCountMap?.default).toBe(parsedContent.length)
  })

  it('keeps over-threshold Excel attachments inline instead of session retrieval', async () => {
    const file = createFile('large-budget.xlsx')
    const parsedContent = 'cell text\n'.repeat(64 * 1024)
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('inline')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.tokenCountMap?.default).toBe(parsedContent.length)
  })

  it('keeps over-threshold code attachments inline instead of session retrieval', async () => {
    const file = createFile('large-app.tsx')
    const parsedContent = 'export const value = 1\n'.repeat(16 * 1024)
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('inline')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.tokenCountMap?.default).toBe(parsedContent.length)
  })

  it('keeps over-threshold attachments inline without a Chatbox license', async () => {
    const file = createFile('byok-large.pdf')
    const parsedContent = 'a'.repeat(256 * 1024 + 1)
    licenseState.key = undefined
    sessionRagCapabilityState.enabled = false
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('inline')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.sessionAttachmentBlockedReason).toBeUndefined()
    expect(result.tokenCountMap?.default).toBe(parsedContent.length)
  })

  it('uses session retrieval for over-threshold attachments without a Chatbox license when a default embedding model is configured', async () => {
    const file = createFile('byok-large.pdf')
    const parsedContent = 'a'.repeat(256 * 1024 + 1)
    licenseState.key = undefined
    sessionRagCapabilityState.enabled = false
    defaultEmbeddingModelState.value = {
      provider: 'openai',
      model: 'text-embedding-3-small',
    }
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('session-retrieval')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.tokenCountMap?.default).toBeUndefined()
    expect(result.tokenCountMap?.default_preview).toBeDefined()
  })

  it('keeps very large BYOK attachments inline with a warning', async () => {
    const file = createFile('byok-very-large.pdf')
    const parsedContent = 'a'.repeat(SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH + 1)
    licenseState.key = undefined
    sessionRagCapabilityState.enabled = false
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('inline')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.sessionAttachmentWarningReason).toBe(SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING)
    expect(result.tokenCountMap?.default).toBe(parsedContent.length)
  })

  it('keeps over-threshold attachments inline for stale login licenses without auth tokens', async () => {
    const file = createFile('stale-login-large.pdf')
    const parsedContent = 'a'.repeat(256 * 1024 + 1)
    licenseState.key = 'stale-login-license'
    licenseActivationState.method = 'login'
    authTokensState.hasTokens = false
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(mockGetSessionRagConfig).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.ragMode).toBe('inline')
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.tokenCountMap?.default).toBe(parsedContent.length)
  })

  it('recognizes raw session RAG auth failures from existing failed attachments', () => {
    expect(isSessionAttachmentRagAuthError(SESSION_ATTACHMENT_RAG_REQUIRES_CHATBOX_AI_ERROR)).toBe(true)
    expect(isSessionAttachmentRagAuthError('provider chatbox-ai not set')).toBe(true)
    expect(isSessionAttachmentRagAuthError('Missing token for rerank provider: chatbox-ai')).toBe(true)
    expect(isSessionAttachmentRagAuthError('local_parser_failed')).toBe(false)
  })

  it('recognizes raw session RAG indexing failures from existing failed attachments', () => {
    expect(isSessionAttachmentRagIndexingError('ai_provider_error')).toBe(true)
    expect(
      isSessionAttachmentRagIndexingError(
        'API Error: Status Code 400, {"error":{"code":"ai_provider_error","detail":"temporarily unavailable"}}'
      )
    ).toBe(true)
    expect(
      isSessionAttachmentRagIndexingError(
        'ConnectionFailed("Unable to open connection to local database /Users/me/databases/chatbox_session_rag_vectors.db: 14")'
      )
    ).toBe(true)
    expect(isSessionAttachmentRagIndexingError('local_parser_failed')).toBe(false)
  })

  it('keeps documents inline with a warning when parsed text exceeds the session attachment limit', async () => {
    const file = createFile('dense.pdf')
    const parsedContent = 'a'.repeat(SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH + 1)
    blobStore.set('local-key', parsedContent)
    mockParseFileLocally.mockResolvedValueOnce({ isSupported: true, key: 'local-key' })

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' })

    expect(result.error).toBeUndefined()
    expect(result.sessionAttachmentAvailability).toBe('allowed')
    expect(result.sessionAttachmentBlockedReason).toBeUndefined()
    expect(result.sessionAttachmentWarningReason).toBe(SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING)
    expect(result.ragMode).toBe('inline')
    expect(result.byteLength).toBe(SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH + 1)
    expect(result.tokenCountMap?.default).toBe(parsedContent.length)
  })

  it('backfills raw binary storage for cached non-text files', async () => {
    const file = createFile('cached.pdf', 'raw-pdf-content')
    const storageKey = `file:/tmp/${file.name}-${file.size}-${file.lastModified}`
    const rawStorageKey = `${storageKey}_raw`
    blobStore.set(storageKey, 'cached parsed content')

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' }, { agentMode: true })

    expect(result.error).toBeUndefined()
    expect(result.storageKey).toBe(storageKey)
    expect(result.rawStorageKey).toBe(rawStorageKey)
    expect(blobStore.get(rawStorageKey)).toMatch(/^data:application\/pdf;base64,/)
  })

  it('uses raw-only sandbox descriptors for supported documents when agent mode has no parser', async () => {
    parserState.type = 'none'
    const file = createFile('no-parser.pdf', 'raw-pdf-content')
    const storageKey = `file:/tmp/${file.name}-${file.size}-${file.lastModified}`
    const rawStorageKey = `${storageKey}_raw`

    const result = await prepareFileAttachment(file, { provider: '', modelId: '' }, { agentMode: true })

    expect(mockParseFileLocally).not.toHaveBeenCalled()
    expect(mockUploadAndCreateUserFile).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.content).toContain('[File: no-parser.pdf')
    expect(result.storageKey).toBe(storageKey)
    expect(result.rawStorageKey).toBe(rawStorageKey)
    expect(result.parserType).toBe('sandbox-raw')
    expect(result.tokenCountMap).toBeUndefined()
    expect(result.lineCount).toBeUndefined()
    expect(mockSetItem).not.toHaveBeenCalledWith(`${storageKey}_parserType`, 'sandbox-raw')
    expect(blobStore.get(rawStorageKey)).toMatch(/^data:application\/pdf;base64,/)
  })
})
