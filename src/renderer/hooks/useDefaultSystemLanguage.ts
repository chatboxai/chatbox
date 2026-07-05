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
          let locale = await platform.getLocale()

          // 网页版暂时不自动更改简体中文，防止网址封禁
          if (platform.type === 'web') {
            if (locale === 'zh-Hans') {
              locale = 'en'
            }
          }

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
