import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import zh from '../../packages/chatbox-i18n/src/locales/zh-Hans/translation.json'
import { formatSystemToolDetails } from '@shared/mobile-work/authorization-text'
import { formatArtifactSize } from '@shared/work-artifacts'

afterEach(() => vi.unstubAllEnvs())

describe('system authorization presentation', () => {
  it('formats the confirmed event in Chinese and the device time zone', async () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: zh } } })
    const start = Date.parse('2026-09-14T08:00:00.000Z')
    const text = formatSystemToolDetails(
      { action: 'calendar_create', title: '团建', start, end: start + 7200000, allDay: false },
      i18n.t,
      'zh-Hans'
    )
    expect(text).toContain('创建日历日程“团建”')
    expect(text).toContain('16:00')
    expect(text).toContain('18:00')
    expect(text).not.toContain('08:00')
    expect(text).not.toContain('.000Z')
    const allDay = formatSystemToolDetails(
      { action: 'calendar_update', title: '休假', start, end: start + 86400000, allDay: true },
      i18n.t,
      'zh-Hans'
    )
    expect(allDay).toContain('不含结束日期')
    expect(allDay).not.toContain('16:00')
  })

  it('keeps artifact sizes readable from bytes to megabytes', () => {
    expect(formatArtifactSize(30, 'en')).toBe('30 B')
    expect(formatArtifactSize(1536, 'en')).toBe('1.5 KB')
    expect(formatArtifactSize(5 * 1024 * 1024, 'en')).toBe('5 MB')
  })
})
