import { ModelProviderEnum } from '../types'

// Re-export getModel and getProviderSettings from providers for backward compatibility
// This allows existing imports like `import { getModel } from '@shared/models'` to continue working
export { getModel, getProviderSettings } from '../providers'

export const aiProviderNameHash: Record<ModelProviderEnum, string> = {
  [ModelProviderEnum.OpenAI]: 'OpenAI API',
  [ModelProviderEnum.OpenAIResponses]: 'OpenAI Responses API',
  [ModelProviderEnum.Azure]: 'Azure OpenAI API',
  [ModelProviderEnum.ChatGLM6B]: 'ChatGLM API',
  [ModelProviderEnum.ChatboxAI]: 'Chatbox AI',
  [ModelProviderEnum.Claude]: 'Claude API',
  [ModelProviderEnum.Gemini]: 'Google Gemini API',
  [ModelProviderEnum.Qwen]: 'Qwen API',
  [ModelProviderEnum.QwenPortal]: 'Qwen Portal',
  [ModelProviderEnum.MiniMax]: 'MiniMax Global API',
  [ModelProviderEnum.MiniMaxCN]: 'MiniMax CN API',
  [ModelProviderEnum.Moonshot]: 'Moonshot AI API',
  [ModelProviderEnum.MoonshotCN]: 'Moonshot CN API',
  [ModelProviderEnum.Ollama]: 'Ollama API',
  [ModelProviderEnum.Groq]: 'Groq API',
  [ModelProviderEnum.DeepSeek]: 'DeepSeek API',
  [ModelProviderEnum.SiliconFlow]: 'SiliconFlow API',
  [ModelProviderEnum.VolcEngine]: 'VolcEngine API',
  [ModelProviderEnum.MistralAI]: 'MistralAI',
  [ModelProviderEnum.LMStudio]: 'LM Studio API',
  [ModelProviderEnum.Perplexity]: 'Perplexity API',
  [ModelProviderEnum.XAI]: 'xAI API',
  [ModelProviderEnum.OpenRouter]: 'OpenRouter API',
  [ModelProviderEnum.Bedrock]: 'AWS Bedrock',
  [ModelProviderEnum.VercelAIGateway]: 'Vercel AI Gateway',
  [ModelProviderEnum.OpenCodeGo]: 'OpenCode Go',
  [ModelProviderEnum.OpenCodeZen]: 'OpenCode Zen',
  [ModelProviderEnum.TencentHunyuan]: 'Tencent Hunyuan API',
  [ModelProviderEnum.XiaomiMiMo]: 'Xiaomi MiMo API',
  [ModelProviderEnum.LongCat]: 'LongCat API',
  [ModelProviderEnum.ZhipuGLMCodingPlan]: 'GLM Coding Plan',
  [ModelProviderEnum.Custom]: 'Custom Provider',
}

export const AIModelProviderMenuOptionList = [
  {
    value: ModelProviderEnum.ChatboxAI,
    label: aiProviderNameHash[ModelProviderEnum.ChatboxAI],
    featured: true,
    disabled: false,
  },
  {
    value: ModelProviderEnum.OpenAI,
    label: aiProviderNameHash[ModelProviderEnum.OpenAI],
    disabled: false,
  },
  {
    value: ModelProviderEnum.OpenAIResponses,
    label: aiProviderNameHash[ModelProviderEnum.OpenAIResponses],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Claude,
    label: aiProviderNameHash[ModelProviderEnum.Claude],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Gemini,
    label: aiProviderNameHash[ModelProviderEnum.Gemini],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Ollama,
    label: aiProviderNameHash[ModelProviderEnum.Ollama],
    disabled: false,
  },
  {
    value: ModelProviderEnum.LMStudio,
    label: aiProviderNameHash[ModelProviderEnum.LMStudio],
    disabled: false,
  },
  {
    value: ModelProviderEnum.DeepSeek,
    label: aiProviderNameHash[ModelProviderEnum.DeepSeek],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Qwen,
    label: aiProviderNameHash[ModelProviderEnum.Qwen],
    disabled: false,
  },
  {
    value: ModelProviderEnum.QwenPortal,
    label: aiProviderNameHash[ModelProviderEnum.QwenPortal],
    disabled: false,
  },
  {
    value: ModelProviderEnum.MiniMax,
    label: aiProviderNameHash[ModelProviderEnum.MiniMax],
    disabled: false,
  },
  {
    value: ModelProviderEnum.MiniMaxCN,
    label: aiProviderNameHash[ModelProviderEnum.MiniMaxCN],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Moonshot,
    label: aiProviderNameHash[ModelProviderEnum.Moonshot],
    disabled: false,
  },
  {
    value: ModelProviderEnum.MoonshotCN,
    label: aiProviderNameHash[ModelProviderEnum.MoonshotCN],
    disabled: false,
  },
  {
    value: ModelProviderEnum.SiliconFlow,
    label: aiProviderNameHash[ModelProviderEnum.SiliconFlow],
    disabled: false,
  },
  {
    value: ModelProviderEnum.OpenRouter,
    label: aiProviderNameHash[ModelProviderEnum.OpenRouter],
    disabled: false,
  },
  {
    value: ModelProviderEnum.MistralAI,
    label: aiProviderNameHash[ModelProviderEnum.MistralAI],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Azure,
    label: aiProviderNameHash[ModelProviderEnum.Azure],
    disabled: false,
  },
  {
    value: ModelProviderEnum.XAI,
    label: aiProviderNameHash[ModelProviderEnum.XAI],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Perplexity,
    label: aiProviderNameHash[ModelProviderEnum.Perplexity],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Groq,
    label: aiProviderNameHash[ModelProviderEnum.Groq],
    disabled: false,
  },
  {
    value: ModelProviderEnum.Bedrock,
    label: aiProviderNameHash[ModelProviderEnum.Bedrock],
    disabled: false,
  },
  {
    value: ModelProviderEnum.VercelAIGateway,
    label: aiProviderNameHash[ModelProviderEnum.VercelAIGateway],
    disabled: false,
  },
  {
    value: ModelProviderEnum.OpenCodeGo,
    label: aiProviderNameHash[ModelProviderEnum.OpenCodeGo],
    disabled: false,
  },
  {
    value: ModelProviderEnum.OpenCodeZen,
    label: aiProviderNameHash[ModelProviderEnum.OpenCodeZen],
    disabled: false,
  },
  {
    value: ModelProviderEnum.ChatGLM6B,
    label: aiProviderNameHash[ModelProviderEnum.ChatGLM6B],
    disabled: false,
  },
  {
    value: ModelProviderEnum.TencentHunyuan,
    label: aiProviderNameHash[ModelProviderEnum.TencentHunyuan],
    disabled: false,
  },
  {
    value: ModelProviderEnum.XiaomiMiMo,
    label: aiProviderNameHash[ModelProviderEnum.XiaomiMiMo],
    disabled: false,
  },
  {
    value: ModelProviderEnum.LongCat,
    label: aiProviderNameHash[ModelProviderEnum.LongCat],
    disabled: false,
  },
  {
    value: ModelProviderEnum.ZhipuGLMCodingPlan,
    label: aiProviderNameHash[ModelProviderEnum.ZhipuGLMCodingPlan],
    disabled: false,
  },
]
