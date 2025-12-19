// Provider enums and types that are shared across the application
// This file helps prevent circular dependencies

export enum ModelProviderEnum {
  ChatboxAI = 'chatbox-ai',
  OpenAI = 'openai',
  OpenAIResponses = 'openai-responses',
  Azure = 'azure',
  ChatGLM6B = 'chatglm-6b',
  Claude = 'claude',
  Gemini = 'gemini',
  Ollama = 'ollama',
  Groq = 'groq',
  DeepSeek = 'deepseek',
  SiliconFlow = 'siliconflow',
  VolcEngine = 'volcengine',
  MistralAI = 'mistral-ai',
  LMStudio = 'lm-studio',
  Perplexity = 'perplexity',
  XAI = 'xAI',
  OpenRouter = 'openrouter',
  Custom = 'custom',
}

export enum ModelProviderType {
  ChatboxAI = 'chatbox-ai',
  OpenAI = 'openai',
  Gemini = 'gemini',
  Claude = 'claude',
  OpenAIResponses = 'openai-responses',
}
