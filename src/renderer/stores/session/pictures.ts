import type { Message, MessageImagePart, MessagePicture, SessionSettings } from '@shared/types'
import { createModel } from '@/adapters'
import type { AgentModeEntrySource } from '@/analytics/agent-mode'
import * as appleAppStore from '@/packages/apple_app_store'
import { generateImage } from '@/packages/model-calls'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import type * as chatStore from '../chatStore'
import { settingsStore } from '../settingsStore'
import type { GenerationOutcome } from './generation-outcome'
import { modifyMessage } from './messages'
import { handleGenerationError, initializeTargetMessage, trackGenerateEvent } from './utils'

/**
 * Create n empty picture messages (loading state, for placeholders)
 * @param n Number of empty messages
 * @returns
 */
export function createLoadingPictures(n: number): MessagePicture[] {
  const ret: MessagePicture[] = []
  for (let i = 0; i < n; i++) {
    ret.push({ loading: true })
  }
  return ret
}

/**
 * Orchestrate picture generation for a picture-type session
 */
export async function orchestratePictureGeneration(
  sessionId: string,
  targetMsg: Message,
  session: NonNullable<Awaited<ReturnType<typeof chatStore.getSession>>>,
  settings: SessionSettings,
  options?: { operationType?: 'send_message' | 'regenerate'; agentModeEntrySource?: AgentModeEntrySource }
): Promise<GenerationOutcome> {
  const globalSettings = settingsStore.getState().getSettings()

  // Track generation event
  trackGenerateEvent(sessionId, settings, globalSettings, session.type, options)

  // Reset message state to initial state
  targetMsg = {
    ...(await initializeTargetMessage(targetMsg, settings, globalSettings, session.type)),
    // FIXME: For picture message generation, need to show placeholder
    // pictures: session.type === 'picture' ? createLoadingPictures(settings.imageGenerateNum) : targetMsg.pictures,
    style: session.type === 'picture' ? settings.dalleStyle : undefined,
  }

  await modifyMessage(sessionId, targetMsg)

  // Get the message list where target message is located (may be historical messages), get target message index
  let messages = session.messages
  let targetMsgIx = messages.findIndex((m) => m.id === targetMsg.id)
  if (targetMsgIx <= 0) {
    if (!session.threads) {
      return { status: 'failed', error: 'Target message not found' }
    }
    for (const t of session.threads) {
      messages = t.messages
      targetMsgIx = messages.findIndex((m) => m.id === targetMsg.id)
      if (targetMsgIx > 0) {
        break
      }
    }
    if (targetMsgIx <= 0) {
      return { status: 'failed', error: 'Target message not found' }
    }
  }

  try {
    const model = await createModel(settings)

    // Picture message generation
    if (session.type === 'picture') {
      // Take the most recent user message before the current message as prompt
      const userMessage = messages.slice(0, targetMsgIx).findLast((m) => m.role === 'user')
      if (!userMessage) {
        // Should not happen - user message not found
        throw new Error('No user message found')
      }

      const insertImage = async (image: MessageImagePart) => {
        targetMsg.contentParts.push(image)
        targetMsg.status = []
        await modifyMessage(sessionId, targetMsg, true)
      }
      let imageIndex = 0
      await generateImage(
        model,
        {
          message: userMessage,
          num: settings.imageGenerateNum || 1,
        },
        async (picBase64) => {
          const storageKey = StorageKeyGenerator.picture(`${session.id}:${targetMsg.id}:${imageIndex++}`)
          // Image needs to be stored in indexedDB, if using OpenAI's image link directly, the link will expire over time
          await storage.setBlob(storageKey, picBase64)
          await insertImage({ type: 'image', storageKey })
        }
      )
      targetMsg = {
        ...targetMsg,
        generating: false,
        cancel: undefined,
        status: [],
      }
      await modifyMessage(sessionId, targetMsg, true)
    } else {
      throw new Error(`Unknown session type: ${session.type}, generate failed`)
    }
    appleAppStore.tickAfterMessageGenerated()
    return { status: 'completed' }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err))
    targetMsg = handleGenerationError(error, targetMsg, settings)
    await modifyMessage(sessionId, targetMsg, true)
    return { status: 'failed', error: error.message }
  }
}
