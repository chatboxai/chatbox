import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the settings actions before importing the module under test
vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: vi.fn(),
  getLanguage: vi.fn(() => 'en'),
  getLicenseKey: vi.fn(() => 'test-license-key'),
}))

// Mock the search providers to avoid actual network calls
vi.mock('./bing', () => {
  return {
    BingSearch: class {
      search = vi.fn().mockResolvedValue({
        items: [{ title: 'Bing Result', snippet: 'test', link: 'https://example.com' }],
      })
    },
  }
})

vi.mock('./bing-news', () => {
  return {
    BingNewsSearch: class {
      search = vi.fn().mockResolvedValue({ items: [] })
    },
  }
})

vi.mock('./tavily', () => {
  return {
    TavilySearch: class {
      search = vi.fn().mockResolvedValue({
        items: [{ title: 'Tavily Result', snippet: 'test', link: 'https://example.com' }],
      })
    },
  }
})

vi.mock('./anysearch', () => ({
  AnysearchSearch: class {
    constructor(
      _apiKey: string,
      private readonly maxResults: number
    ) {}

    search = vi.fn().mockImplementation(async () => ({
      items: [{ title: `Anysearch Result ${this.maxResults}`, snippet: 'test', link: 'https://example.com' }],
    }))
  },
}))

vi.mock('./chatbox-search', () => {
  return {
    ChatboxSearch: class {
      search = vi.fn().mockResolvedValue({
        items: [{ title: 'Chatbox Result', snippet: 'test', link: 'https://example.com' }],
      })
    },
  }
})

import { getExtensionSettings } from '@/stores/settingActions'
import { webSearchExecutor } from './index'

const mockGetExtensionSettings = vi.mocked(getExtensionSettings)

describe('webSearchExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns different results for different providers with same query', async () => {
    // First call with bing
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'bing', tavilyApiKey: '' },
    } as ReturnType<typeof getExtensionSettings>)

    const bingResult = await webSearchExecutor({ query: 'test query' }, {})
    expect(bingResult.searchResults).toHaveLength(1)
    expect(bingResult.searchResults[0].title).toBe('Bing Result')

    // Same query but different provider should NOT return cached bing results
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'tavily', tavilyApiKey: 'test-key' },
    } as ReturnType<typeof getExtensionSettings>)

    const tavilyResult = await webSearchExecutor({ query: 'test query' }, {})
    expect(tavilyResult.searchResults).toHaveLength(1)
    expect(tavilyResult.searchResults[0].title).toBe('Tavily Result')
  })

  it('returns cached results for same provider and query', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'bing', tavilyApiKey: '' },
    } as ReturnType<typeof getExtensionSettings>)

    const result1 = await webSearchExecutor({ query: 'cached query' }, {})
    const result2 = await webSearchExecutor({ query: 'cached query' }, {})

    // Both should return same results (cached)
    expect(result1.searchResults).toEqual(result2.searchResults)
  })

  it('does not reuse Anysearch cache entries after max results changes', async () => {
    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'anysearch', anysearchApiKey: 'key', anysearchMaxResults: 3 },
    } as ReturnType<typeof getExtensionSettings>)
    const first = await webSearchExecutor({ query: 'same Anysearch query' }, {})

    mockGetExtensionSettings.mockReturnValue({
      webSearch: { provider: 'anysearch', anysearchApiKey: 'key', anysearchMaxResults: 7 },
    } as ReturnType<typeof getExtensionSettings>)
    const second = await webSearchExecutor({ query: 'same Anysearch query' }, {})

    expect(first.searchResults[0].title).toBe('Anysearch Result 3')
    expect(second.searchResults[0].title).toBe('Anysearch Result 7')
  })
})
