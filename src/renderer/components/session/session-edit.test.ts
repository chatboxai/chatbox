import { createMessage, type Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { restoreSessionParameters, SESSION_PARAMETER_KEYS } from '@/stores/session/session-settings-inheritance'
import { applySessionEdit, getSessionSystemPrompt } from './session-edit'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Weekly report',
    type: 'chat',
    messages: [createMessage('system', 'Be concise.'), createMessage('user', 'hi')],
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
  it('replaces, adds and removes the system prompt', () => {
    const session = makeSession()
    expect(getSessionSystemPrompt(applySessionEdit(session, { systemPrompt: 'Answer in French.' }))).toBe(
      'Answer in French.'
    )
    const withoutPrompt = applySessionEdit(session, { systemPrompt: '  ' })
    expect(withoutPrompt.messages.some((message) => message.role === 'system')).toBe(false)
    const added = applySessionEdit(withoutPrompt, { systemPrompt: 'New prompt' })
    expect(added.messages[0].role).toBe('system')
    expect(getSessionSystemPrompt(added)).toBe('New prompt')
  })

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
