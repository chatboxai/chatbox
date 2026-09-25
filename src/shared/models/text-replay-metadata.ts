import type { LanguageModelV4Content, LanguageModelV4Middleware, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { ProviderMetadata } from 'ai'
import { simulateStreamingMiddleware } from 'ai'
import { mergeProviderMetadata, pickPersistableProviderMetadata } from './provider-part-metadata'

interface PartTransformer {
  transform(chunk: LanguageModelV4StreamPart, controller: { enqueue(chunk: LanguageModelV4StreamPart): void }): void
}

type PartTransformStreamConstructor = new (transformer: PartTransformer) => unknown

/**
 * Maps each stream part one-to-one. `TransformStream` is resolved at runtime
 * because the React Native type environment does not declare it.
 */
function mapStreamParts<TStream>(stream: TStream, map: (part: LanguageModelV4StreamPart) => LanguageModelV4StreamPart) {
  const TransformStreamImpl = (globalThis as typeof globalThis & { TransformStream?: PartTransformStreamConstructor })
    .TransformStream
  if (!TransformStreamImpl) return stream
  return (stream as TStream & { pipeThrough(transform: unknown): TStream }).pipeThrough(
    new TransformStreamImpl({
      transform(chunk, controller) {
        controller.enqueue(map(chunk))
      },
    })
  )
}

/**
 * The AI SDK filters empty text deltas before exposing fullStream. Carry their
 * replay metadata on text-end so both application stream processors receive it.
 */
export const textReplayMetadataMiddleware: LanguageModelV4Middleware = {
  specificationVersion: 'v4',
  wrapStream: async ({ doStream }) => {
    const result = await doStream()
    const metadataById = new Map<string, ProviderMetadata>()
    return {
      ...result,
      stream: mapStreamParts(result.stream, (chunk) => {
        if (chunk.type !== 'text-start' && chunk.type !== 'text-delta' && chunk.type !== 'text-end') return chunk
        const incoming = pickPersistableProviderMetadata(chunk.providerMetadata, ['google'])
        const metadata = mergeProviderMetadata(metadataById.get(chunk.id), incoming)
        if (chunk.type !== 'text-end') {
          if (metadata) metadataById.set(chunk.id, metadata)
          return chunk
        }
        metadataById.delete(chunk.id)
        return { ...chunk, providerMetadata: mergeProviderMetadata(metadata, chunk.providerMetadata) }
      }),
    }
  },
}

/**
 * `simulateStreamingMiddleware` drops text provider metadata and empty text parts,
 * which is where Gemini puts the signature of a response without function calls.
 * Fold each signed text part's metadata onto the text it belongs to (an empty
 * signed part signs the preceding text), then let the simulator replay text
 * parts through `text-end` metadata.
 */
export const simulateStreamingWithTextReplayMetadataMiddleware: LanguageModelV4Middleware = {
  specificationVersion: 'v4',
  wrapStream: async (options) => {
    const simulate = simulateStreamingMiddleware().wrapStream
    if (!simulate) throw new Error('simulateStreamingMiddleware has no wrapStream')
    const signedTexts: Array<ProviderMetadata | undefined> = []
    const result = await simulate({
      ...options,
      doGenerate: async () => {
        const generated = await options.doGenerate()
        const content: LanguageModelV4Content[] = []
        for (const part of generated.content) {
          if (part.type !== 'text') {
            content.push(part)
            continue
          }
          const metadata = pickPersistableProviderMetadata(part.providerMetadata, ['google'])
          const previous = content.at(-1)
          if (!part.text && previous?.type === 'text') {
            signedTexts[signedTexts.length - 1] = mergeProviderMetadata(signedTexts.at(-1), metadata)
            continue
          }
          if (!part.text) continue
          content.push(part)
          signedTexts.push(metadata)
        }
        return { ...generated, content }
      },
    })
    let textIndex = 0
    return {
      ...result,
      stream: mapStreamParts(result.stream, (chunk) => {
        if (chunk.type !== 'text-end') return chunk
        const metadata = signedTexts[textIndex++]
        return metadata ? { ...chunk, providerMetadata: metadata } : chunk
      }),
    }
  },
}
