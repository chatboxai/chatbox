import { v4 as uuidv4 } from 'uuid'
import {
  type Config,
  ModelProviderEnum,
  ModelProviderType,
  type ProviderBaseInfo,
  type SessionSettings,
  type Settings,
  Theme,
} from './types'

export function settings(): Settings {
  return {
    // aiProvider: ModelProviderEnum.OpenAI,
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
      knowledgeBase: {
        models: {
          embedding: undefined,
          rerank: undefined,
        },
      },
    },
    mcp: {
      servers: [],
      enabledBuiltinServers: [],
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
    provider: ModelProviderEnum.ChatboxAI,
    modelId: 'chatboxai-4',
    maxContextMessageCount: 6,
  }
}

export function pictureSessionSettings(): SessionSettings {
  return {
    provider: ModelProviderEnum.ChatboxAI,
    modelId: 'DALL-E-3',
    imageGenerateNum: 3,
    dalleStyle: 'vivid',
  }
}

export const SystemProviders: ProviderBaseInfo[] = [
  {
    id: ModelProviderEnum.ChatboxAI,
    name: 'Chatbox AI',
    type: ModelProviderType.ChatboxAI,
  },
  {
    id: ModelProviderEnum.OpenAI,
    name: 'OpenAI',
    type: ModelProviderType.OpenAI,
    urls: {
      website: 'https://openai.com',
    },
    defaultSettings: {
      apiHost: 'https://api.openai.com',
      // https://platform.openai.com/docs/models
      models: [
        {
          modelId: 'gpt-5-chat-latest',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 400_000,
          maxOutput: 128_000,
        },
        {
          modelId: 'gpt-5',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 400_000,
          maxOutput: 128_000,
        },
        {
          modelId: 'gpt-5-mini',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'gpt-5-nano',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'gpt-4o',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'gpt-4o-mini',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'o4-mini',
          capabilities: ['vision', 'tool_use', 'reasoning'],
          contextWindow: 200_000,
          maxOutput: 100_000,
        },
        {
          modelId: 'o3-mini',
          capabilities: ['vision', 'tool_use', 'reasoning'],
          contextWindow: 200_000,
          maxOutput: 200_000,
        },
        {
          modelId: 'o3',
          capabilities: ['vision', 'tool_use', 'reasoning'],
          contextWindow: 200_000,
          maxOutput: 100_000,
        },
        {
          modelId: 'text-embedding-3-small',
          type: 'embedding',
        },
      ],
    },
  },
  {
    id: ModelProviderEnum.Claude,
    name: 'Claude',
    type: ModelProviderType.Claude,
    urls: {
      website: 'https://www.anthropic.com',
    },
    defaultSettings: {
      apiHost: 'https://api.anthropic.com/v1',
      // https://docs.anthropic.com/en/docs/about-claude/models/overview
      models: [
        {
          modelId: 'claude-opus-4-0',
          contextWindow: 200_000,
          maxOutput: 32_000,
          capabilities: ['vision', 'reasoning', 'tool_use'],
        },
        {
          modelId: 'claude-sonnet-4-0',
          contextWindow: 200_000,
          maxOutput: 64_000,
          capabilities: ['vision', 'reasoning', 'tool_use'],
        },
        {
          modelId: 'claude-3-7-sonnet-latest',
          capabilities: ['vision', 'tool_use', 'reasoning'],
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
    id: ModelProviderEnum.Gemini,
    name: 'Gemini',
    type: ModelProviderType.Gemini,
    urls: {
      website: 'https://gemini.google.com/',
    },
    defaultSettings: {
      apiHost: 'https://generativelanguage.googleapis.com',
      // https://ai.google.dev/models/gemini
      models: [
        {
          modelId: 'gemini-2.5-flash',
          capabilities: ['vision', 'reasoning'],
        },
        {
          modelId: 'gemini-2.5-pro',
          capabilities: ['vision', 'reasoning'],
        },
        {
          modelId: 'gemini-2.0-flash-exp',
          capabilities: ['vision'],
        },
        {
          modelId: 'gemini-2.0-flash-thinking-exp',
          capabilities: ['vision', 'reasoning'],
        },
        {
          modelId: 'gemini-2.0-flash-thinking-exp-1219',
          capabilities: ['vision', 'reasoning'],
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
    id: ModelProviderEnum.Ollama,
    name: 'Ollama',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'http://127.0.0.1:11434',
    },
  },
  {
    id: ModelProviderEnum.LMStudio,
    name: 'LM Studio',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'http://127.0.0.1:1234',
    },
  },
  {
    id: ModelProviderEnum.DeepSeek,
    name: 'DeepSeek',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      models: [
        {
          modelId: 'deepseek-chat',
          contextWindow: 64_000,
          capabilities: ['tool_use'],
        },
        {
          modelId: 'deepseek-coder',
          contextWindow: 64_000,
        },
        {
          modelId: 'deepseek-reasoner',
          contextWindow: 64_000,
          capabilities: ['reasoning', 'tool_use'],
        },
      ],
    },
  },
  {
    id: ModelProviderEnum.SiliconFlow,
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
        { modelId: 'BAAI/bge-m3', type: 'embedding' },
        { modelId: 'BAAI/bge-large-zh-v1.5', type: 'embedding' },
        { modelId: 'Pro/BAAI/bge-m3', type: 'embedding' },
        { modelId: 'BAAI/bge-reranker-v2-m3', type: 'rerank' },
      ],
    },
  },
  {
    id: ModelProviderEnum.VolcEngine,
    name: 'VolcEngine',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'https://ark.cn-beijing.volces.com',
      apiPath: '/api/v3/chat/completions',
      models: [
        {
          modelId: 'deepseek-v3-250324',
          contextWindow: 64_000,
          capabilities: ['tool_use', 'reasoning'],
        },
        {
          modelId: 'deepseek-r1-250528',
          contextWindow: 16_384,
          capabilities: ['reasoning', 'tool_use'],
        },
        {
          modelId: 'doubao-1-5-thinking-pro-250415',
          contextWindow: 128_000,
          capabilities: ['reasoning'],
        },
        {
          modelId: 'doubao-1.5-vision-pro-250328',
          contextWindow: 128_000,
          capabilities: ['vision'],
        },
        { modelId: 'doubao-embedding-text-240715', type: 'embedding' },
      ],
    },
  },
  {
    id: ModelProviderEnum.Azure,
    name: 'Azure OpenAI',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      endpoint: 'https://<resource_name>.openai.azure.com',
      apiVersion: '2024-05-01-preview',
    },
  },
  {
    id: ModelProviderEnum.XAI,
    name: 'xAI',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'https://api.x.ai',
      models: [
        {
          modelId: 'grok-4-0709',
          contextWindow: 256_000,
          capabilities: ['vision', 'tool_use', 'reasoning'],
        },
        {
          modelId: 'grok-3',
          contextWindow: 131_072,
          capabilities: ['tool_use'],
        },
        {
          modelId: 'grok-3-mini',
          contextWindow: 131_072,
          capabilities: ['tool_use', 'reasoning'],
        },
        {
          modelId: 'grok-3-fast',
          contextWindow: 131_072,
          capabilities: ['tool_use'],
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
    id: ModelProviderEnum.MistralAI,
    name: 'Mistral AI',
    type: ModelProviderType.OpenAI,
    urls: {
      website: 'https://mistral.ai',
    },
    defaultSettings: {
      apiHost: 'https://api.mistral.ai/v1',
      models: [
        {
          modelId: 'pixtral-large-latest',
          contextWindow: 128_000,
          capabilities: ['vision', 'tool_use'],
        },
        {
          modelId: 'mistral-large-latest',
          contextWindow: 32_000,
          capabilities: ['tool_use'],
        },
        {
          modelId: 'mistral-medium-latest',
          contextWindow: 32_000,
          capabilities: ['tool_use'],
        },
        {
          modelId: 'mistral-small-latest',
          contextWindow: 32_000,
          capabilities: ['tool_use'],
        },
        {
          modelId: 'magistral-medium-latest',
          contextWindow: 32_000,
          capabilities: ['reasoning', 'tool_use'],
        },
        {
          modelId: 'magistral-small-latest',
          contextWindow: 32_000,
          capabilities: ['reasoning', 'tool_use'],
        },
        {
          modelId: 'codestral-22b-latest',
          contextWindow: 32_000,
          capabilities: [],
        },
        {
          modelId: 'mistral-embed',
          type: 'embedding',
        },
      ],
    },
  },
  {
    id: ModelProviderEnum.Perplexity,
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
    id: ModelProviderEnum.Groq,
    name: 'Groq',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'https://api.groq.com/openai',
      models: [
        {
          modelId: 'llama-3.3-70b-versatile',
          contextWindow: 131_072,
          maxOutput: 32_768,
          capabilities: ['tool_use'],
        },
        {
          modelId: 'moonshotai/kimi-k2-instruct',
          contextWindow: 131_072,
          maxOutput: 16_384,
          capabilities: ['tool_use'],
        },
        {
          modelId: 'qwen/qwen3-32b',
          contextWindow: 131_072,
          maxOutput: 40_960,
          capabilities: ['tool_use'],
        },
      ],
    },
  },
  {
    id: ModelProviderEnum.ChatGLM6B,
    name: 'ChatGLM6B',
    type: ModelProviderType.OpenAI,
    defaultSettings: {
      apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
      models: [
        {
          modelId: 'glm-4.5',
          capabilities: ['reasoning', 'tool_use'],
          contextWindow: 128_000,
        },
        {
          modelId: 'glm-4.5-air',
          capabilities: ['reasoning', 'tool_use'],
          contextWindow: 128_000,
        },
        {
          modelId: 'glm-4.5v',
          capabilities: ['reasoning', 'vision', 'tool_use'],
          contextWindow: 64_000,
        },
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
          capabilities: ['vision', 'tool_use'],
          contextWindow: 16_000,
        },
        {
          modelId: 'glm-4v-flash',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 16_000,
        },
      ],
    },
  },
  {
    id: ModelProviderEnum.OpenRouter,
    name: 'OpenRouter',
    type: ModelProviderType.OpenAI,
    urls: {
      website: 'https://openrouter.ai',
      apiKey: 'https://openrouter.ai/keys',
      docs: 'https://openrouter.ai/docs',
      models: 'https://openrouter.ai/models',
    },
    defaultSettings: {
      apiHost: 'https://openrouter.ai/api/v1',
      models: [
        // OpenAI Models
        {
          modelId: 'openai/gpt-4o',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'openai/gpt-4o-mini',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'openai/gpt-4-turbo',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'openai/gpt-3.5-turbo',
          capabilities: ['tool_use'],
          contextWindow: 16_385,
          maxOutput: 4_096,
        },
        // Anthropic Models
        {
          modelId: 'anthropic/claude-3.5-sonnet',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 200_000,
          maxOutput: 8_192,
        },
        {
          modelId: 'anthropic/claude-3.5-haiku',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 200_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'anthropic/claude-3-opus',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 200_000,
          maxOutput: 4_096,
        },
        // Google Models
        {
          modelId: 'google/gemini-pro-1.5',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 2_000_000,
          maxOutput: 8_192,
        },
        {
          modelId: 'google/gemini-flash-1.5',
          capabilities: ['vision', 'tool_use'],
          contextWindow: 1_000_000,
          maxOutput: 8_192,
        },
        // Meta Models
        {
          modelId: 'meta-llama/llama-3.1-405b-instruct',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'meta-llama/llama-3.1-70b-instruct',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'meta-llama/llama-3.1-8b-instruct',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        // Mistral Models
        {
          modelId: 'mistralai/mistral-large',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'mistralai/mistral-medium',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'mistralai/mistral-small',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
          maxOutput: 4_096,
        },
        // Cohere Models
        {
          modelId: 'cohere/command-r-plus',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'cohere/command-r',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        // DeepSeek Models
        {
          modelId: 'deepseek/deepseek-chat',
          capabilities: ['tool_use'],
          contextWindow: 64_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'deepseek/deepseek-coder',
          capabilities: ['tool_use'],
          contextWindow: 64_000,
          maxOutput: 4_096,
        },
        // xAI Models
        {
          modelId: 'x-ai/grok-beta',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'x-ai/grok-2-1212',
          capabilities: ['tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        // Perplexity Models
        {
          modelId: 'perplexity/llama-3.1-sonar-large-128k-online',
          capabilities: ['web_search', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'perplexity/llama-3.1-sonar-small-128k-online',
          capabilities: ['web_search', 'tool_use'],
          contextWindow: 128_000,
          maxOutput: 4_096,
        },
        // Groq Models
        {
          modelId: 'groq/llama-3.1-70b-versatile',
          capabilities: ['tool_use'],
          contextWindow: 131_072,
          maxOutput: 32_768,
        },
        {
          modelId: 'groq/llama-3.1-8b-instant',
          capabilities: ['tool_use'],
          contextWindow: 131_072,
          maxOutput: 32_768,
        },
        // Qwen Models
        {
          modelId: 'qwen/qwen-2.5-72b-instruct',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'qwen/qwen-2.5-32b-instruct',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'qwen/qwen-2.5-14b-instruct',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
          maxOutput: 4_096,
        },
        {
          modelId: 'qwen/qwen-2.5-7b-instruct',
          capabilities: ['tool_use'],
          contextWindow: 32_000,
          maxOutput: 4_096,
        },
        // Embedding Models
        {
          modelId: 'text-embedding-3-small',
          type: 'embedding',
        },
        {
          modelId: 'text-embedding-3-large',
          type: 'embedding',
        },
        {
          modelId: 'cohere/embed-english-v3.0',
          type: 'embedding',
        },
        {
          modelId: 'cohere/embed-multilingual-v3.0',
          type: 'embedding',
        },
      ],
    },
  },
]
