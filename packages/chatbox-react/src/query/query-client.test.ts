import { describe, expect, it } from 'vitest'
import { createChatQueryClient } from './query-client'
import { QueryKeys } from './query-keys'

describe('createChatQueryClient', () => {
  it('keeps single-message cache updates shallow and releases inactive body queries', () => {
    const client = createChatQueryClient()
    expect(client.getQueryDefaults(QueryKeys.ChatSessionMessage('s', 'm'))).toMatchObject({
      structuralSharing: false,
      gcTime: 0,
    })
    expect(client.getQueryDefaults(QueryKeys.ChatSessionsList).structuralSharing).toBeUndefined()
    client.clear()
  })
})
