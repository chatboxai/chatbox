import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Device } from '@capacitor/device'
import type { PlatformType } from './interfaces'
import WebPlatform from './web_platform'

/**
 * MobilePlatform wraps WebPlatform for Capacitor (Android / iOS) native builds.
 *
 * The only structural change is `type = 'mobile'`, which unlocks all the
 * mobile-specific UI branches scattered across the codebase
 * (input behaviour, sidebar mode, SplashScreen, router history, etc.).
 *
 * Everything else delegates to WebPlatform / Capacitor plugins.
 */
export default class MobilePlatform extends WebPlatform {
  public type: PlatformType = 'mobile'

  public async getVersion(): Promise<string> {
    try {
      const info = await App.getInfo()
      return info.version
    } catch {
      return 'mobile'
    }
  }

  public async getPlatform(): Promise<string> {
    return Capacitor.getPlatform() // 'android' | 'ios'
  }

  public async getDeviceName(): Promise<string> {
    try {
      const info = await Device.getInfo()
      return info.model || info.platform
    } catch {
      return Capacitor.getPlatform()
    }
  }

  public async getInstanceName(): Promise<string> {
    try {
      const info = await Device.getInfo()
      return `${info.platform} / ${info.model}`
    } catch {
      return Capacitor.getPlatform()
    }
  }
}
