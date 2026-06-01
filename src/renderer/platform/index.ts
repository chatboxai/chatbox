import { Capacitor } from '@capacitor/core'
import DesktopPlatform from './desktop_platform'
import type { Platform } from './interfaces'
import MobilePlatform from './mobile_platform'
import TestPlatform from './test_platform'
import WebPlatform from './web_platform'

function initPlatform(): Platform {
  // 测试环境使用 TestPlatform
  if (process.env.NODE_ENV === 'test') {
    return new TestPlatform()
  }
  if (typeof window !== 'undefined' && window.electronAPI) {
    return new DesktopPlatform(window.electronAPI)
  }
  // Capacitor 原生运行时（Android / iOS）
  if (Capacitor.isNativePlatform()) {
    return new MobilePlatform()
  }
  return new WebPlatform()
}

export default initPlatform()
