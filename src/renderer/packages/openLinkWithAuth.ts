import platform from '@/platform'
import { authInfoStore } from '@/stores/authInfoStore'
import { getChatboxOrigin, getWebAuthToken } from './remote'

const DEFAULT_LOCALE = 'en'
const LOCALE_ALIASES: Record<string, string> = {
  'zh-Hans': 'zh',
  'zh-Hant': 'zh-TW',
}
const SUPPORTED_LOCALES = new Set([
  'en',
  'zh',
  'zh-TW',
  'ja',
  'de',
  'fr',
  'ru',
  'pt-PT',
  'es',
  'it-IT',
  'ar',
  'nb-NO',
  'sv',
])

function normalizeTargetUrl(url: string) {
  return new URL(url, getChatboxOrigin())
}

function getLocaleFromTargetUrl(url: URL) {
  const matchedLocale = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => LOCALE_ALIASES[segment] || segment)
    .find((segment) => SUPPORTED_LOCALES.has(segment))

  return matchedLocale || DEFAULT_LOCALE
}

function buildLoginCompleteUrl(targetUrl: URL, webAuthToken: string) {
  const locale = getLocaleFromTargetUrl(targetUrl)
  const loginUrl = new URL(`/${locale}/login/complete`, targetUrl.origin)
  loginUrl.searchParams.set('web_auth_token', webAuthToken)
  loginUrl.searchParams.set('redirect', targetUrl.toString())
  return loginUrl.toString()
}

async function openExternalLink(url: string) {
  if (platform.type === 'mobile') {
    try {
      const { AppLauncher } = await import('@capacitor/app-launcher')
      await AppLauncher.openUrl({ url })
      return
    } catch (error) {
      console.warn('Failed to open link with AppLauncher, falling back to platform browser:', error)
    }
  }

  await platform.openLink(url)
}

export async function openLinkWithAuth(url: string): Promise<void> {
  const targetUrl = normalizeTargetUrl(url)
  const tokens = authInfoStore.getState().getTokens()
  const popupRef = platform.type === 'web' ? window.open('about:blank', '_blank') : null

  if (!tokens) {
    if (popupRef) {
      popupRef.location.href = targetUrl.toString()
      return
    }
    await openExternalLink(targetUrl.toString())
    return
  }

  try {
    const webAuthToken = await getWebAuthToken()
    const authUrl = buildLoginCompleteUrl(targetUrl, webAuthToken)

    if (popupRef) {
      popupRef.location.href = authUrl
      return
    }
    await openExternalLink(authUrl)
  } catch (error) {
    console.warn('Failed to generate web auth token, falling back to direct link:', error)
    if (popupRef) {
      popupRef.location.href = targetUrl.toString()
      return
    }
    await openExternalLink(targetUrl.toString())
  }
}
