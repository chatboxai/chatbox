import { atom, SetStateAction } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { focusAtom } from 'jotai-optics'
import * as defaults from '../../../shared/defaults'
import storage, { StorageKey } from '../../storage'
import platform from '../../platform'
import { SessionSettings, Settings, SettingWindowTab, Theme } from '../../../shared/types'

// settings
const _settingsAtom = atomWithStorage<Settings>(
  StorageKey.Settings,
  {
    ...defaults.settings(),
    theme: (() => {
      const initialTheme = localStorage.getItem('initial-theme')
      if (initialTheme === 'light') {
        return Theme.Light
      } else if (initialTheme === 'dark') {
        return Theme.Dark
      }
      return Theme.System
    })(),
  },
  storage
)
export const settingsAtom = atom(
  (get) => {
    const _settings = get(_settingsAtom)
    // 兼容早期版本
    const settings = Object.assign({}, defaults.settings(), _settings)
    settings.shortcuts = Object.assign({}, defaults.settings().shortcuts, _settings.shortcuts)
    settings.mcp = Object.assign({}, defaults.settings().mcp, _settings.mcp)
    return settings
  },
  (get, set, update: SetStateAction<Settings>) => {
    const settings = get(_settingsAtom)
    let newSettings = typeof update === 'function' ? update(settings) : update
    // 考虑关键配置的缺省情况
    // if (!newSettings.apiHost) {
    //   newSettings.apiHost = defaults.settings().apiHost
    // }
    // 如果快捷键配置发生变化，需要重新注册快捷键
    if (newSettings.shortcuts !== settings.shortcuts) {
      platform.ensureShortcutConfig(newSettings.shortcuts)
    }
    // 如果代理配置发生变化，需要重新注册代理
    if (newSettings.proxy !== settings.proxy) {
      platform.ensureProxyConfig({ proxy: newSettings.proxy })
    }
    // 如果开机自启动配置发生变化，需要重新设置开机自启动
    if (Boolean(newSettings.autoLaunch) !== Boolean(settings.autoLaunch)) {
      platform.ensureAutoLaunch(newSettings.autoLaunch)
    }
    set(_settingsAtom, newSettings)
  }
)

export const languageAtom = focusAtom(settingsAtom, (optic) => optic.prop('language'))
export const showWordCountAtom = focusAtom(settingsAtom, (optic) => optic.prop('showWordCount'))
export const showTokenCountAtom = focusAtom(settingsAtom, (optic) => optic.prop('showTokenCount'))
export const showTokenUsedAtom = focusAtom(settingsAtom, (optic) => optic.prop('showTokenUsed'))
export const showModelNameAtom = focusAtom(settingsAtom, (optic) => optic.prop('showModelName'))
export const showMessageTimestampAtom = focusAtom(settingsAtom, (optic) => optic.prop('showMessageTimestamp'))
export const showFirstTokenLatencyAtom = focusAtom(settingsAtom, (optic) => optic.prop('showFirstTokenLatency'))
export const userAvatarKeyAtom = focusAtom(settingsAtom, (optic) => optic.prop('userAvatarKey'))
export const defaultAssistantAvatarKeyAtom = focusAtom(settingsAtom, (optic) => optic.prop('defaultAssistantAvatarKey'))
export const themeAtom = focusAtom(settingsAtom, (optic) => optic.prop('theme'))
export const fontSizeAtom = focusAtom(settingsAtom, (optic) => optic.prop('fontSize'))
export const spellCheckAtom = focusAtom(settingsAtom, (optic) => optic.prop('spellCheck'))
export const allowReportingAndTrackingAtom = focusAtom(settingsAtom, (optic) => optic.prop('allowReportingAndTracking'))
export const enableMarkdownRenderingAtom = focusAtom(settingsAtom, (optic) => optic.prop('enableMarkdownRendering'))
export const enableLaTeXRenderingAtom = focusAtom(settingsAtom, (optic) => optic.prop('enableLaTeXRendering'))
export const enableMermaidRenderingAtom = focusAtom(settingsAtom, (optic) => optic.prop('enableMermaidRendering'))
// export const selectedCustomProviderIdAtom = focusAtom(settingsAtom, (optic) => optic.prop('selectedCustomProviderId'))
export const autoPreviewArtifactsAtom = focusAtom(settingsAtom, (optic) => optic.prop('autoPreviewArtifacts'))
export const autoGenerateTitleAtom = focusAtom(settingsAtom, (optic) => optic.prop('autoGenerateTitle'))
export const autoCollapseCodeBlockAtom = focusAtom(settingsAtom, (optic) => optic.prop('autoCollapseCodeBlock'))
export const shortcutsAtom = focusAtom(settingsAtom, (optic) => optic.prop('shortcuts'))
export const pasteLongTextAsAFileAtom = focusAtom(settingsAtom, (optic) => optic.prop('pasteLongTextAsAFile'))
// export const licenseDetailAtom = focusAtom(settingsAtom, (optic) => optic.prop('licenseDetail'))

// Related UI state, moved here for proximity to settings
export const openSettingDialogAtom = atom<SettingWindowTab | null>(null)

// 存储新创建SessionSettings的默认值 缓存在 localStorage (有用户出现 exceed quota 错误，改到 storage 中)
export const chatSessionSettingsAtom = atomWithStorage<SessionSettings>(StorageKey.ChatSessionSettings, {}, storage)
export const pictureSessionSettingsAtom = atomWithStorage<SessionSettings>(
  StorageKey.PictureSessionSettings,
  {},
  storage
)
