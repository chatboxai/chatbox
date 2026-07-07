import DesktopPlatform from './desktop_platform'
import type { Platform } from './interfaces'
import TestPlatform from './test_platform'

function initPlatform(): Platform {
  // 测试环境使用 TestPlatform
  if (process.env.NODE_ENV === 'test') {
    return new TestPlatform()
  }
  return new DesktopPlatform(window.electronAPI)
}

export default initPlatform()
