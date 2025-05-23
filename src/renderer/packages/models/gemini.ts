import { apiRequest } from '@/utils/request'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { LanguageModelV1 } from 'ai' // Assuming this is from Vercel AI SDK
import AbstractAISDKModel, { CallSettings } from './abstract-ai-sdk'
import { CallChatCompletionOptions, ModelHelpers } from './types'
import { ApiError } from './errors'

export type GeminiModel = keyof typeof modelConfig

// https://ai.google.dev/models/gemini?hl=zh-cn
export const modelConfig = {
  // --- Existing Models (example, ensure your full list is here) ---
  'gemini-2.0-flash-exp': {
    vision: true,
  },
  'gemini-2.0-flash-thinking-exp': {
    vision: true,
  },
  'gemini-2.0-flash-thinking-exp-1219': {
    vision: true,
  },
  'gemini-1.5-pro-latest': {
    vision: true,
  },
  'gemini-1.5-flash-latest': {
    vision: true,
  },
  'gemini-1.5-pro-exp-0827': {
    vision: true,
  },
  'gemini-1.5-flash-exp-0827': {
    vision: true,
  },
  'gemini-1.5-flash-8b-exp-0924': {
    vision: true,
  },
  'gemini-pro': { // This likely refers to gemini-1.0-pro
    vision: false,
  },

  // --- NEW MODELS ADDED ---
  'gemini-2.5-flash-preview-04-17': {
    vision: true, // VERIFY THIS: Assume true for now, but check official docs
  },
  'gemini-2.5-pro-exp-03-25': {
    vision: true, // VERIFY THIS: Assume true for now, but check official docs
  },
  // --- END NEW MODELS ---
}

export const geminiModels: GeminiModel[] = Object.keys(modelConfig) as GeminiModel[]

const helpers: ModelHelpers = {
  isModelSupportVision: (model: string) => {
    // It's best to rely on the modelConfig for this
    if (model in modelConfig) {
      return modelConfig[model as GeminiModel].vision;
    }
    // Fallback logic (can be simplified if modelConfig is comprehensive)
    // This old logic might be too simple for newer models.
    if (model.startsWith('gemini-pro') && !model.includes('vision') && !model.startsWith('gemini-1.5-pro') && !model.startsWith('gemini-2.5-pro')) {
      return false
    }
    if (model.startsWith('gemini-1.0') && !model.includes('vision')) { // More specific for older gemini-pro
      return false
    }
    // Default assumption for unlisted models (can be risky)
    return true
  },
  isModelSupportToolUse: (model: string) => {
    // Most modern Gemini models, especially Pro and newer Flash, support tool use.
    // VERIFY for specific experimental models if unsure.
    // For example, you might want to be more explicit:
    if (model.startsWith('gemini-2.5')) {
        return true;
    }
    // Add other specific checks if needed
    return true // General assumption
  },
}

interface Options {
  geminiAPIKey: string
  geminiAPIHost: string
  geminiModel: GeminiModel // This will now correctly type check against the updated modelConfig
  temperature: number
}

export default class Gemeni extends AbstractAISDKModel {
  public name = 'Google Gemini'
  public static helpers = helpers

  constructor(public options: Options) {
    super()
    this.injectDefaultMetadata = false
  }

  isSupportToolUse() {
    return Gemeni.helpers.isModelSupportToolUse(this.options.geminiModel)
  }

  isSupportSystemMessage() {
    // VERIFY if these new models ('gemini-2.5-*') have different system message support.
    // Typically, newer models should support system messages.
    // The existing exclusion list is for older 'gemini-2.0-flash-exp' variants.
    // If new models also have restrictions, add them to the list.
    return !['gemini-2.0-flash-exp', 'gemini-2.0-flash-thinking-exp', 'gemini-2.0-flash-exp-image-generation'].includes(
      this.options.geminiModel
    )
  }

  protected getChatModel(options: CallChatCompletionOptions): LanguageModelV1 {
    const provider = createGoogleGenerativeAI({
      apiKey: this.options.geminiAPIKey,
      // Ensure your geminiAPIHost is correct, especially for preview/experimental models
      baseURL: `${this.options.geminiAPIHost}/v1beta` || undefined,
    })

    // The Vercel AI SDK's provider.chat() will use this.options.geminiModel
    return provider.chat(this.options.geminiModel, {
      structuredOutputs: false, // Default for general chat
      safetySettings: [ // Consider making safetySettings configurable or check defaults for new models
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      ],
      // generationConfig: { // You might want to expose or configure this too
      //   temperature: this.options.temperature,
      //   // topK, topP, maxOutputTokens etc.
      // }
    })
  }

  protected getCallSettings(): CallSettings {
    const settings: CallSettings = {}
    // VERIFY if new 'gemini-2.5-*' models require specific 'providerOptions'
    // for certain functionalities (like image generation if they support it differently).
    if (['gemini-2.0-flash-exp', 'gemini-2.0-flash-exp-image-generation'].includes(this.options.geminiModel)) {
      settings.providerOptions = {
        google: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }
    }
    return settings
  }

  async listModels(): Promise<string[]> {
    // This method fetches models dynamically.
    // If your new models are correctly listed by the API endpoint, they should appear.
    // However, the hardcoded `modelConfig` is often used for UI pickers or internal logic
    // before an API call is made.
    type Response = {
      models: {
        name: string
        // ... other properties
        supportedGenerationMethods: string[]
      }[]
    }
    const res = await apiRequest.get(`${this.options.geminiAPIHost}/v1beta/models?key=${this.options.geminiAPIKey}`, {})
    const json: Response = await res.json()
    if (!json['models']) {
      console.error('Failed to list models, API response:', json); // Log the actual error
      throw new ApiError(`Failed to parse models list: ${JSON.stringify(json)}`)
    }
    return json['models']
      .filter((m) => m['supportedGenerationMethods']?.some((method) => method.includes('generate'))) // Add optional chaining for safety
      .filter((m) => m['name']?.includes('gemini')) // Add optional chaining for safety
      .map((m) => m['name'].replace('models/', ''))
      .sort()
  }
}
