import type { BundledLanguage } from 'shiki'
import { createHighlighter } from 'shiki'

export type ShikiTheme = 'one-dark-pro' | 'one-light'

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>

let instance: Highlighter | null = null
let initPromise: Promise<Highlighter> | null = null

const PLAINTEXT_ALIASES = new Set(['', 'text', 'plaintext', 'txt', 'plain'])

// Shiki registers bundled languages and aliases in lowercase, but fence info
// strings arrive as typed by the model ("JS", "Python ").
function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase()
}

// Languages the bundle rejected. The full-bundle loadLanguage wrapper resolves
// grammars synchronously, so an unknown language throws instead of rejecting;
// remember it to degrade to plaintext without re-attempting on every render.
const UNKNOWN_LANGS_MAX_SIZE = 1000
const unknownLangs = new Set<string>()

function rememberUnknownLang(lang: string): void {
  if (unknownLangs.size < UNKNOWN_LANGS_MAX_SIZE) unknownLangs.add(lang)
}

const CACHE_MAX_SIZE = 50
const htmlCache = new Map<string, string>()

function cacheKey(code: string, language: string, theme: string): string {
  return `${theme}\0${language}\0${code}`
}

function cacheGet(code: string, language: string, theme: string): string | undefined {
  const key = cacheKey(code, language, theme)
  const cached = htmlCache.get(key)
  if (cached !== undefined) {
    htmlCache.delete(key)
    htmlCache.set(key, cached)
  }
  return cached
}

function cacheSet(code: string, language: string, theme: string, html: string): void {
  const key = cacheKey(code, language, theme)
  htmlCache.delete(key)
  htmlCache.set(key, html)
  if (htmlCache.size > CACHE_MAX_SIZE) {
    const oldest = htmlCache.keys().next().value
    if (oldest !== undefined) htmlCache.delete(oldest)
  }
}

function init(): Promise<Highlighter> {
  if (!initPromise) {
    initPromise = createHighlighter({
      themes: ['one-dark-pro', 'one-light'],
      langs: [],
    }).then((h) => {
      instance = h
      return h
    })
    initPromise.catch(() => {
      // Let a later highlight call retry after a failed WASM/theme load. This
      // also marks the eager warm-up rejection below as handled.
      initPromise = null
    })
  }
  return initPromise
}

void init()

const pendingLangs = new Map<string, Promise<void>>()

function resolveLangSync(h: Highlighter, lang: string): string | null {
  if (PLAINTEXT_ALIASES.has(lang) || unknownLangs.has(lang)) return 'plaintext'
  if (h.getLoadedLanguages().includes(lang)) return lang
  return null
}

async function ensureLang(h: Highlighter, lang: string): Promise<string> {
  if (PLAINTEXT_ALIASES.has(lang) || unknownLangs.has(lang)) return 'plaintext'
  if (h.getLoadedLanguages().includes(lang)) return lang

  if (!pendingLangs.has(lang)) {
    pendingLangs.set(
      lang,
      (async () => {
        try {
          await h.loadLanguage(lang as BundledLanguage)
        } catch {
          rememberUnknownLang(lang)
        } finally {
          pendingLangs.delete(lang)
        }
      })()
    )
  }
  await pendingLangs.get(lang)

  return h.getLoadedLanguages().includes(lang) ? lang : 'plaintext'
}

export async function preloadLanguage(language: string): Promise<void> {
  try {
    const h = await init()
    await ensureLang(h, normalizeLanguage(language))
  } catch (error) {
    console.error(`Failed to preload highlight language "${language}"`, error)
  }
}

export async function highlight(code: string, language: string, theme: ShikiTheme): Promise<string | null> {
  const lang = normalizeLanguage(language)
  const cached = cacheGet(code, lang, theme)
  if (cached !== undefined) return cached

  try {
    const h = await init()
    const resolvedLang = await ensureLang(h, lang)
    const html = h.codeToHtml(code, { lang: resolvedLang, theme })
    cacheSet(code, lang, theme, html)
    return html
  } catch (error) {
    // The caller renders a plain <pre> fallback; a broken highlighter must not
    // surface an unhandled rejection for every code block (issue 1125).
    console.error(`Failed to highlight code block (language: ${language})`, error)
    return null
  }
}

export function highlightSync(code: string, language: string, theme: ShikiTheme): string | null {
  const lang = normalizeLanguage(language)
  const cached = cacheGet(code, lang, theme)
  if (cached !== undefined) return cached

  if (!instance) return null
  const resolvedLang = resolveLangSync(instance, lang)
  if (!resolvedLang) return null
  try {
    const html = instance.codeToHtml(code, { lang: resolvedLang, theme })
    cacheSet(code, lang, theme, html)
    return html
  } catch {
    return null
  }
}
