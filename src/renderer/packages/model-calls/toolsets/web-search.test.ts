import { ChatboxAIAPIError } from '@shared/models/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getLicenseKeyMock = vi.fn()
const getExtensionSettingsMock = vi.fn()
const parseUserLinkProMock = vi.fn()
const getStoreBlobMock = vi.fn()
const getParseLinkProviderMock = vi.fn()
const webSearchExecutorMock = vi.fn()

vi.mock('@/stores/settingActions', () => ({
  getLicenseKey: () => getLicenseKeyMock(),
  getExtensionSettings: () => getExtensionSettingsMock(),
}))

vi.mock('@/packages/remote', () => ({
  parseUserLinkPro: (...args: unknown[]) => parseUserLinkProMock(...args),
}))

vi.mock('@/platform', () => ({
  default: {
    getStoreBlob: (...args: unknown[]) => getStoreBlobMock(...args),
  },
}))

vi.mock('@/packages/web-search', () => ({
  getParseLinkProvider: () => getParseLinkProviderMock(),
  webSearchExecutor: (...args: unknown[]) => webSearchExecutorMock(...args),
}))

// Import after mocks are registered
import { parseLinkTool } from '@/packages/model-calls/toolsets/web-search'

type ParseLinkInput = { url: string; maxLength?: number }

type ParseLinkToolLike = {
  execute: (input: ParseLinkInput, context: { abortSignal?: AbortSignal }) => Promise<{
    url: string
    title: string
    content: string
    originalLength: number
    truncated: boolean
  }>
}

async function execParseLink(input: ParseLinkInput, abortSignal?: AbortSignal) {
  // The `tool()` wrapper from `ai` exposes `execute` directly on the returned object.
  return await (parseLinkTool as unknown as ParseLinkToolLike).execute(input, { abortSignal })
}

