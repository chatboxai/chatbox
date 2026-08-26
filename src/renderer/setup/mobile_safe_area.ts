// 这个库解决了移动端异形屏的显示安全区域的问题，比如iPhoneX，iPhone11等
// 这个库引入后，将设置全局的css变量 --mobile-safe-area-inset-top, --mobile-safe-area-inset-bottom, --mobile-safe-area-inset-left, --mobile-safe-area-inset-right
// 通过这些变量，可以在css中设置安全区域的padding，margin等，来规避异形屏的显示问题
// 为了达到最好的效果，在 html 的 meta 标签中设置 viewport-fit=cover

import { Keyboard } from '@capacitor/keyboard'
import { SafeArea } from 'capacitor-plugin-safe-area'

type SafeAreaInsets = Awaited<ReturnType<typeof SafeArea.getSafeAreaInsets>>['insets']

let keyboardVisible = false

function applySafeAreaInsets(insets: SafeAreaInsets, statusBarHeight: number) {
  const resolvedInsets = {
    ...insets,
    top: Math.max(insets.top, statusBarHeight),
    bottom: keyboardVisible ? 0 : insets.bottom,
  }

  for (const [key, value] of Object.entries(resolvedInsets)) {
    document.documentElement.style.setProperty(`--mobile-safe-area-inset-${key}`, `${value}px`)
  }
}

async function updateSafeAreaInsets(insets?: SafeAreaInsets) {
  const [{ insets: currentInsets }, { statusBarHeight }] = await Promise.all([
    insets ? Promise.resolve({ insets }) : SafeArea.getSafeAreaInsets(),
    SafeArea.getStatusBarHeight(),
  ])

  applySafeAreaInsets(currentInsets, statusBarHeight)
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
