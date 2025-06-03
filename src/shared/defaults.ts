import { Theme, Config, Settings, ModelProvider, ModelProviderType, ProviderBaseInfo, SessionSettings } from './types'
import { v4 as uuidv4 } from 'uuid'

export function settings(): Settings {
  return {
    // aiProvider: ModelProvider.OpenAI,
    // openaiKey: '',
    // apiHost: 'https://api.openai.com',
    // dalleStyle: 'vivid',
    // imageGenerateNum: 3,
    // openaiUseProxy: false,

    // azureApikey: '',
    // azureDeploymentName: '',
    // azureDeploymentNameOptions: [],
    // azureDalleDeploymentName: 'dall-e-3',
    // azureEndpoint: '',
    // azureApiVersion: '2024-05-01-preview',

    // chatglm6bUrl: '', // deprecated
    // chatglmApiKey: '',
    // chatglmModel: '',

    // model: 'gpt-4o',
    // openaiCustomModelOptions: [],
    // temperature: 0.7,
    // topP: 1,
    // // openaiMaxTokens: 0,
    // // openaiMaxContextTokens: 4000,
    // openaiMaxContextMessageCount: 20,
    // // maxContextSize: "4000",
    // // maxTokens: "2048",

    // claudeApiKey: '',
    // claudeApiHost: 'https://api.anthropic.com/v1',
    // claudeModel: 'claude-3-5-sonnet-20241022',
    // claudeApiKey: '',
    // claudeApiHost: 'https://api.anthropic.com',
    // claudeModel: 'claude-3-5-sonnet-20241022',

    // chatboxAIModel: 'chatboxai-3.5',

    // geminiAPIKey: '',
    // geminiAPIHost: 'https://generativelanguage.googleapis.com',
    // geminiModel: 'gemini-1.5-pro-latest',

    // ollamaHost: 'http://127.0.0.1:11434',
    // ollamaModel: '',

    // groqAPIKey: '',
    // groqModel: 'llama3-70b-8192',

    // deepseekAPIKey: '',
    // deepseekModel: 'deepseek-chat',

    // siliconCloudKey: '',
    // siliconCloudModel: 'Qwen/Qwen2.5-7B-Instruct',

    // lmStudioHost: 'http://127.0.0.1:1234/v1',
    // lmStudioModel: '',

    // perplexityApiKey: '',
    // perplexityModel: 'llama-3.1-sonar-large-128k-online',

    // xAIKey: '',
    // xAIModel: 'grok-beta',

    // customProviders: [],

    showWordCount: false,
    showTokenCount: false,
    showTokenUsed: true,
    showModelName: true,
    showMessageTimestamp: false,
    showFirstTokenLatency: false,
    userAvatarKey: '',
    defaultAssistantAvatarKey: '',
    theme: Theme.System,
    language: 'en',
    fontSize: 14,
    spellCheck: true,

    defaultPrompt: getDefaultPrompt(),

    allowReportingAndTracking: true,

    enableMarkdownRendering: true,
    enableLaTeXRendering: true,
    enableMermaidRendering: true,
    injectDefaultMetadata: true,
    autoPreviewArtifacts: false,
    autoCollapseCodeBlock: true,
    pasteLongTextAsAFile: true,

    autoGenerateTitle: true,

    autoLaunch: false,
    autoUpdate: true,
    betaUpdate: false,

    shortcuts: {
      quickToggle: 'Alt+`', // 快速切换窗口显隐的快捷键
      inputBoxFocus: 'mod+i', // 聚焦输入框的快捷键
      inputBoxWebBrowsingMode: 'mod+e', // 切换输入框的 web 浏览模式的快捷键
      newChat: 'mod+n', // 新建聊天的快捷键
      newPictureChat: 'mod+shift+n', // 新建图片会话的快捷键
      sessionListNavNext: 'mod+tab', // 切换到下一个会话的快捷键
      sessionListNavPrev: 'mod+shift+tab', // 切换到上一个会话的快捷键
      sessionListNavTargetIndex: 'mod', // 会话导航的快捷键
      messageListRefreshContext: 'mod+r', // 刷新上下文的快捷键
      dialogOpenSearch: 'mod+k', // 打开搜索对话框的快捷键
      inpubBoxSendMessage: 'Enter', // 发送消息的快捷键
      inpubBoxSendMessageWithoutResponse: 'Ctrl+Enter', // 发送但不生成回复的快捷键
      optionNavUp: 'up', // 选项导航的快捷键
      optionNavDown: 'down', // 选项导航的快捷键
      optionSelect: 'enter', // 选项导航的快捷键
    },
    extension: {
      webSearch: {
        provider: 'build-in',
        tavilyApiKey: '',
      },
    },
  }
}

export function newConfigs(): Config {
  return { uuid: uuidv4() }
}

export function getDefaultPrompt() {
  return 'You are a helpful assistant.'
}

export function chatSessionSettings(): SessionSettings {
  return {
    provider: ModelProvider.ChatboxAI,
    modelId: 'chatboxai-4',
    maxContextMessageCount: 6,
  }
}

