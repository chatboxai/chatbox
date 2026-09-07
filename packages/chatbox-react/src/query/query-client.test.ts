import { describe, expect, test } from 'vitest'
import { createChatQueryClient } from './query-client'
import { QueryKeys } from './query-keys'

describe('createChatQueryClient', () => {
  test('disables structural sharing only for individual chat sessions', () => {
    const queryClient = createChatQueryClient()

    expect(queryClient.getQueryDefaults(QueryKeys.ChatSession('session-1')).structuralSharing).toBe(false)
    expect(queryClient.getQueryDefaults(QueryKeys.ChatSessionsList).structuralSharing).toBeUndefined()
    expect(queryClient.getQueryDefaults(QueryKeys.ChatSessionSettings('session-1')).structuralSharing).toBeUndefined()
  })
})
