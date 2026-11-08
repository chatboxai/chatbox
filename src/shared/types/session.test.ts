import { describe, expect, it } from 'vitest'
import { SessionHeaderSchema } from './session'

describe('SessionHeaderSchema', () => {
  it('keeps a session assistant name and reads sessions saved without one', () => {
    expect(SessionHeaderSchema.parse({ id: 's1', name: 'Moving', assistantName: 'Mover' }).assistantName).toBe('Mover')
    const legacy = SessionHeaderSchema.parse({ id: 's1', name: 'Moving', assistantAvatarKey: 'avatar' })
    expect(legacy).toEqual({ id: 's1', name: 'Moving', assistantAvatarKey: 'avatar' })
  })
})
