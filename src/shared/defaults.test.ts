import { describe, expect, it } from 'vitest'
import { chatSessionSettings, getDefaultPrompt, newConfigs, pictureSessionSettings, settings } from './defaults'
import { DEFAULT_INTERFACE_COLORS } from './theme-colors'
import { ModelProviderEnum, type SessionSettings, type Settings, SettingsSchema, Theme } from './types'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('defaults', () => {
  it('settings() returns expected default values', () => {
    const result: Settings = settings()

    expect(result.theme).toBe(Theme.System)
    expect(result.language).toBe('en')
    expect(result.fontSize).toBe(14)
    expect(result.spellCheck).toBe(true)
    expect(result.interfaceColors).toEqual(DEFAULT_INTERFACE_COLORS)
    expect(result.interfaceColorPresets).toEqual([])
    expect(result.showWordCount).toBe(false)
    expect(result.showTokenCount).toBe(false)
    expect(result.showTokenUsed).toBe(true)
    expect(result.messageLayout).toBe('classic')
  })

  it('settings() returns allowReportingAndTracking as true', () => {
    expect(settings().allowReportingAndTracking).toBe(true)
  })

  it('uses default interface colors for legacy settings', () => {
    const legacySettings = { ...settings(), interfaceColors: undefined }

    expect(SettingsSchema.parse(legacySettings).interfaceColors).toEqual(DEFAULT_INTERFACE_COLORS)
  })

  it('preserves legacy interface backgrounds when adding the brand color', () => {
    const legacySettings = {
      ...settings(),
      interfaceColors: {
        light: {
          backgroundPrimary: '#123456',
          backgroundSecondary: '#234567',
          backgroundTertiary: '#345678',
        },
        dark: {
          backgroundPrimary: '#456789',
          backgroundSecondary: '#56789a',
          backgroundTertiary: '#6789ab',
        },
      },
    }

    expect(SettingsSchema.parse(legacySettings).interfaceColors).toEqual({
      light: { ...legacySettings.interfaceColors.light, brand: DEFAULT_INTERFACE_COLORS.light.brand },
      dark: { ...legacySettings.interfaceColors.dark, brand: DEFAULT_INTERFACE_COLORS.dark.brand },
    })
  })

  it('uses an empty preset collection for legacy settings', () => {
    const legacySettings = { ...settings(), interfaceColorPresets: undefined }

    expect(SettingsSchema.parse(legacySettings).interfaceColorPresets).toEqual([])
  })

  it('preserves saved interface color presets', () => {
    const customPreset = {
      id: 'f9a591a3-7f5e-4ae9-b856-f9d8e2fdceda',
      label: 'Custom Preset 1',
      colors: DEFAULT_INTERFACE_COLORS,
    }

    expect(
      SettingsSchema.parse({ ...settings(), interfaceColorPresets: [customPreset] }).interfaceColorPresets
    ).toEqual([customPreset])
  })

  it('settings() returns enableMarkdownRendering as true', () => {
    expect(settings().enableMarkdownRendering).toBe(true)
  })

  it('settings() returns shortcuts object with expected keys', () => {
    const result = settings().shortcuts

    expect(Object.keys(result).sort()).toEqual(
      [
        'quickToggle',
        'inputBoxFocus',
        'inputBoxWebBrowsingMode',
        'newChat',
        'newPictureChat',
        'sessionListNavNext',
        'sessionListNavPrev',
        'sessionListNavTargetIndex',
        'messageListRefreshContext',
        'dialogOpenSearch',
        'inputBoxSendMessage',
        'inputBoxSendMessageWithoutResponse',
        'optionNavUp',
        'optionNavDown',
        'optionSelect',
      ].sort()
    )
    expect(result.messageListRefreshContext).toBe('mod+shift+n')
    expect(result.newPictureChat).toBe('')
  })

  it('newConfigs() returns object with uuid string', () => {
    const result = newConfigs()

    expect(typeof result.uuid).toBe('string')
    expect(result.uuid).toMatch(UUID_REGEX)
  })

  it('getDefaultPrompt() returns expected string', () => {
    expect(getDefaultPrompt()).toBe('You are a helpful assistant.')
  })

  it('chatSessionSettings() returns provider and modelId', () => {
    const result: SessionSettings = chatSessionSettings()

    expect(result.provider).toBe(ModelProviderEnum.ChatboxAI)
    expect(result.modelId).toBe('chatboxai-4')
  })

  it('pictureSessionSettings() returns provider, modelId, dalleStyle, imageGenerateNum', () => {
    const result: SessionSettings = pictureSessionSettings()

    expect(result.provider).toBe(ModelProviderEnum.ChatboxAI)
    expect(result.modelId).toBe('DALL-E-3')
    expect(result.dalleStyle).toBe('vivid')
    expect(result.imageGenerateNum).toBe(1)
  })
})
