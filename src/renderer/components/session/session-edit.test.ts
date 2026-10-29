import { type SessionHeader } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { restoreSessionParameters, SESSION_PARAMETER_KEYS } from '@/stores/session/session-settings-inheritance'
import { applySessionEdit } from './session-edit'

function makeSession(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    id: 'session-1',
    name: 'Weekly report',
    type: 'chat',
    settings: {
      provider: 'openai',
      modelId: 'gpt-4o',
      temperature: 0.3,
      maxContextMessageCount: 20,
      workingDirectories: ['/tmp/project'],
    },
    ...overrides,
  }
}

describe('applySessionEdit', () => {
  it('keeps the previous name when the new one is blank', () => {
    expect(applySessionEdit(makeSession(), { name: '   ' }).name).toBe('Weekly report')
    expect(applySessionEdit(makeSession(), { name: ' Pricing ' }).name).toBe('Pricing')
  })

  it('restores parameters to inherited values without touching other settings', () => {
    const restored = applySessionEdit(makeSession(), { settings: restoreSessionParameters(SESSION_PARAMETER_KEYS) })
    expect(restored.settings).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o',
      workingDirectories: ['/tmp/project'],
    })
    expect('temperature' in (restored.settings ?? {})).toBe(false)
  })

  it('clears the avatar and background with null', () => {
    const session = makeSession({
      assistantAvatarKey: 'avatar-key',
      backgroundImage: { type: 'storage-key', storageKey: 'bg-key' },
    })
    const cleared = applySessionEdit(session, { assistantAvatarKey: null, backgroundImage: null })
    expect(cleared.assistantAvatarKey).toBeUndefined()
    expect(cleared.backgroundImage).toBeUndefined()
  })
})
