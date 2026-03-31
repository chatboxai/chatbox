import * as Sentry from '@sentry/react'
import copyToClipboardFallback from 'copy-to-clipboard'

export function copyToClipboard(text: string) {
  try {
    navigator?.clipboard?.writeText(text)
  } catch (e) {
    Sentry.captureException(e)
  }
  try {
    copyToClipboardFallback(text)
  } catch (e) {
    Sentry.captureException(e)
  }
}

function getUserAgent() {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

export const getBrowser = (): 'Opera' | 'Chrome' | 'Firefox' | 'Safari' | 'IE' | 'Edge' | 'Unknown' | undefined => {
  const ua = getUserAgent()
  if (ua.indexOf('Opera') > -1) {
    return 'Opera'
  }
  if (ua.indexOf('Chrome') > -1) {
    return 'Chrome'
  }
  if (ua.indexOf('Firefox') > -1) {
    return 'Firefox'
  }
  if (ua.indexOf('Safari') > -1) {
    return 'Safari'
  }
  if (ua.indexOf('MSIE') > -1) {
    return 'IE'
  }
  if (ua.indexOf('Trident') > -1) {
    return 'IE'
  }
  if (ua.indexOf('Edge') > -1) {
    return 'Edge'
  }
  return 'Unknown'
}

export const getOS = (): 'Windows' | 'Mac' | 'Linux' | 'Android' | 'iOS' | 'Unknown' => {
  const ua = getUserAgent()
  if (ua.indexOf('Windows') > -1) {
    return 'Windows'
  }
  if (ua.indexOf('Mac') > -1) {
    return 'Mac'
  }
  if (ua.indexOf('Linux') > -1) {
    return 'Linux'
  }
  if (ua.indexOf('Android') > -1) {
    return 'Android'
  }
  if (ua.indexOf('iPhone') > -1) {
    return 'iOS'
  }
  if (ua.indexOf('iPad') > -1) {
    return 'iOS'
  }
  if (ua.indexOf('iPod') > -1) {
    return 'iOS'
  }
  return 'Unknown'
}
