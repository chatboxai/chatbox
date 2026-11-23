import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import { createOllamaReasoningFetch } from '../../../models/utils/ollama-reasoning-fetch'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'

const helpers = {
  isModelSupportVision: (model: string) => {
    return [
      'gemma3',
      'llava',
      'llama3.2-vision',
      'llava-llama3',
      'moondream',
      'bakllava',
      'llava-phi3',
      'granite3.2-vision',
      'qwen3',
    ].some((m) => model.startsWith(m))
  },
  isModelSupportToolUse: (model: string) => {
    return [
      'qwq',
      'llama3.3',
      'llama3.2',
      'llama3.1',
      'mistral',
      'qwen2.5',
      'qwen2.5-coder',
      'qwen2',
      'mistral-nemo',
      'mixtral',
      'smollm2',
      'mistral-small',
      'command-r',
      'hermes3',
      'mistral-large',
      'qwen3',
    ].some((m) => model.startsWith(m))
  },
}

interface OllamaOptions extends OpenAICompatibleSettings {
  ollamaHost: string
}

export default class Ollama extends OpenAICompatible {
  public name = 'Ollama'
  public options: OllamaOptions

  constructor(options: Omit<OllamaOptions, 'apiKey' | 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = normalizeOpenAIApiHostAndPath({ apiHost: options.ollamaHost }).apiHost
    super(
      {
        apiKey: 'ollama',
        apiHost,
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
        useProxy: options.useProxy,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiKey: 'ollama',
      apiHost,
      customFetch: createOllamaReasoningFetch(
        options.customFetch ?? createFetchWithProxy(options.useProxy, dependencies)
      ),
    }
  }
  public isSupportToolUse(): boolean {
    return helpers.isModelSupportToolUse(this.options.model.modelId) || super.isSupportToolUse()
  }
  public isSupportVision(): boolean {
    return helpers.isModelSupportVision(this.options.model.modelId) || super.isSupportVision()
  }
}
