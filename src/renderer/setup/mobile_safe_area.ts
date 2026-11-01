// 这个库解决了移动端异形屏的显示安全区域的问题，比如iPhoneX，iPhone11等
// 这个库引入后，将设置全局的css变量 --mobile-safe-area-inset-top, --mobile-safe-area-inset-bottom, --mobile-safe-area-inset-left, --mobile-safe-area-inset-right
// 通过这些变量，可以在css中设置安全区域的padding，margin等，来规避异形屏的显示问题
// 为了达到最好的效果，在 html 的 meta 标签中设置 viewport-fit=cover

import { Device } from '@capacitor/device'
import { Keyboard } from '@capacitor/keyboard'
import { SafeArea } from 'capacitor-plugin-safe-area'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'

type SafeAreaInsets = Awaited<ReturnType<typeof SafeArea.getSafeAreaInsets>>['insets']

// Apps targeting API 35+ are drawn edge-to-edge on Android 15+. Older Android still
// lays the window below the system bars, so applying those insets again would double-pad.
const ANDROID_EDGE_TO_EDGE_SDK = 35

let keyboardVisible = false

const applySystemBarInsetsReady = resolveApplySystemBarInsets()

async function resolveApplySystemBarInsets(): Promise<boolean> {
  try {
    const info = await Device.getInfo()
    if (info.platform !== 'android') {
      return true
    }
    return (info.androidSDKVersion ?? 0) >= ANDROID_EDGE_TO_EDGE_SDK
  } catch {
    return CHATBOX_BUILD_PLATFORM !== 'android'
  }
}

function applySafeAreaInsets(insets: SafeAreaInsets, statusBarHeight: number, applySystemBarInsets: boolean) {
  const resolvedInsets = applySystemBarInsets
    ? {
        ...insets,
        top: Math.max(insets.top, statusBarHeight),
        bottom: keyboardVisible ? 0 : insets.bottom,
      }
    : {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }

  for (const [key, value] of Object.entries(resolvedInsets)) {
    document.documentElement.style.setProperty(`--mobile-safe-area-inset-${key}`, `${value}px`)
  }
}

async function updateSafeAreaInsets(insets?: SafeAreaInsets) {
  const [applySystemBarInsets, { insets: currentInsets }, { statusBarHeight }] = await Promise.all([
    applySystemBarInsetsReady,
    insets ? Promise.resolve({ insets }) : SafeArea.getSafeAreaInsets(),
    SafeArea.getStatusBarHeight(),
  ])

  applySafeAreaInsets(currentInsets, statusBarHeight, applySystemBarInsets)
}

void updateSafeAreaInsets()
void SafeArea.addListener('safeAreaChanged', ({ insets }) => {
  void updateSafeAreaInsets(insets)
})

void Keyboard.addListener('keyboardWillShow', () => {
  keyboardVisible = true
  document.documentElement.style.setProperty(`--mobile-safe-area-inset-bottom`, `0px`)
})

void Keyboard.addListener('keyboardWillHide', () => {
  keyboardVisible = false
  void updateSafeAreaInsets()
})
