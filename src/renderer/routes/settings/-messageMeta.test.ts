import { describe, expect, test } from 'vitest'
import { getMessageMetaUpdate, getSelectedMessageMeta } from './-messageMeta'

describe('Message info chips', () => {
  test('select unset items by the defaults messages use', () => {
    expect(getSelectedMessageMeta({})).toEqual(['showModelName', 'showTokenUsed'])
    expect(getSelectedMessageMeta({ showModelName: false, showMessageTimestamp: true })).toEqual([
      'showMessageTimestamp',
      'showTokenUsed',
    ])
  })

  test('keep the model name on when another chip is toggled from an unset value', () => {
    const selected = [...getSelectedMessageMeta({ showTokenUsed: true }), 'showMessageTimestamp']
    expect(getMessageMetaUpdate(selected)).toEqual({
      showModelName: true,
      showMessageTimestamp: true,
      showWordCount: false,
      showTokenUsed: true,
      showFirstTokenLatency: false,
    })
  })
})
