import type { Message, MessageContentParts, MessageToolCallPart } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { FilePart, ImagePart, ModelMessage, TextPart, ToolCallPart } from 'ai'
import type { JSONValue } from '@ai-sdk/provider'
import dayjs from 'dayjs'
import { compact } from 'lodash'
import { createModelDependencies } from '@/adapters'
import { cloneMessage, getMessageText } from '../../../shared/utils/message'

async function resolveImageData(
  storageKey: string,
  dependencies: ModelDependencies
): Promise<{ base64Data: string; mediaType: string } | null> {
  try {
    const imageData = await dependencies.storage.getImage(storageKey)
    if (!imageData) return null
    return {
      base64Data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
      mediaType: imageData.match(/^data:([^;]+)/)?.[1] || 'image/png',
    }
  } catch {
    return null
  }
}

function stringifyErrorResult(result: unknown): string {
  if (result == null) return 'Tool call failed'
  if (typeof result === 'string') return result
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    try { return JSON.stringify(result) } catch { /* fall through */ }
  }
  return String(result)
}

async function convertContentParts<T extends TextPart | ImagePart | FilePart>(
  contentParts: MessageContentParts,
  imageType: 'image' | 'file',
  dependencies: ModelDependencies,
  options?: { modelSupportVision: boolean }
): Promise<T[]> {
  return compact(
    await Promise.all(
      contentParts.map(async (c) => {
        if (c.type === 'text') {
          return { type: 'text', text: c.text } as T
        } else if (c.type === 'image') {
          if (options?.modelSupportVision === false) {
            return { type: 'text', text: `This is an image, OCR Result: \n${c.ocrResult}` } as T
          }
          const resolved = await resolveImageData(c.storageKey, dependencies)
          if (!resolved) return null
          if (imageType === 'image') {
            return { type: 'image', image: resolved.base64Data, mediaType: resolved.mediaType } as T
          }
          return { type: 'file', data: resolved.base64Data, mediaType: resolved.mediaType } as T
        }
        return null
      })
    )
  )
}

async function convertUserContentParts(
  contentParts: MessageContentParts,
  dependencies: ModelDependencies,
  options?: { modelSupportVision: boolean }
): Promise<Array<TextPart | ImagePart>> {
  return convertContentParts<TextPart | ImagePart>(contentParts, 'image', dependencies, options)
}

async function convertAssistantContentParts(
  contentParts: MessageContentParts,
  dependencies: ModelDependencies
): Promise<Array<TextPart | FilePart | ToolCallPart>> {
  const results: Array<TextPart | FilePart | ToolCallPart | null> = await Promise.all(
    contentParts.map(async (c) => {
      if (c.type === 'tool-call') {
        if (c.state === 'call') return null
        return {
          type: 'tool-call' as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: c.args,
        } satisfies ToolCallPart
      }
      if (c.type === 'text') {
        return { type: 'text', text: c.text } as TextPart
      }
      if (c.type === 'image') {
        const resolved = await resolveImageData(c.storageKey, dependencies)
        if (!resolved) return null
        return { type: 'file', data: resolved.base64Data, mediaType: resolved.mediaType } as FilePart
      }
      return null
    })
  )
  return results.filter((r): r is TextPart | FilePart | ToolCallPart => r !== null)
}

/**
 * Split assistant contentParts into segments around tool-call boundaries and emit
 * the correct message sequence: assistant(pre-tool + tool-call) → tool(result) → assistant(post-tool).
 * This preserves the ordering that providers expect for multi-turn tool use.
 */
async function emitAssistantMessages(
  contentParts: MessageContentParts,
  dependencies: ModelDependencies,
  output: ModelMessage[]
): Promise<void> {
  const toolCallIndices = contentParts
    .map((c, i) => (c.type === 'tool-call' && c.state !== 'call' ? i : -1))
    .filter((i) => i !== -1)

  if (toolCallIndices.length === 0) {
    const converted = await convertAssistantContentParts(contentParts, dependencies)
    if (converted.length > 0) {
      output.push({ role: 'assistant' as const, content: converted })
    }
    return
  }

  let cursor = 0
  for (const tcIdx of toolCallIndices) {
    const segment = contentParts.slice(cursor, tcIdx + 1)
    const converted = await convertAssistantContentParts(segment, dependencies)
    if (converted.length > 0) {
      output.push({ role: 'assistant' as const, content: converted })
    }

    const tc = contentParts[tcIdx] as MessageToolCallPart
    output.push({
      role: 'tool' as const,
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output:
            tc.state === 'error'
              ? { type: 'error-text' as const, value: stringifyErrorResult(tc.result) }
              : { type: 'json' as const, value: (tc.result ?? null) as JSONValue },
        },
      ],
    })

    cursor = tcIdx + 1
  }

  if (cursor < contentParts.length) {
    const remaining = contentParts.slice(cursor)
    const converted = await convertAssistantContentParts(remaining, dependencies)
    if (converted.length > 0) {
      output.push({ role: 'assistant' as const, content: converted })
    }
  }
}

export async function convertToModelMessages(
  messages: Message[],
  options?: { modelSupportVision: boolean }
): Promise<ModelMessage[]> {
  const dependencies = await createModelDependencies()
  const output: ModelMessage[] = []

  for (const m of messages) {
    switch (m.role) {
      case 'system':
        output.push({
          role: 'system' as const,
          content: getMessageText(m),
        })
        break
      case 'user': {
        const contentParts = await convertUserContentParts(m.contentParts || [], dependencies, options)
        output.push({
          role: 'user' as const,
          content: contentParts,
        })
        break
      }
      case 'assistant':
        await emitAssistantMessages(m.contentParts || [], dependencies, output)
        break
      case 'tool':
        // Tool results are now handled inline from assistant message tool-call parts
        break
      default: {
        const _exhaustiveCheck: never = m.role
        throw new Error(`Unknown role: ${_exhaustiveCheck}`)
      }
    }
  }

  return output
}

/**
 * 在 system prompt 中注入模型信息
 * @param model
 * @param messages
 * @returns
 */
export function injectModelSystemPrompt(
  model: string,
  messages: Message[],
  additionalInfo: string,
  role: 'system' | 'user' = 'system'
) {
  const metadataPrompt = `Current model: ${model}\nCurrent date: ${dayjs().format(
    'YYYY-MM-DD'
  )}\n Additional info for this conversation: ${additionalInfo}\n\n`
  let hasInjected = false
  return messages.map((m) => {
    if (m.role === role && !hasInjected) {
      m = cloneMessage(m) // 复制，防止原始数据在其他地方被直接渲染使用
      m.contentParts = [{ type: 'text', text: metadataPrompt + getMessageText(m) }]
      hasInjected = true
    }
    return m
  })
}
