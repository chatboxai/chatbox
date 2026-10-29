import {
  type DevLaunchEnvironment,
  type DevLaunchOptions,
  parseDevLaunchOptions,
  parseSearchParams,
} from '@shared/dev-launch'

let capturedLaunchOptions: DevLaunchOptions | undefined

export function readRendererSearch(location: Pick<Location, 'hash' | 'search'>): string {
  const hashQueryIndex = location.hash.indexOf('?')
  if (hashQueryIndex >= 0) {
    return location.hash.slice(hashQueryIndex + 1)
  }
  return location.search
}

function readRendererDevLaunchEnvironment(): DevLaunchEnvironment {
  return {
    CHATBOX_SKIP_GUIDE: process.env.CHATBOX_SKIP_GUIDE,
    CHATBOX_START_PAGE: process.env.CHATBOX_START_PAGE,
  }
}

export function captureRendererDevLaunchOptions(
  location: Pick<Location, 'hash' | 'search'> = typeof window === 'undefined'
    ? { hash: '', search: '' }
    : window.location
): DevLaunchOptions {
  if (!capturedLaunchOptions) {
    const search = parseSearchParams(readRendererSearch(location))
    const searchOptions = parseDevLaunchOptions({ search })
    const environmentOptions = parseDevLaunchOptions({ env: readRendererDevLaunchEnvironment() })
    capturedLaunchOptions = {
      skipGuide: searchOptions.skipGuide || environmentOptions.skipGuide,
      startPage: searchOptions.startPage ?? environmentOptions.startPage,
    }
  }
  return capturedLaunchOptions
}

export function getRendererDevLaunchOptions(): DevLaunchOptions {
  return capturedLaunchOptions ?? captureRendererDevLaunchOptions()
}

export function resetRendererDevLaunchOptions() {
  capturedLaunchOptions = undefined
}
