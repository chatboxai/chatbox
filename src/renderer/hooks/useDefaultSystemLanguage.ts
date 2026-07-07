import { useEffect } from 'react'
import { settingsStore } from '@/stores/settingsStore'
import platform from '../platform'

export function useSystemLanguageWhenInit() {
  useEffect(() => {
    // 通过定时器延迟启动，防止处理状态底层存储的异步加载前错误的初始数据
    setTimeout(() => {
      void (async () => {
        const { languageInited } = settingsStore.getState()
        if (!languageInited) {
          const locale = await platform.getLocale()

          settingsStore.setState({
            language: locale,
            languageInited: true,
          })
        }
        settingsStore.setState({
          languageInited: true,
        })
      })()
    }, 2000)
  }, [])
}
