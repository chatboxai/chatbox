export type DevLaunchOptions = {
  skipGuide: boolean
  startPage: string | null
}

export type DevLaunchEnvironment = {
  [key: string]: string | undefined
  CHATBOX_SKIP_GUIDE?: string
  CHATBOX_START_PAGE?: string
}

const MAX_START_PAGE_LENGTH = 512
const SKIP_GUIDE_SEARCH_KEYS = ['skipGuide', 'skip-guide'] as const
const START_PAGE_SEARCH_KEYS = ['startPage', 'start-page'] as const

export function readCommandLineOption(argv: readonly string[], name: string): string | null {
  const option = `--${name}`
  const inlinePrefix = `${option}=`
  const inlineValue = argv.find((argument) => argument.startsWith(inlinePrefix))
  if (inlineValue) {
    return inlineValue.slice(inlinePrefix.length)
  }

  const optionIndex = argv.indexOf(option)
  if (optionIndex < 0) {
    return null
  }

  const next = argv[optionIndex + 1]
  if (next === undefined || next.startsWith('--')) {
    return null
  }
  return next
}

export function hasCommandLineFlag(argv: readonly string[], name: string): boolean {
  const option = `--${name}`
  if (argv.includes(option)) {
    return true
  }

  const inline = argv.find((argument) => argument.startsWith(`${option}=`))
  if (!inline) {
    return false
  }
  return isTruthyFlagValue(inline.slice(option.length + 1))
}

export function isTruthyFlagValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export function parseStartPage(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  let page = value.trim()
  if (!page) {
    return null
  }
  if (page.startsWith('#')) {
    page = page.slice(1)
  }
  if (!page.startsWith('/')) {
    page = `/${page}`
  }
  if (page.startsWith('//') || page.length > MAX_START_PAGE_LENGTH) {
    return null
  }
  if (hasControlCharacters(page)) {
    return null
  }
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(page) || /^[a-zA-Z][a-zA-Z+\-.]*:/.test(page.slice(1))) {
    return null
  }
  return page
}

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/'
  }
  return pathname.replace(/\/+$/, '') || '/'
}

export function splitLaunchPath(path: string): { pathname: string; search: Record<string, string> } {
  const queryIndex = path.indexOf('?')
  const rawPathname = queryIndex >= 0 ? path.slice(0, queryIndex) : path
  const pathname = rawPathname || '/'
  const search: Record<string, string> = {}
  if (queryIndex < 0) {
    return { pathname, search }
  }

  const params = new URLSearchParams(path.slice(queryIndex + 1))
  for (const [key, value] of params.entries()) {
    if ((SKIP_GUIDE_SEARCH_KEYS as readonly string[]).includes(key)) {
      continue
    }
    search[key] = value
  }
  return { pathname, search }
}

export function parseSearchParams(search: string | URLSearchParams | undefined): URLSearchParams {
  if (search instanceof URLSearchParams) {
    return search
  }
  if (!search) {
    return new URLSearchParams()
  }
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
}

export function parseDevLaunchOptions(input: {
  argv?: readonly string[]
  env?: DevLaunchEnvironment
  search?: string | URLSearchParams
}): DevLaunchOptions {
  const argv = input.argv ?? []
  const env = input.env ?? {}
  const search = parseSearchParams(input.search)

  const skipGuideFromSearch = SKIP_GUIDE_SEARCH_KEYS.some((key) => isTruthyFlagValue(search.get(key)))
  const skipGuide =
    hasCommandLineFlag(argv, 'skip-guide') || isTruthyFlagValue(env.CHATBOX_SKIP_GUIDE) || skipGuideFromSearch

  const startPage =
    parseStartPage(readCommandLineOption(argv, 'start-page')) ??
    parseStartPage(env.CHATBOX_START_PAGE) ??
    parseStartPage(firstSearchValue(search, START_PAGE_SEARCH_KEYS))

  return {
    skipGuide: skipGuide || startPage !== null,
    startPage,
  }
}

export function shouldSkipOnboardingGuide(options: DevLaunchOptions): boolean {
  return options.skipGuide || options.startPage !== null
}

export function shouldNavigateToStartPage(
  startPage: string,
  currentPathname: string,
  currentSearch?: Record<string, unknown> | null
): boolean {
  const { pathname, search } = splitLaunchPath(startPage)
  if (normalizePathname(currentPathname) !== normalizePathname(pathname)) {
    return true
  }
  return Object.entries(search).some(([key, value]) => String(currentSearch?.[key] ?? '') !== value)
}

export function buildDevLaunchHash(options: DevLaunchOptions): string | null {
  if (!shouldSkipOnboardingGuide(options)) {
    return null
  }

  const rawPath = options.startPage || '/'
  const { pathname, search } = splitLaunchPath(rawPath)
  const params = new URLSearchParams(search)
  params.set('skipGuide', '1')
  if (options.startPage) {
    params.set('startPage', options.startPage)
  }
  return `${pathname}?${params.toString()}`
}

export function applyDevLaunchHashToUrl(baseUrl: string, hash: string | null): string {
  if (!hash) {
    return baseUrl
  }
  const url = new URL(baseUrl)
  url.hash = hash.startsWith('#') ? hash : `#${hash}`
  return url.toString()
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

function firstSearchValue(search: URLSearchParams, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = search.get(key)
    if (value) {
      return value
    }
  }
  return null
}