export function pictureSessionSettings(): SessionSettings {
  return {
    provider: ModelProvider.ChatboxAI,
    modelId: 'DALL-E-3',
    imageGenerateNum: 3,
    dalleStyle: 'vivid',
  }
}

export const SystemProviders: ProviderBaseInfo[] = [
  {
    id: ModelProvider.ChatboxAI,
    name: 'Chatbox AI',
    type: ModelProviderType.ChatboxAI,
  },
  {
    id: ModelProvider.OpenAI,
    name: 'OpenAI',
    type: ModelProviderType.OpenAI,
    urls: {
      website: 'https://openai.com',
    },
    defaultSettings: {
      apiHost: 'https://api.openai.com',
      models: [
        {
          modelId: 'gpt-4o-mini',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4o-mini-2024-07-18',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4o',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4o-2024-05-13',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4o-2024-08-06',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4o-2024-11-20',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'chatgpt-4o-latest',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4',
          contextWindow: 8_192,
        },
        {
          modelId: 'gpt-4-turbo',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4-turbo-2024-04-09',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4-0613',
          contextWindow: 8_192,
        },
        {
          modelId: 'gpt-4-32k',
          contextWindow: 32_768,
        },
        {
          modelId: 'gpt-4-32k-0613',
          contextWindow: 32_768,
        },
        {
          modelId: 'gpt-4-1106-preview',
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4-0125-preview',
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4-turbo-preview',
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4-vision-preview',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'o1',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'o1-2024-12-17',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'o1-preview',
          contextWindow: 128_000,
        },
        {
          modelId: 'o1-preview-2024-09-12',
          contextWindow: 128_000,
        },
        {
          modelId: 'o1-mini',
          contextWindow: 128_000,
        },
        {
          modelId: 'o1-mini-2024-09-12',
          contextWindow: 128_000,
        },
        {
          modelId: 'o3-mini',
          contextWindow: 200_000,
        },
        {
          modelId: 'o3-mini-2025-01-31',
          contextWindow: 200_000,
        },
      ],
    },
  },
  {
    id: ModelProvider.Claude,
    name: 'Claude',
    type: ModelProviderType.OpenAI,
    urls: {
      website: 'https://www.anthropic.com',
    },
    defaultSettings: {
      apiHost: 'https://api.anthropic.com/v1',
      models: [
        {
          modelId: 'claude-3-7-sonnet-latest',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 200_000,
        },
        {
          modelId: 'claude-3-5-sonnet-latest',
          capabilities: ['vision'],
          contextWindow: 200_000,
        },
        {
          modelId: 'claude-3-5-haiku-latest',
          capabilities: ['vision'],
          contextWindow: 200_000,
        },
        {
          modelId: 'claude-3-opus-latest',
          capabilities: ['vision'],
          contextWindow: 200_000,
        },
      ],
    },
  },
  {
    id: ModelProvider.Gemini,
    name: 'Gemini',
    type: ModelProviderType.OpenAI,
    urls: {
      website: 'https://gemini.google.com/',
    },
    defaultSettings: {
      apiHost: 'https://generativelanguage.googleapis.com',
      models: [
        {
          modelId: 'gemini-2.5-flash-preview-05-20',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-2.5-pro-preview-05-06',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-2.0-flash-exp',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-2.0-flash-thinking-exp',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-2.0-flash-thinking-exp-1219',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-1.5-pro-latest',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-1.5-flash-latest',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-1.5-pro-exp-0827',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-1.5-flash-exp-0827',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-1.5-flash-8b-exp-0924',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-pro',
        },
      ],
    },
  },
  {
    id: ModelProvider.Ollama,
    name: 'Ollama',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'http://127.0.0.1:11434',
    },
  },
  {
    id: ModelProvider.LMStudio,
    name: 'LM Studio',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'http://127.0.0.1:1234',
    },
  },
  {
    id: ModelProvider.DeepSeek,
    name: 'DeepSeek',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      models: [
        {
          modelId: 'deepseek-chat',
          contextWindow: 64_000,
        },
        {
          modelId: 'deepseek-coder',
          contextWindow: 64_000,
        },
        {
          modelId: 'deepseek-reasoner',
          contextWindow: 64_000,
          capabilities: ['reasoning'],
        },
      ],
    },
  },
  {
    id: ModelProvider.SiliconFlow,
    name: 'SiliconFlow',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'https://api.siliconflow.cn',
      models: [
        {
          modelId: 'deepseek-ai/DeepSeek-V3',
          capabilities: ['tool_use'],
          contextWindow: 64_000,
        },
        {
          modelId: 'deepseek-ai/DeepSeek-R1',
          capabilities: ['reasoning', 'tool_use'],
          contextWindow: 64_000,
        },
        {
          modelId: 'Pro/deepseek-ai/DeepSeek-R1',
          capabilities: ['reasoning', 'tool_use'],
          contextWindow: 64_000,
        },
        {
          modelId: 'Pro/deepseek-ai/DeepSeek-V3',
          capabilities: ['tool_use'],
          contextWindow: 64_000,
        },

        {
          modelId: 'Qwen/Qwen2.5-7B-Instruct',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
        },
        {
          modelId: 'Qwen/Qwen2.5-14B-Instruct',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
        },
        {
          modelId: 'Qwen/Qwen2.5-32B-Instruct',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
        },
        {
          modelId: 'Qwen/Qwen2.5-72B-Instruct',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
        },
        {
          modelId: 'Qwen/Qwen2.5-VL-32B-Instruct',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'Qwen/Qwen2.5-VL-72B-Instruct',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'Qwen/QVQ-72B-Preview',
          capabilities: ['vision'],
          contextWindow: 128_000,
        },
        {
          modelId: 'Qwen/QwQ-32B',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
        },
        {
          modelId: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct',
          capabilities: ['vision'],
          contextWindow: 32_000,
        },
      ],
    },
  },
  {
    id: ModelProvider.Azure,
    name: 'Azure OpenAI',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      endpoint: 'https://<resource_name>.openai.azure.com',
      apiVersion: '2024-05-01-preview',
    },
  },
  {
    id: ModelProvider.XAI,
    name: 'xAI',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'https://api.x.ai',
      models: [
        {
          modelId: 'grok-3-beta',
          contextWindow: 128_000,
        },
        {
          modelId: 'grok-3-mini-beta',
          contextWindow: 128_000,
        },
        {
          modelId: 'grok-2-vision-1212',
          capabilities: ['vision'],
          contextWindow: 8192,
        },
        {
          modelId: 'grok-2-image-1212',
          contextWindow: 128_000,
        },
        {
          modelId: 'grok-2-1212',
          contextWindow: 128_000,
        },
        {
          modelId: 'grok-vision-beta',
          capabilities: ['vision'],
          contextWindow: 8192,
        },
        {
          modelId: 'grok-beta',
          contextWindow: 128_000,
        },
      ],
    },
  },
  {
    id: ModelProvider.Perplexity,
    name: 'Perplexity',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      models: [
        { modelId: 'sonar' },
        { modelId: 'sonar-pro' },
        { modelId: 'sonar-reasoning' },
        { modelId: 'sonar-reasoning-pro' },
        { modelId: 'sonar-deep-research' },
      ],
    },
  },
  {
    id: ModelProvider.Groq,
    name: 'Groq',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'https://api.groq.com/openai',
      models: [
        {
          modelId: 'llama-3.2-1b-preview',
        },
        {
          modelId: 'llama-3.2-3b-preview',
        },
        {
          modelId: 'llama-3.2-11b-text-preview',
        },
        {
          modelId: 'llama-3.2-90b-text-preview',
        },
      ],
    },
  },
  {
    id: ModelProvider.ChatGLM6B,
    name: 'ChatGLM6B',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
      models: [
        {
          modelId: 'glm-4-air',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
        },
        {
          modelId: 'glm-4-plus',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
        },
        {
          modelId: 'glm-4-flash',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
        },
        {
          modelId: 'glm-4v-plus-0111',
          capabilities: ['vision'],
          contextWindow: 16_000,
        },
        {
          modelId: 'glm-4v-flash',
          capabilities: ['vision'],
          contextWindow: 16_000,
        },
      ],
    },
  },
  {
    id: ModelProvider.BurnCloud,
    name: 'BurnCloud',
    type: ModelProviderType.OpenAI,
    urls: {
      website: 'https://burncloud.com',
    },
    defaultSettings: {
      apiHost: 'https://ai.burncloud.com/v1',
      models: [
        // Claude 系列
        {
          modelId: 'claude-sonnet-4-20250514',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 200_000,
        },
        {
          modelId: 'claude-3-7-sonnet-20250219',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 200_000,
        },
        {
          modelId: 'claude-3-5-sonnet-20241022',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 200_000,
        },
        // GPT 系列
        {
          modelId: 'gpt-4o',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4o-mini',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
        },
        {
          modelId: 'o1',
          capabilities: ['reasoning'],
          contextWindow: 128_000,
        },
        {
          modelId: 'gpt-4.5-preview',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
        },
        {
          modelId: 'o1-mini',
          capabilities: ['reasoning'],
          contextWindow: 128_000,
        },
        // 图像生成模型
        {
          modelId: 'gpt-image-1',
          capabilities: [],
          contextWindow: 4_000,
        },
        // Gemini 系列
        {
          modelId: 'gemini-2.5-pro-preview-05-06',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 1_000_000,
        },
        {
          modelId: 'gemini-2.0',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 1_000_000,
        },
        // DeepSeek 系列
        {
          modelId: 'deepseek-r1',
          capabilities: ['reasoning', 'tool_use'],
          contextWindow: 64_000,
        },
        {
          modelId: 'deepseek-v3',
          capabilities: ['tool_use'],
          contextWindow: 64_000,
        },
      ],
    },
  },
]
