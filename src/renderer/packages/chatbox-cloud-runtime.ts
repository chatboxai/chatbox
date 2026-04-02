import {
  CHATBOX_BUILD_PLATFORM,
  USE_BETA_API,
  USE_BETA_CHATBOX,
  USE_LOCAL_API,
  USE_LOCAL_CHATBOX,
} from '@/variables'

const OFFICIAL_CHATBOX_WEB_HOSTS = new Set(['chatboxai.app', 'beta.chatboxai.app'])

type BrowserRuntimeOptions = {
  buildPlatform?: string
  hostname?: string | null
  useLocalApi?: string
  useBetaApi?: string
  useLocalChatbox?: string
  useBetaChatbox?: string
}

function getCurrentHostname(): string | null {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return null
  }
  return window.location.hostname
}

function normalizeHostname(hostname: string | null | undefined): string | null {
  const normalized = hostname?.trim().toLowerCase()
  return normalized ? normalized : null
}

export function isOfficialChatboxWebHost(hostname = getCurrentHostname()): boolean {
  const normalized = normalizeHostname(hostname)
  return normalized ? OFFICIAL_CHATBOX_WEB_HOSTS.has(normalized) : false
}

export function canUseChatboxCloudBrowserApis(options: BrowserRuntimeOptions = {}): boolean {
  const {
    buildPlatform = CHATBOX_BUILD_PLATFORM,
    hostname = getCurrentHostname(),
    useLocalApi = USE_LOCAL_API,
    useBetaApi = USE_BETA_API,
    useLocalChatbox = USE_LOCAL_CHATBOX,
    useBetaChatbox = USE_BETA_CHATBOX,
  } = options

  if (buildPlatform !== 'web') {
    return true
  }

  if (useLocalApi || useBetaApi || useLocalChatbox || useBetaChatbox) {
    return true
  }

  return isOfficialChatboxWebHost(hostname)
}

export function shouldEnableChatboxBrowserTelemetry(options: BrowserRuntimeOptions = {}): boolean {
  const { buildPlatform = CHATBOX_BUILD_PLATFORM, hostname = getCurrentHostname() } = options

  if (buildPlatform !== 'web') {
    return true
  }

  return isOfficialChatboxWebHost(hostname)
}