describe('parseLinkTool', () => {
  beforeEach(() => {
    getLicenseKeyMock.mockReset()
    getExtensionSettingsMock.mockReset()
    parseUserLinkProMock.mockReset()
    getStoreBlobMock.mockReset()
    getParseLinkProviderMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('build-in (Chatbox AI) provider', () => {
    beforeEach(() => {
      getExtensionSettingsMock.mockReturnValue({ webSearch: { provider: 'build-in' } })
    })

    it('throws license key required when no license is configured', async () => {
      getLicenseKeyMock.mockReturnValue('')

      await expect(execParseLink({ url: 'https://example.com' })).rejects.toMatchObject({
        detail: { name: 'chatbox_search_license_key_required' },
      })
      expect(parseUserLinkProMock).not.toHaveBeenCalled()
      expect(getParseLinkProviderMock).not.toHaveBeenCalled()
    })

    it('calls Chatbox AI remote API for any licensed user (no Pro check)', async () => {
      // Lite users can call parse_link too — backend has no Pro restriction.
      getLicenseKeyMock.mockReturnValue('lk-lite-123')
      parseUserLinkProMock.mockResolvedValue({
        key: 'uuid-1',
        title: 'Example Title',
        storageKey: 'storage-key-1',
      })
      getStoreBlobMock.mockResolvedValue('  Hello world from the page.  ')

      const result = await execParseLink({ url: 'https://example.com' })

      expect(parseUserLinkProMock).toHaveBeenCalledWith({
        licenseKey: 'lk-lite-123',
        url: 'https://example.com',
        abortSignal: undefined,
      })
      expect(getParseLinkProviderMock).not.toHaveBeenCalled()
      expect(result).toEqual({
        url: 'https://example.com',
        title: 'Example Title',
        content: 'Hello world from the page.',
        originalLength: 'Hello world from the page.'.length,
        truncated: false,
      })
    })

    it('truncates content to maxLength', async () => {
      getLicenseKeyMock.mockReturnValue('lk-123')
      parseUserLinkProMock.mockResolvedValue({ key: 'k', title: 't', storageKey: 's' })
      const longContent = 'a'.repeat(20_000)
      getStoreBlobMock.mockResolvedValue(longContent)

      const result = await execParseLink({ url: 'https://example.com', maxLength: 500 })

      expect(result.content.length).toBe(500)
      expect(result.originalLength).toBe(20_000)
      expect(result.truncated).toBe(true)
    })

    it('forwards abortSignal to remote.parseUserLinkPro', async () => {
      getLicenseKeyMock.mockReturnValue('lk-123')
      parseUserLinkProMock.mockResolvedValue({ key: 'k', title: 't', storageKey: 's' })
      getStoreBlobMock.mockResolvedValue('content')
      const controller = new AbortController()

      await execParseLink({ url: 'https://example.com' }, controller.signal)

      expect(parseUserLinkProMock).toHaveBeenCalledWith({
        licenseKey: 'lk-123',
        url: 'https://example.com',
        abortSignal: controller.signal,
      })
    })

    it('clamps maxLength below minimum (500) and above maximum (50000)', async () => {
      getLicenseKeyMock.mockReturnValue('lk-123')
      parseUserLinkProMock.mockResolvedValue({ key: 'k', title: 't', storageKey: 's' })
      const longContent = 'a'.repeat(60_000)
      getStoreBlobMock.mockResolvedValue(longContent)

      // Below min: 100 should clamp to 500
      const tooSmall = await execParseLink({ url: 'https://example.com', maxLength: 100 })
      expect(tooSmall.content.length).toBe(500)

      // Above max: 999_999 should clamp to 50_000
      const tooBig = await execParseLink({ url: 'https://example.com', maxLength: 999_999 })
      expect(tooBig.content.length).toBe(50_000)
    })
  })

  describe('third-party provider (e.g. Tavily)', () => {
    beforeEach(() => {
      getExtensionSettingsMock.mockReturnValue({ webSearch: { provider: 'tavily' } })
    })

    it('routes to provider.parseLink and forwards abortSignal', async () => {
      const parseLinkMock = vi.fn().mockResolvedValue({
        url: 'https://example.com',
        title: 'Tavily Title',
        content: 'Extracted page content.',
      })
      getParseLinkProviderMock.mockReturnValue({ parseLink: parseLinkMock })
      const controller = new AbortController()

      const result = await execParseLink({ url: 'https://example.com' }, controller.signal)

      expect(parseLinkMock).toHaveBeenCalledWith('https://example.com', controller.signal)
      expect(parseUserLinkProMock).not.toHaveBeenCalled()
      expect(getLicenseKeyMock).not.toHaveBeenCalled()
      expect(result).toEqual({
        url: 'https://example.com',
        title: 'Tavily Title',
        content: 'Extracted page content.',
        originalLength: 'Extracted page content.'.length,
        truncated: false,
      })
    })

    it('propagates underlying provider errors (e.g. missing API key)', async () => {
      const apiKeyError = ChatboxAIAPIError.fromCodeName('tavily_api_key_required', 'tavily_api_key_required')
      getParseLinkProviderMock.mockImplementation(() => {
        throw apiKeyError
      })

      await expect(execParseLink({ url: 'https://example.com' })).rejects.toMatchObject({
        detail: { name: 'tavily_api_key_required' },
      })
    })

    it('throws parse_link_not_supported when no provider has the capability', async () => {
      getParseLinkProviderMock.mockReturnValue(null)

      await expect(execParseLink({ url: 'https://example.com' })).rejects.toMatchObject({
        detail: { name: 'parse_link_not_supported' },
      })
    })

    it('throws parse_link_failed when provider returns null', async () => {
      getParseLinkProviderMock.mockReturnValue({ parseLink: vi.fn().mockResolvedValue(null) })

      await expect(execParseLink({ url: 'https://example.com' })).rejects.toMatchObject({
        detail: { name: 'parse_link_failed' },
      })
    })

    it('truncates third-party result to maxLength', async () => {
      const longContent = 'b'.repeat(15_000)
      getParseLinkProviderMock.mockReturnValue({
        parseLink: vi.fn().mockResolvedValue({
          url: 'https://example.com',
          title: 't',
          content: longContent,
        }),
      })

      const result = await execParseLink({ url: 'https://example.com', maxLength: 5_000 })

      expect(result.content.length).toBe(5_000)
      expect(result.originalLength).toBe(15_000)
      expect(result.truncated).toBe(true)
    })
  })
})
