import type { ModelDependencies } from '@shared/types/adapters'
import { describe, expect, it, vi } from 'vitest'
import { createCopilotOAuthFetch } from './copilot-oauth-fetch'

function createDependencies() {
  const apiRequest = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
  const dependencies: ModelDependencies = {
    request: {
      fetchWithOptions: vi.fn(),
      apiRequest,
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    platformType: 'desktop',
  }

  return { apiRequest, dependencies }
}

describe('createCopilotOAuthFetch', () => {
  it('forwards oauth headers as a plain record for proxied requests', async () => {
    const { apiRequest, dependencies } = createDependencies()
    const fetcher = createCopilotOAuthFetch(dependencies, {
      getCredential: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('copilot-token'),
      clear: vi.fn(),
    })

    await fetcher('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"messages":[]}',
    })

    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer copilot-token',
          'content-type': 'application/json',
          'openai-intent': 'conversation-edits',
        }),
      })
    )
  })
})
