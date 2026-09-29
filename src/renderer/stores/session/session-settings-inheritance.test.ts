import { ModelProviderEnum } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  countSessionDifferences,
  inheritChatSettings,
  visibleSessionParameterKeys,
} from './session-settings-inheritance'

describe('session settings inheritance', () => {
  it('keeps present-but-unset keys from hiding inherited values', () => {
    const merged = inheritChatSettings(
      { provider: 'openai', temperature: undefined, modelId: 'gpt-4o' },
      { temperature: 0.4, topP: undefined, maxContextMessageCount: 20, stream: false, pauseOnToolCallLimit: true },
      ModelProviderEnum.ChatboxAI
    )
    expect(merged).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o',
      temperature: 0.4,
      maxContextMessageCount: 20,
      stream: false,
    })
  })

  it('keeps Chatbox AI streaming when the global switch is off', () => {
    const global = { stream: false, pauseOnToolCallLimit: true }
    expect(inheritChatSettings({}, global, ModelProviderEnum.ChatboxAI)).not.toHaveProperty('stream')
    expect(inheritChatSettings({ provider: ModelProviderEnum.ChatboxAI }, global, 'openai')).not.toHaveProperty(
      'stream'
    )
  })

  it('counts only visible parameters whose value differs from the inherited one', () => {
    const global = { maxContextMessageCount: 20, temperature: 0.7, stream: false, pauseOnToolCallLimit: true }
    const settings = {
      provider: ModelProviderEnum.ChatboxAI,
      maxContextMessageCount: 20,
      stream: true,
      temperature: 0.2,
    }
    expect(visibleSessionParameterKeys(settings)).not.toContain('stream')
    expect(countSessionDifferences(settings, visibleSessionParameterKeys(settings), global)).toBe(1)
    expect(
      countSessionDifferences({ maxContextMessageCount: Number.MAX_SAFE_INTEGER }, ['maxContextMessageCount'], {
        pauseOnToolCallLimit: true,
      })
    ).toBe(0)
  })

  it('treats not pausing as the inherited value in Full Access chats', () => {
    const global = { pauseOnToolCallLimit: true }
    const fullAccess = { commandApprovalMode: 'full_access' as const }
    expect(
      countSessionDifferences({ ...fullAccess, pauseOnToolCallLimit: false }, ['pauseOnToolCallLimit'], global)
    ).toBe(0)
    expect(
      countSessionDifferences({ ...fullAccess, pauseOnToolCallLimit: true }, ['pauseOnToolCallLimit'], global)
    ).toBe(1)
    expect(countSessionDifferences({ pauseOnToolCallLimit: false }, ['pauseOnToolCallLimit'], global)).toBe(1)
  })
})
