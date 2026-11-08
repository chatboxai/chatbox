import { describe, expect, it } from 'vitest'
import { applyCopilotToNewSession, clearCopilotFromNewSession, getNewChatAssistantFields } from './-newChatSession'

describe('getNewChatAssistantFields', () => {
  it('carries the assistant name and avatar set while the chat was new', () => {
    expect(
      getNewChatAssistantFields({
        assistantAvatarKey: 'avatar',
        assistantName: ' Mover ',
        picUrl: 'https://example.com/a.png',
        backgroundImage: { type: 'storage-key', storageKey: 'bg' },
      })
    ).toEqual({
      assistantAvatarKey: 'avatar',
      assistantName: 'Mover',
      picUrl: 'https://example.com/a.png',
      backgroundImage: { type: 'storage-key', storageKey: 'bg' },
    })
  })

  it('leaves the name unset when none was entered', () => {
    expect(getNewChatAssistantFields({ assistantName: '  ' }).assistantName).toBeUndefined()
    expect(getNewChatAssistantFields({}).assistantName).toBeUndefined()
  })
})

describe('new Copilot conversation identity', () => {
  const untitled = { id: 'new', name: 'Untitled', type: 'chat' as const, threadName: '' }
  const copilot = {
    id: 'writer',
    avatar: { type: 'storage-key' as const, storageKey: 'avatar' },
    picUrl: 'https://example.com/legacy.png',
    backgroundImage: { type: 'storage-key' as const, storageKey: 'bg' },
  }

  it('keeps Untitled or a user title while attaching Copilot avatar fields', () => {
    expect(applyCopilotToNewSession(untitled, copilot)).toMatchObject({
      name: 'Untitled',
      copilotId: 'writer',
      assistantAvatarKey: 'avatar',
      picUrl: copilot.picUrl,
      backgroundImage: copilot.backgroundImage,
      threadName: '',
    })
    expect(
      applyCopilotToNewSession({ ...untitled, name: 'Q2 budget review' }, { ...copilot, avatar: undefined })
    ).toMatchObject({
      name: 'Q2 budget review',
      copilotId: 'writer',
      picUrl: copilot.picUrl,
    })
  })

  it('clears Copilot identity without renaming the conversation', () => {
    const cleared = clearCopilotFromNewSession({
      ...untitled,
      name: 'Q2 budget review',
      copilotId: 'writer',
      assistantAvatarKey: 'avatar',
    })
    expect(cleared.name).toBe('Q2 budget review')
    expect(cleared.copilotId).toBeUndefined()
    expect(cleared.assistantAvatarKey).toBeUndefined()
    expect(cleared.picUrl).toBeUndefined()
    expect(cleared.backgroundImage).toBeUndefined()
  })
})
