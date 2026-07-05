import { describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../types/adapters'
import { createOAuthCredentialManager } from './credential-manager'
import type { OAuthCredentials } from './types'

function createDependencies(overrides?: Partial<NonNullable<ModelDependencies['oauth']>>): ModelDependencies {
  return {
    request: {
      fetchWithOptions: vi.fn(),
      apiRequest: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    oauth: {
      refreshCredential: vi.fn(),
      persistCredential: vi.fn(),
      clearCredential: vi.fn(),
      ...overrides,
    },
    platformType: 'desktop',
  }
}

describe('createOAuthCredentialManager', () => {
  it('refreshes near-expiry credentials and persists them', async () => {
    const nextCredential: OAuthCredentials = {
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresAt: Date.now() + 60 * 60 * 1000,
    }
    const dependencies = createDependencies({
      refreshCredential: vi.fn().mockResolvedValue(nextCredential),
    })

    const manager = createOAuthCredentialManager(
      'openai',
      {
        oauth: {
          accessToken: 'old-token',
          refreshToken: 'old-refresh',
          expiresAt: Date.now() + 30 * 1000,
        },
        activeAuthMode: 'oauth',
      },
      dependencies
    )

    expect(manager).toBeDefined()
    await expect(manager!.getAccessToken()).resolves.toBe('new-token')
    expect(dependencies.oauth?.refreshCredential).toHaveBeenCalledWith('openai', expect.any(Object))
    expect(dependencies.oauth?.persistCredential).toHaveBeenCalledWith('openai', nextCredential)
  })

  it('clears stored credentials through the mapped settings provider', () => {
    const dependencies = createDependencies()
    const manager = createOAuthCredentialManager(
      'openai-responses',
      {
        oauth: {
          accessToken: 'token',
        },
        activeAuthMode: 'oauth',
      },
      dependencies
    )

    manager!.clear()
    expect(dependencies.oauth?.clearCredential).toHaveBeenCalledWith('openai')
  })
})
