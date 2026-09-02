import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockHighlighter = {
  getLoadedLanguages: () => string[]
  loadLanguage: ReturnType<typeof vi.fn>
  codeToHtml: ReturnType<typeof vi.fn>
}

type MockShiki = {
  highlighter: MockHighlighter
  createHighlighter: ReturnType<typeof vi.fn>
  reset: () => void
}

vi.mock('shiki', () => {
  const loaded = new Set<string>()
  const bundled = new Set(['javascript', 'python'])
  const highlighter: MockHighlighter = {
    getLoadedLanguages: () => [...loaded],
    // Mirror the real full-bundle wrapper: resolving an unknown language throws
    // synchronously before any promise exists (the failure behind issue 1125).
    loadLanguage: vi.fn((lang: string) => {
      if (!bundled.has(lang)) {
        throw new Error(
          `Language \`${lang}\` is not included in this bundle. You may want to load it from external source.`
        )
      }
      loaded.add(lang)
      return Promise.resolve()
    }),
    codeToHtml: vi.fn((code: string, options: { lang: string }) => `<pre data-lang="${options.lang}">${code}</pre>`),
  }
  const createHighlighter = vi.fn(() => Promise.resolve(highlighter))
  const mockShiki: MockShiki = {
    highlighter,
    createHighlighter,
    reset: () => {
      loaded.clear()
      highlighter.loadLanguage.mockClear()
      highlighter.codeToHtml.mockClear()
      createHighlighter.mockClear()
    },
  }
  return { createHighlighter, __mockShiki: mockShiki }
})

async function getMockShiki(): Promise<MockShiki> {
  const { __mockShiki } = (await import('shiki')) as unknown as { __mockShiki: MockShiki }
  return __mockShiki
}

async function loadShikiModule() {
  const mockShiki = await getMockShiki()
  const mod = await import('./shiki')
  return { mod, mockShiki }
}

beforeEach(async () => {
  // The mock factory only runs once, so reset its state manually; resetModules
  // gives every test a fresh copy of ./shiki (caches, unknown-language memory).
  vi.resetModules()
  ;(await getMockShiki()).reset()
})

describe('shiki language fallback', () => {
  it('resolves plaintext html for a language the bundle rejects synchronously', async () => {
    const { mod } = await loadShikiModule()

    await expect(mod.highlight('SELECT 1', 'not-a-language', 'one-light')).resolves.toBe(
      '<pre data-lang="plaintext">SELECT 1</pre>'
    )
  })

  it('does not retry a rejected language on every render', async () => {
    const { mod, mockShiki } = await loadShikiModule()

    await mod.highlight('a', 'not-a-language', 'one-light')
    await mod.highlight('b', 'not-a-language', 'one-light')

    expect(mockShiki.highlighter.loadLanguage).toHaveBeenCalledTimes(1)
  })

  it('normalizes casing and whitespace before resolving the language', async () => {
    const { mod, mockShiki } = await loadShikiModule()

    await expect(mod.highlight('print(1)', ' PYTHON ', 'one-dark-pro')).resolves.toBe(
      '<pre data-lang="python">print(1)</pre>'
    )
    expect(mockShiki.highlighter.loadLanguage).toHaveBeenCalledWith('python')
  })

  it('serves the cached html for casing variants of the same language', async () => {
    const { mod, mockShiki } = await loadShikiModule()

    await mod.highlight('const a = 1', 'JavaScript', 'one-light')

    expect(mod.highlightSync('const a = 1', 'JAVASCRIPT', 'one-light')).toBe(
      '<pre data-lang="javascript">const a = 1</pre>'
    )
    expect(mockShiki.highlighter.codeToHtml).toHaveBeenCalledTimes(1)
  })

  it('lets highlightSync degrade to plaintext once a language is known to be missing', async () => {
    const { mod } = await loadShikiModule()

    await mod.highlight('a', 'not-a-language', 'one-light')

    expect(mod.highlightSync('b', 'not-a-language', 'one-light')).toBe('<pre data-lang="plaintext">b</pre>')
  })

  it('never rejects preloadLanguage for unknown languages', async () => {
    const { mod } = await loadShikiModule()

    await expect(mod.preloadLanguage('not-a-language')).resolves.toBeUndefined()
  })

  it('resolves null when rendering itself fails', async () => {
    const { mod, mockShiki } = await loadShikiModule()
    mockShiki.highlighter.codeToHtml.mockImplementationOnce(() => {
      throw new Error('tokenizer exploded')
    })

    await expect(mod.highlight('x', 'javascript', 'one-light')).resolves.toBeNull()
  })

  it('recovers after the eager highlighter warm-up fails', async () => {
    const mockShiki = await getMockShiki()
    mockShiki.createHighlighter.mockRejectedValueOnce(new Error('wasm load failed'))

    const mod = await import('./shiki')
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(mod.highlight('x', 'javascript', 'one-light')).resolves.toBe('<pre data-lang="javascript">x</pre>')
    expect(mockShiki.createHighlighter).toHaveBeenCalledTimes(2)
  })
})
