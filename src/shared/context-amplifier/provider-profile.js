const PROVIDER_PROFILES = {
  ling: {
    endpoint: 'https://api.ant-ling.com/anthropic/v1/messages',
    format: 'anthropic',
    defaultModel: 'Ling-3.0-flash',
    headers: (key, length) => ({
      'x-api-key': key,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
      'Content-Length': length,
    }),
    buildPayload: (model, systemPrompt, text, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      stream: false,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    }),
    parseText: (data) =>
      Array.isArray(data?.content)
        ? data.content
            .filter((block) => block?.type === 'text')
            .map((block) => block.text || '')
            .join('')
        : '',
  },
  glm: {
    endpoint: 'https://api.sfkey.cn/v1/chat/completions',
    format: 'openai',
    defaultModel: 'glm-5.1',
    headers: (key, length) => ({
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Content-Length': length,
    }),
    buildPayload: (model, systemPrompt, text, maxTokens) => ({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      max_tokens: maxTokens,
      stream: false,
      temperature: 0.2,
    }),
    parseText: (data) => data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning_content || '',
  },
}

function getProviderProfile(name = 'ling') {
  return PROVIDER_PROFILES[name] || null
}

module.exports = { PROVIDER_PROFILES, getProviderProfile }
