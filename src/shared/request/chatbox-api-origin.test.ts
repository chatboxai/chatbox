import { afterEach, describe, expect, it } from 'vitest'
import { getChatboxAPIOrigin, setDynamicChatboxAPIOrigin } from './chatbox-api-origin'

const DEFAULT_ORIGIN = 'https://api.chatboxai.app'

afterEach(() => setDynamicChatboxAPIOrigin(DEFAULT_ORIGIN))

describe('getChatboxAPIOrigin', () => {
  it('applies local, beta, and new-database overrides in priority order', () => {
    expect(
      getChatboxAPIOrigin({
        USE_LOCAL_API: '1',
        USE_BETA_API: '1',
        USE_NEWDB_API: '1',
      })
    ).toBe('http://localhost:8002')
    expect(getChatboxAPIOrigin({ USE_BETA_API: '1', USE_NEWDB_API: '1' })).toBe('https://api-beta.chatboxai.app')
    expect(getChatboxAPIOrigin({ USE_NEWDB_API: '1' })).toBe('https://beta-new-db.chatboxai.app')
  })

  it('uses the dynamically selected origin when no environment override is active', () => {
    setDynamicChatboxAPIOrigin('https://available.example.test')

    expect(getChatboxAPIOrigin({})).toBe('https://available.example.test')
  })
})
