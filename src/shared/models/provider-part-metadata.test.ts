import { describe, expect, it } from 'vitest'
import { mergeProviderMetadata, pickPersistableProviderMetadata } from './provider-part-metadata'

describe('pickPersistableProviderMetadata', () => {
  it('keeps whitelisted Anthropic replay keys', () => {
    expect(pickPersistableProviderMetadata({ anthropic: { signature: 'sig' } })).toEqual({
      anthropic: { signature: 'sig' },
    })
    expect(pickPersistableProviderMetadata({ anthropic: { redactedData: 'data' } })).toEqual({
      anthropic: { redactedData: 'data' },
    })
  })

  it('drops non-whitelisted keys and namespaces', () => {
    expect(
      pickPersistableProviderMetadata({
        anthropic: { signature: 'sig', cacheControl: { type: 'ephemeral' } },
        openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' },
      })
    ).toEqual({ anthropic: { signature: 'sig' } })
  })

  it('returns undefined when nothing persistable remains', () => {
    expect(pickPersistableProviderMetadata(undefined)).toBeUndefined()
    expect(pickPersistableProviderMetadata({})).toBeUndefined()
    expect(pickPersistableProviderMetadata({ openai: { itemId: 'rs_1' } })).toBeUndefined()
    expect(pickPersistableProviderMetadata({ anthropic: {} })).toBeUndefined()
  })
})

describe('mergeProviderMetadata', () => {
  it('returns the defined side when the other is missing', () => {
    const metadata = { anthropic: { signature: 'sig' } }
    expect(mergeProviderMetadata(undefined, metadata)).toBe(metadata)
    expect(mergeProviderMetadata(metadata, undefined)).toBe(metadata)
    expect(mergeProviderMetadata(undefined, undefined)).toBeUndefined()
  })

  it('merges namespaces shallowly with later chunks winning per key', () => {
    expect(mergeProviderMetadata({ anthropic: { redactedData: 'data' } }, { anthropic: { signature: 'sig' } })).toEqual(
      { anthropic: { redactedData: 'data', signature: 'sig' } }
    )
    expect(mergeProviderMetadata({ anthropic: { signature: 'old' } }, { anthropic: { signature: 'new' } })).toEqual({
      anthropic: { signature: 'new' },
    })
  })
})
