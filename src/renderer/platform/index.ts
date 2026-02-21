import DesktopPlatform from './desktop_platform'
import type { Platform } from './interfaces'
import { createTauriIPCAdapter, isTauriRuntime } from './tauri_ipc_adapter'
import TestPlatform from './test_platform'
import WebPlatform from './web_platform'

function initPlatform(): Platform {
  // 测试环境使用 TestPlatform
  if (process.env.NODE_ENV === 'test') {
    return new TestPlatform()
  }

  if (typeof window !== 'undefined') {
    if (window.desktopAPI) {
      return new DesktopPlatform(window.desktopAPI)
    }

    if (isTauriRuntime()) {
      const tauriIPC = createTauriIPCAdapter()
      window.desktopAPI = tauriIPC
      return new DesktopPlatform(tauriIPC)
    }
  }

  return new WebPlatform()
}

export default initPlatform()
