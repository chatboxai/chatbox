import { getModel } from '@shared/models'
import type { ModelInterface } from '@shared/models/types'
import type { Message, Settings } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { getModelSettings } from '@shared/utils/model_settings'
import type { ModelMessage } from 'ai'
import pMap from 'p-map'
import { createModelDependencies } from '@/adapters'

/**
 * Resolve the OCR model based on user settings and license key.
 * User-configured OCR model takes priority; Chatbox AI is the fallback.
 * Returns null if no OCR model is available (caller decides how to handle).
 */
export function getOCRModel(
  globalSettings: Settings,
  configs: { uuid: string },
  dependencies: ModelDependencies
): { model: ModelInterface; providerName: string } | null {
  const hasUserOcrModel = !!(globalSettings.ocrModel?.provider && globalSettings.ocrModel?.model)
  const hasLicenseKey = !!globalSettings.licenseKey

  if (!hasUserOcrModel && !hasLicenseKey) {
    return null
  }

  if (hasUserOcrModel) {
    // User has explicitly configured an OCR model — always respect their choice
    const ocrModelSetting = globalSettings.ocrModel!
    const modelSettings = getModelSettings(globalSettings, ocrModelSetting.provider, ocrModelSetting.model)
    return {
      model: getModel(modelSettings, globalSettings, configs, dependencies),
      providerName: ocrModelSetting.provider,
    }
  }

  // Fallback to Chatbox AI built-in OCR model
  const modelSettings = getModelSettings(globalSettings, ModelProviderEnum.ChatboxAI, 'chatbox-ocr-1')
  return {
    model: getModel(modelSettings, globalSettings, configs, dependencies),
    providerName: 'Chatbox AI',
  }
}

/**
 * Run OCR on all image parts in messages that don't yet have an ocrResult.
 * Mutates message contentParts in place (sets `ocrResult` on image parts).
 * Uses p-map with concurrency: 3 for parallel OCR processing.
 */
export async function ocrImagesInMessages(
  messages: Message[],
  ocrModel: ModelInterface,
  sessionId: string
): Promise<void> {
  const imageParts: Array<{ storageKey: string; part: Message['contentParts'][number] & { type: 'image' } }> = []
  for (const msg of messages) {
    for (const part of msg.contentParts) {
      if (part.type === 'image' && !part.ocrResult) {
        imageParts.push({ storageKey: part.storageKey, part })
      }
    }
  }

  if (imageParts.length === 0) return

  const dependencies = await createModelDependencies()

  await pMap(
    imageParts,
    async ({ storageKey, part }) => {
      const imageData = await dependencies.storage.getImage(storageKey)
      if (!imageData) return

      const ocrMsg: ModelMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              'OCR the following image into Markdown.',
              'Tables should be formatted as HTML.',
              'Do not surround your output with triple backticks.',
            ].join(' '),
          },
          { type: 'image' as const, image: imageData },
        ],
      }
      const chatResult = await ocrModel.chat([ocrMsg], { sessionId })
      const text = chatResult.contentParts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('')

      part.ocrResult = text
    },
    { concurrency: 3 }
  )
}
