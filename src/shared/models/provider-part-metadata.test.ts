import { describe, expect, it } from 'vitest'
import {
  hasReplayableSignedReasoning,
  mergeProviderMetadata,
  pickPersistableProviderMetadata,
} from './provider-part-metadata'

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
    // The id is retained while the turn is in flight (it identifies the item), but it is not
    // by itself replayable history — see hasReplayableSignedReasoning.
    expect(pickPersistableProviderMetadata({ openai: { itemId: 'rs_1' } })).toEqual({ openai: { itemId: 'rs_1' } })
  })

  it('keeps only Gemini signatures on text parts', () => {
    // Text parts replay Gemini's signature. OpenAI's item id / encrypted payload are
    // reasoning-part state, so retaining them on a text part would only widen what a later
    // foreign route is shown.
    expect(
      pickPersistableProviderMetadata(
        {
          google: { thoughtSignature: 'gemini-sig' },
          openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' },
          anthropic: { signature: 'sig' },
        },
        undefined,
        'text'
      )
    ).toEqual({ google: { thoughtSignature: 'gemini-sig' } })
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

describe('hasReplayableSignedReasoning', () => {
  it('accepts self-contained signatures', () => {
    expect(hasReplayableSignedReasoning({ anthropic: { signature: 'sig' } })).toBe(true)
    expect(hasReplayableSignedReasoning({ anthropic: { redactedData: 'data' } })).toBe(true)
    expect(hasReplayableSignedReasoning({ google: { thoughtSignature: 'gemini-sig' } })).toBe(true)
  })

  it('requires the encrypted payload, not just an OpenAI item id', () => {
    // Chatbox forces `store: false`, so an id-only item points at server-side reasoning state
    // that is guaranteed absent on the follow-up request.
    expect(hasReplayableSignedReasoning({ openai: { itemId: 'rs_1' } })).toBe(false)
    expect(hasReplayableSignedReasoning({ openai: { reasoningEncryptedContent: 'encrypted' } })).toBe(true)
    expect(hasReplayableSignedReasoning({ openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' } })).toBe(
      true
    )
  })

  it('rejects missing or non-replayable metadata', () => {
    expect(hasReplayableSignedReasoning(undefined)).toBe(false)
    expect(hasReplayableSignedReasoning({})).toBe(false)
    expect(hasReplayableSignedReasoning({ openai: {} })).toBe(false)
    expect(hasReplayableSignedReasoning({ mistral: { usage: { promptTokens: 10 } } })).toBe(false)
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
