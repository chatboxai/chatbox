import OpenAICompatible from './openai-compatible'
import { normalizeOpenAIApiHostAndPath } from './llm_utils'
import { ProviderModelInfo } from 'src/shared/types'

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
    ].some((m) => model.startsWith(m))
  },
}

interface Options {
  ollamaHost: string
  model: ProviderModelInfo
  temperature: number
}

export default class Ollama extends OpenAICompatible {
  public name = 'Ollama'

  constructor(public options: Options) {
    super({
      apiKey: 'ollama',
      apiHost: normalizeOpenAIApiHostAndPath({ apiHost: options.ollamaHost }).apiHost,
      model: options.model,
      temperature: options.temperature,
    })
  }
}
