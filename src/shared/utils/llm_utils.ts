import { ModelProviderEnum } from '../types'

export function normalizeOpenAIApiHostAndPath(
  options: { apiHost?: string; apiPath?: string },
  defaults?: { apiHost?: string; apiPath?: string }
) {
  let { apiHost, apiPath } = options
  if (apiHost) {
    apiHost = apiHost.trim()
  }
  if (apiPath) {
    apiPath = apiPath.trim()
  }
  const DEFAULT_HOST = defaults?.apiHost ?? 'https://api.openai.com/v1'
  const DEFAULT_PATH = defaults?.apiPath ?? '/chat/completions'
  // 如果 apiHost 为空，直接返回默认的 apiHost 和 apiPath
  if (!apiHost) {
    apiHost = DEFAULT_HOST
    apiPath = DEFAULT_PATH
    return { apiHost, apiPath }
  }
  // 处理前后 '/' 的干扰
  if (apiHost.endsWith('/')) {
    apiHost = apiHost.slice(0, -1)
  }
  if (apiPath && !apiPath.startsWith('/')) {
    apiPath = '/' + apiPath
  }
  // URL schemes are case-insensitive. Mobile keyboards may capitalize the first
  // character, so normalize an explicit HTTP(S) scheme before applying defaults.
  const scheme = apiHost.match(/^https?:\/\//i)?.[0]
  if (scheme) {
    apiHost = `${scheme.toLowerCase()}${apiHost.slice(scheme.length)}`
  } else {
    apiHost = `https://${apiHost}`
  }
  // 如果用户在 host 配置了完整的 host+path 接口地址
  // 可以兼容的输入情况有：
  //   apiHost=https://my.proxy.com/v1/chat/completions
  if (apiHost.endsWith(DEFAULT_PATH)) {
    apiHost = apiHost.replace(DEFAULT_PATH, '')
    apiPath = DEFAULT_PATH
  }
  // 如果当前配置的是 OpenAI 的 API，统一为默认的 apiHost 和 apiPath
  if (apiHost.endsWith('://api.openai.com') || apiHost.endsWith('://api.openai.com/v1')) {
    apiHost = DEFAULT_HOST
    apiPath = DEFAULT_PATH
    return { apiHost, apiPath }
  }
  // 如果当前配置的是 OpenRouter 的 API，统一 apiHost 和 apiPath
  if (apiHost.endsWith('://openrouter.ai') || apiHost.endsWith('://openrouter.ai/api')) {
    apiHost = 'https://openrouter.ai/api/v1'
    apiPath = DEFAULT_PATH
    return { apiHost, apiPath }
  }
  // 如果当前配置的是 x 的 API，统一 apiHost 和 apiPath
  if (apiHost.endsWith('://api.x.com') || apiHost.endsWith('://api.x.com/v1')) {
    apiHost = 'https://api.x.com/v1'
    apiPath = DEFAULT_PATH
    return { apiHost, apiPath }
  }
  // 如果只配置 apiHost，且 apiHost 不以 /v1 结尾
  if (!apiHost.endsWith('/v1') && !apiPath) {
    apiHost = apiHost + '/v1'
    apiPath = DEFAULT_PATH
  }
  if (!apiPath) {
    apiPath = DEFAULT_PATH
  }
  return { apiHost, apiPath }
}

export function normalizeOpenAIResponsesHostAndPath(options: { apiHost?: string; apiPath?: string }) {
  const trimmedApiPath = options.apiPath?.trim()
  const hasCustomApiPath = !!trimmedApiPath && trimmedApiPath !== '/responses'
  const normalized = normalizeOpenAIApiHostAndPath(
    hasCustomApiPath ? { ...options, apiPath: trimmedApiPath } : { ...options, apiPath: undefined },
    { apiPath: '/responses' }
  )

  if (!hasCustomApiPath) {
    normalized.apiPath = '/responses'
  }

  return normalized
}

export function normalizeClaudeHost(apiHost: string) {
  apiHost = apiHost.trim()
  if (apiHost === 'https://api.anthropic.com') {
    apiHost = `${apiHost}/v1`
  }
  if (apiHost.endsWith('/')) {
    apiHost = apiHost.slice(0, apiHost.length - 1)
  }
  return {
    apiHost,
    apiPath: '/messages',
  }
}

export function normalizeGeminiHost(apiHost: string) {
  apiHost = apiHost.trim()
  if (apiHost.endsWith('/')) {
    apiHost = apiHost.slice(0, apiHost.length - 1)
  }
  apiHost = `${apiHost}/v1beta`
  return {
    apiHost,
    apiPath: '/models/[model]',
  }
}

export function normalizeAzureEndpoint(endpoint: string) {
  const value = endpoint.trim()
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  const looksLikeHost = value === 'localhost' || value.includes('.') || value.includes(':') || value.startsWith('[')
  const endpointUrl = hasScheme ? value : looksLikeHost ? `https://${value}` : `https://${value}.openai.azure.com`
  let origin = endpointUrl
  try {
    origin = new URL(endpointUrl).origin
  } catch {
    // Keep placeholders and partially entered settings renderable. The actual
    // request path will still surface an invalid URL when the user tests it.
  }

  return {
    endpoint: `${origin}/openai`,
    apiPath: '/chat/completions',
  }
}

export function isOpenAICompatible(providerId: string, _modelId: string) {
  if (providerId === 'chatbox-ai') {
    return false
  }
  return (
    [
      ModelProviderEnum.OpenAI,
      ModelProviderEnum.SiliconFlow,
      ModelProviderEnum.OpenRouter,
      ModelProviderEnum.Ollama,
      ModelProviderEnum.ChatGLM6B,
      ModelProviderEnum.XAI,
      ModelProviderEnum.Groq,
      ModelProviderEnum.DeepSeek,
      ModelProviderEnum.LMStudio,
      ModelProviderEnum.Qwen,
      ModelProviderEnum.QwenPortal,
      ModelProviderEnum.MiniMax,
      ModelProviderEnum.MiniMaxCN,
      ModelProviderEnum.Moonshot,
      ModelProviderEnum.MoonshotCN,
    ].includes(providerId as ModelProviderEnum) || providerId.startsWith('custom-provider-')
  )
}
