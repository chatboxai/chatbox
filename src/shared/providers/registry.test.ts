import { ModelProviderType } from 'src/shared/types/provider'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearProviderRegistry,
  defineProvider,
  getAllProviders,
  getProviderDefinition,
  getProviderDisplayName,
  getSystemProviders,
  hasProvider,
} from './registry'
import type { ProviderDefinition } from './types'

const mockCreateModel = () => ({}) as ReturnType<ProviderDefinition['createModel']>

const testProvider: ProviderDefinition = {
  id: 'test-provider',
  name: 'Test Provider',
  type: ModelProviderType.OpenAI,
  createModel: mockCreateModel,
}

const testProvider2: ProviderDefinition = {
  id: 'test-provider-2',
  name: 'Test Provider 2',
  type: ModelProviderType.Claude,
  description: 'Second test provider',
  urls: { website: 'https://example.com' },
  defaultSettings: { apiHost: 'https://api.example.com' },
  createModel: mockCreateModel,
}

describe('Provider Registry', () => {
  beforeEach(() => {
    clearProviderRegistry()
  })

  describe('defineProvider', () => {
    it('registers a provider and returns it', () => {
      const result = defineProvider(testProvider)
      expect(result).toEqual(testProvider)
      expect(hasProvider('test-provider')).toBe(true)
    })

    it('overwrites existing provider with same id', () => {
      defineProvider(testProvider)
      const updated = { ...testProvider, name: 'Updated Provider' }
      defineProvider(updated)
      const retrieved = getProviderDefinition('test-provider')
      expect(retrieved?.name).toBe('Updated Provider')
    })
  })

  describe('getProviderDisplayName', () => {
    it('prefers a custom provider name over the built-in definition name', () => {
      defineProvider(testProvider)
      expect(getProviderDisplayName('test-provider')).toBe('Test Provider')
      expect(getProviderDisplayName('custom-1', [{ id: 'custom-1', name: ' My Gateway ' }])).toBe('My Gateway')
      expect(getProviderDisplayName('test-provider', [{ id: 'test-provider', name: '' }])).toBe('Test Provider')
      expect(getProviderDisplayName('deleted', [])).toBeUndefined()
    })
  })

  describe('getProviderDefinition', () => {
    it('returns undefined for non-existent provider', () => {
      expect(getProviderDefinition('non-existent')).toBeUndefined()
    })

    it('returns registered provider', () => {
      defineProvider(testProvider)
      const retrieved = getProviderDefinition('test-provider')
      expect(retrieved).toEqual(testProvider)
    })
  })

  describe('getAllProviders', () => {
    it('returns empty array when no providers registered', () => {
      expect(getAllProviders()).toEqual([])
    })

    it('returns all registered providers', () => {
      defineProvider(testProvider)
      defineProvider(testProvider2)
      const all = getAllProviders()
      expect(all).toHaveLength(2)
      expect(all).toContainEqual(testProvider)
      expect(all).toContainEqual(testProvider2)
    })
  })

  describe('hasProvider', () => {
    it('returns false for non-existent provider', () => {
      expect(hasProvider('non-existent')).toBe(false)
    })

    it('returns true for registered provider', () => {
      defineProvider(testProvider)
      expect(hasProvider('test-provider')).toBe(true)
    })
  })

  describe('clearProviderRegistry', () => {
    it('removes all providers', () => {
      defineProvider(testProvider)
      defineProvider(testProvider2)
      expect(getAllProviders()).toHaveLength(2)
      clearProviderRegistry()
      expect(getAllProviders()).toHaveLength(0)
    })
  })

  describe('getSystemProviders', () => {
    it('converts provider definitions to ProviderBaseInfo format', () => {
      defineProvider(testProvider2)
      const systemProviders = getSystemProviders()
      expect(systemProviders).toHaveLength(1)
      expect(systemProviders[0]).toEqual({
        id: 'test-provider-2',
        name: 'Test Provider 2',
        type: ModelProviderType.Claude,
        description: 'Second test provider',
        urls: { website: 'https://example.com' },
        defaultSettings: { apiHost: 'https://api.example.com' },
      })
    })

    it('handles providers without optional fields', () => {
      defineProvider(testProvider)
      const systemProviders = getSystemProviders()
      expect(systemProviders[0]).toEqual({
        id: 'test-provider',
        name: 'Test Provider',
        type: ModelProviderType.OpenAI,
        description: undefined,
        urls: undefined,
        defaultSettings: undefined,
      })
    })
  })
})
