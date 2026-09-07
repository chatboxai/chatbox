import type { Message } from '@shared/types'
import { formatTimestampWithZone, SYSTEM_REMINDER_PROMPT_INSTRUCTION } from '@shared/utils/system-reminder'
import type { ModelMessage } from 'ai'
import dayjs from 'dayjs'
import { createModelDependencies } from '@/adapters'
import {
  type ConvertToModelMessagesOptions,
  convertToModelMessages as sharedConvertToModelMessages,
} from '../../../shared/services/model-message-converter'
import { cloneMessage, getMessageText } from '../../../shared/utils/message'

/**
 * Convert internal `Message[]` into AI SDK `ModelMessage[]`.
 *
 * Thin renderer wrapper over the shared converter: it resolves the renderer's
 * `ModelDependencies` image storage and injects it as the `resolveImage` seam.
 * The actual conversion logic lives in `@shared/services/model-message-converter`
 * and is shared with the native chat engine.
 */
export async function convertToModelMessages(
  messages: Message[],
  options?: ConvertToModelMessagesOptions
): Promise<ModelMessage[]> {
  const dependencies = await createModelDependencies()
  return sharedConvertToModelMessages(messages, (storageKey) => dependencies.storage.getImage(storageKey), options)
}

export interface ModelSystemPromptMetadataOptions {
  /**
   * Freeze the runtime timestamp line to the conversation's start instead of
   * "now". A timestamp that moves mid-conversation rewrites the system prompt
   * and invalidates the provider prompt-cache prefix on every request. The
   * frozen anchor can afford minute precision + timezone; the live clock rides
   * the ephemeral tail `<system-reminder>` instead (see agent-harness).
   */
  conversationStartedAt?: number
  /**
   * Frozen device UTC offset (minutes east of UTC) captured with the snapshot.
   * Keeps the line byte-stable across device timezone changes; when absent the
   * offset is derived from the anchor instant under the current device zone.
   */
  conversationStartUtcOffsetMinutes?: number
}

export function buildModelSystemPrompt(
  model: string,
  additionalInfo: string,
  options?: ModelSystemPromptMetadataOptions
): string {
  const startedAt = formatTimestampWithZone(
    options?.conversationStartedAt ?? Date.now(),
    options?.conversationStartUtcOffsetMinutes
  )
  return `Additional info for this conversation: ${additionalInfo}\n\n## Runtime\nCurrent model: ${model}\nConversation started: ${startedAt}\n${SYSTEM_REMINDER_PROMPT_INSTRUCTION}`
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
  role: 'system' | 'user' = 'system',
  systemPrompt = buildModelSystemPrompt(model, additionalInfo)
) {
  let hasInjected = false
  const injectedMessages = messages.map((m) => {
    if (m.role === role && !hasInjected) {
      m = cloneMessage(m) // 复制，防止原始数据在其他地方被直接渲染使用
      // Metadata goes BELOW the session's own prompt: stable content keeps the
      // byte-0 position and the volatile model/date block sits last, so the
      // prompt-cache prefix survives model switches and day rollovers.
      const existingText = getMessageText(m)
      const injectedText = existingText ? `${existingText}\n\n${systemPrompt.trimEnd()}` : systemPrompt.trimEnd()
      m.contentParts = [{ type: 'text', text: injectedText }]
      hasInjected = true
    }
    return m
  })

  if (!hasInjected) {
    injectedMessages.unshift({
      id: `injected-system-prompt-${dayjs().valueOf()}`,
      role,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: systemPrompt.trimEnd() }],
    })
  }

  return injectedMessages
}
