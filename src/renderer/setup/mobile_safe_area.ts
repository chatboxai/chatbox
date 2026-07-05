// 这个库解决了移动端异形屏的显示安全区域的问题，比如iPhoneX，iPhone11等
// 这个库引入后，将设置全局的css变量 --mobile-safe-area-inset-top, --mobile-safe-area-inset-bottom, --mobile-safe-area-inset-left, --mobile-safe-area-inset-right
// 通过这些变量，可以在css中设置安全区域的padding，margin等，来规避异形屏的显示问题
// 为了达到最好的效果，在 html 的 meta 标签中设置 viewport-fit=cover

import { Keyboard } from '@capacitor/keyboard'
import { SafeArea } from 'capacitor-plugin-safe-area'

void SafeArea.getSafeAreaInsets().then(({ insets }) => {
  for (const [key, value] of Object.entries(insets)) {
    document.documentElement.style.setProperty(`--mobile-safe-area-inset-${key}`, `${value}px`)
  }
})

void SafeArea.getStatusBarHeight().then(({ statusBarHeight }) => {
  // console.log(statusBarHeight, 'statusbarHeight');
})
void (async () => {
  // when safe-area changed
  const eventListener = await SafeArea.addListener('safeAreaChanged', (data) => {
    const { insets } = data
    for (const [key, value] of Object.entries(insets)) {
      document.documentElement.style.setProperty(`--mobile-safe-area-inset-${key}`, `${value}px`)
    }
  })
  // eventListener.remove();
})()

void Keyboard.addListener('keyboardWillShow', async (info) => {
  document.documentElement.style.setProperty(`--mobile-safe-area-inset-bottom`, `0px`)
})

void Keyboard.addListener('keyboardWillHide', () => {
  void SafeArea.getSafeAreaInsets().then(({ insets }) => {
    for (const [key, value] of Object.entries(insets)) {
      document.documentElement.style.setProperty(`--mobile-safe-area-inset-${key}`, `${value}px`)
    }
  })
})
