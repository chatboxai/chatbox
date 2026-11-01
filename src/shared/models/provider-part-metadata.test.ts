import { describe, expect, it } from 'vitest'
import {
  bindReplaySource,
  mergeProviderMetadata,
  pickPersistableProviderMetadata,
  pickReplayMetadata,
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
    // The stream can deliver an item id before the encrypted payload arrives.
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

describe('bindReplaySource', () => {
  it('stamps Responses metadata with its source and drops it without one', () => {
    const metadata = {
      openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted' },
      anthropic: { signature: 's' },
    }
    expect(bindReplaySource(metadata, 'source-a')).toEqual({
      anthropic: { signature: 's' },
      openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted', chatboxReplaySource: 'source-a' },
    })
    expect(bindReplaySource(metadata, undefined)).toEqual({ anthropic: { signature: 's' } })
    expect(bindReplaySource({ google: { thoughtSignature: 'g' } }, undefined)).toEqual({
      google: { thoughtSignature: 'g' },
    })
  })
})

describe('pickReplayMetadata', () => {
  const stored = {
    openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted', chatboxReplaySource: 'source-a' },
    anthropic: { signature: 's' },
  }
  const target = (source: string | undefined, namespaces = ['openai'], itemIds: string[] = []) => ({
    namespaces,
    source,
    replayableOpenAIItemIds: new Set(itemIds),
  })

  it('replays Responses ciphertext only to its own source without local provenance', () => {
    expect(pickReplayMetadata(stored, target('source-a'))).toEqual({
      openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted' },
    })
    expect(pickReplayMetadata(stored, target('source-b'))).toBeUndefined()
    expect(pickReplayMetadata(stored, target(undefined))).toBeUndefined()
    expect(stored.openai.chatboxReplaySource).toBe('source-a')
  })

  it('joins a summary without ciphertext to a replayable item of the same turn', () => {
    const summary = { openai: { itemId: 'rs_0', chatboxReplaySource: 'source-a' } }
    expect(pickReplayMetadata(summary, target('source-a', ['openai'], ['rs_0']))).toEqual({
      openai: { itemId: 'rs_0' },
    })
    expect(pickReplayMetadata(summary, target('source-a'))).toBeUndefined()
  })

  it('keeps only the target route namespaces', () => {
    expect(pickReplayMetadata(stored, target('source-a', ['anthropic']))).toEqual({ anthropic: { signature: 's' } })
  })
})
