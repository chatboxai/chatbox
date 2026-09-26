// 移动端异形屏与系统状态栏/导航栏安全区域适配模块
// 支持 iOS（刘海屏、灵动岛、底部HomeIndicator）与 Android（挖孔屏、水滴屏、状态栏与虚拟导航栏）
// 设置全局 CSS 变量：
//   --mobile-safe-area-inset-top
//   --mobile-safe-area-inset-bottom
//   --mobile-safe-area-inset-left
//   --mobile-safe-area-inset-right

import { SafeArea } from 'capacitor-plugin-safe-area'
import { Keyboard } from '@capacitor/keyboard'

async function updateSafeArea() {
  try {
    const [insetsRes, statusBarRes] = await Promise.all([
      SafeArea.getSafeAreaInsets().catch(() => ({ insets: { top: 0, bottom: 0, left: 0, right: 0 } })),
      SafeArea.getStatusBarHeight().catch(() => ({ statusBarHeight: 0 })),
    ])

    const insets = insetsRes.insets || { top: 0, bottom: 0, left: 0, right: 0 }
    const statusBarHeight = statusBarRes.statusBarHeight || 0

    // 在 Android 等部分设备上，getSafeAreaInsets 可能未将沉浸式状态栏计入 top
    // 通过取 getSafeAreaInsets.top 与 getStatusBarHeight 的较大值，确保按钮绝对不被遮挡
    const effectiveTop = Math.max(insets.top || 0, statusBarHeight || 0)

    document.documentElement.style.setProperty('--mobile-safe-area-inset-top', `${effectiveTop}px`)
    document.documentElement.style.setProperty('--mobile-safe-area-inset-bottom', `${insets.bottom || 0}px`)
    document.documentElement.style.setProperty('--mobile-safe-area-inset-left', `${insets.left || 0}px`)
    document.documentElement.style.setProperty('--mobile-safe-area-inset-right', `${insets.right || 0}px`)
  } catch (error) {
    console.warn('Failed to update mobile safe area insets:', error)
  }
}

// 首次执行
void updateSafeArea()

// 屏幕旋转或窗口尺寸/分屏变化时动态更新
try {
  void SafeArea.addListener('safeAreaChanged', async (data) => {
    if (data?.insets) {
      const { statusBarHeight } = await SafeArea.getStatusBarHeight().catch(() => ({ statusBarHeight: 0 }))
      const effectiveTop = Math.max(data.insets.top || 0, statusBarHeight || 0)
      document.documentElement.style.setProperty('--mobile-safe-area-inset-top', `${effectiveTop}px`)
      document.documentElement.style.setProperty('--mobile-safe-area-inset-bottom', `${data.insets.bottom || 0}px`)
      document.documentElement.style.setProperty('--mobile-safe-area-inset-left', `${data.insets.left || 0}px`)
      document.documentElement.style.setProperty('--mobile-safe-area-inset-right', `${data.insets.right || 0}px`)
    } else {
      void updateSafeArea()
    }
  })
} catch (e) {
  console.warn('SafeArea.addListener error:', e)
}

// 虚拟键盘弹出时，避免底部安全距离与软键盘高度叠加造成过大留白
try {
  Keyboard.addListener('keyboardWillShow', async () => {
    document.documentElement.style.setProperty('--mobile-safe-area-inset-bottom', '0px')
  })

  Keyboard.addListener('keyboardWillHide', () => {
    void updateSafeArea()
  })
} catch (e) {
  console.warn('Keyboard.addListener error:', e)
}
