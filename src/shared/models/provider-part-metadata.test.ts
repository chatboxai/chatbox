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

  it('keeps whitelisted OpenAI Responses replay keys', () => {
    expect(
      pickPersistableProviderMetadata({ openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' } })
    ).toEqual({ openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' } })
    // A bare item id is enough to replay a stored reasoning item via item_reference.
    expect(pickPersistableProviderMetadata({ openai: { itemId: 'rs_1' } })).toEqual({ openai: { itemId: 'rs_1' } })
  })

  it('keeps whitelisted Gemini replay keys', () => {
    expect(pickPersistableProviderMetadata({ google: { thoughtSignature: 'gemini-sig' } })).toEqual({
      google: { thoughtSignature: 'gemini-sig' },
    })
  })

  it('drops non-whitelisted keys and namespaces', () => {
    expect(
      pickPersistableProviderMetadata({
        anthropic: { signature: 'sig', cacheControl: { type: 'ephemeral' } },
        google: { thoughtSignature: 'gemini-sig', thought: true },
        openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' },
        mistral: { usage: { promptTokens: 10 } },
      })
    ).toEqual({
      anthropic: { signature: 'sig' },
      google: { thoughtSignature: 'gemini-sig' },
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' },
    })
  })

  it('restricts the result to the requested namespaces', () => {
    const metadata = {
      anthropic: { signature: 'sig' },
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' },
      google: { thoughtSignature: 'gemini-sig' },
    }

    expect(pickPersistableProviderMetadata(metadata, ['anthropic'])).toEqual({ anthropic: { signature: 'sig' } })
    expect(pickPersistableProviderMetadata(metadata, ['openai'])).toEqual({
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' },
    })
    expect(pickPersistableProviderMetadata(metadata, ['google'])).toEqual({
      google: { thoughtSignature: 'gemini-sig' },
    })
    expect(pickPersistableProviderMetadata(metadata, [])).toBeUndefined()
  })

  it('returns undefined when nothing persistable remains', () => {
    expect(pickPersistableProviderMetadata(undefined)).toBeUndefined()
    expect(pickPersistableProviderMetadata({})).toBeUndefined()
    expect(pickPersistableProviderMetadata({ mistral: { usage: { promptTokens: 10 } } })).toBeUndefined()
    // A whitelisted namespace still needs a whitelisted key inside it.
    expect(pickPersistableProviderMetadata({ google: { thought: true } })).toBeUndefined()
    expect(pickPersistableProviderMetadata({ anthropic: {} })).toBeUndefined()
    expect(pickPersistableProviderMetadata({ openai: { itemId: 'rs_1' } }, ['anthropic'])).toBeUndefined()
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
