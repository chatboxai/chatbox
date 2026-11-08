import { describe, expect, it } from 'vitest'
import { getNewChatAssistantFields } from './-newChatSession'

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
