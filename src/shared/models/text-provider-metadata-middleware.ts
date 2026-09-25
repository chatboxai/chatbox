import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware, ProviderMetadata } from 'ai'
import { mergeProviderMetadata, pickPersistableProviderMetadata } from './provider-part-metadata'

/**
 * Preserves replay metadata that the AI SDK drops on the way out of a provider stream.
 *
 * Gemini attaches its `thoughtSignature` to the response's last text part and streams it as an
 * **empty** trailing `text-delta` carrying only provider metadata. `streamText` filters exactly
 * those chunks out:
 *
 * ```js
 * case "text-delta": {
 *   if (chunk.delta.length > 0) { controller.enqueue(...) }
 * ```
 *
 * (`ai@6.0.67`, `dist/index.js`), so the signature never reaches the application stream
 * processors — handling the empty delta there is too late. `text-end` is enqueued
 * unconditionally, so this middleware runs inside the provider boundary (before that filter),
 * accumulates the metadata per text-block id, and re-attaches it to the block's `text-end`.
 *
 * Accumulating per block id — rather than per stream — keeps signed block boundaries intact, so
 * one block's signature can never end up associated with another block's text.
 */
export function preserveTextProviderMetadataMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()

      const metadataByBlockId = new Map<string, ProviderMetadata>()

      return {
        ...rest,
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(chunk, controller) {
              switch (chunk.type) {
                case 'text-start': {
                  metadataByBlockId.delete(chunk.id)
                  controller.enqueue(chunk)
                  return
                }

                case 'text-delta': {
                  const persistable = pickPersistableProviderMetadata(chunk.providerMetadata, undefined, 'text')
                  if (persistable) {
                    metadataByBlockId.set(
                      chunk.id,
                      mergeProviderMetadata(metadataByBlockId.get(chunk.id), persistable) ?? persistable
                    )
                  }
                  controller.enqueue(chunk)
                  return
                }

                case 'text-end': {
                  const accumulated = metadataByBlockId.get(chunk.id)
                  metadataByBlockId.delete(chunk.id)
                  controller.enqueue(
                    accumulated
                      ? {
                          ...chunk,
                          providerMetadata: mergeProviderMetadata(chunk.providerMetadata, accumulated),
                        }
                      : chunk
                  )
                  return
                }

                default:
                  controller.enqueue(chunk)
              }
            },
          })
        ),
      }
    },
  }
}
