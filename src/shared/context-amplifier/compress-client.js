/**
 * 压缩客户端 — 支持多提供商（Ling / GLM / DeepSeek / SenseNova）
 *
 * 统一接口：
 *   const { callCompress } = require('./compress-client');
 *   const result = await callCompress(systemPrompt, text, rawBytes, opts);
 *   // → { ok, summary, outBytes, ms, provider }
 *
 * 提供商通过环境变量选择：
 *   COMPRESS_PROVIDER=glm       (api.sfkey.cn 的 glm-5.1)
 *   COMPRESS_PROVIDER=ling      (api.ant-ling.com 的 Ling-3.0-flash)
 *   COMPRESS_PROVIDER=sensenova (token.sensenova.cn 的 deepseek-v4-flash)
 */
const https = require('https')
const { getProviderProfile } = require('./provider-profile.js')

// ===== 提供商配置 =====
const sharedLing = getProviderProfile('ling')
const sharedGlm = getProviderProfile('glm')
const PROVIDERS = {
  glm: {
    host: new URL(sharedGlm.endpoint).hostname,
    path: new URL(sharedGlm.endpoint).pathname,
    format: sharedGlm.format,
    model: () => process.env.COMPRESS_MODEL || sharedGlm.defaultModel,
    apiKey: () => process.env.COMPRESS_KEY || process.env.UP_KEY || '',
    headers: (key, length) => sharedGlm.headers(key, length),
    buildPayload: (model, systemPrompt, text, maxTokens) =>
      JSON.stringify(sharedGlm.buildPayload(model, systemPrompt, text, maxTokens)),
    // 解析响应提取文本（GLM 推理模型 content 可能为空，需读取 reasoning_content）
    parseText: (j) => {
      if (j.choices && j.choices[0]) {
        const msg = j.choices[0].message || {}
        const content = msg.content || ''
        const reasoning = msg.reasoning_content || ''
        // GLM 推理模型：content 为空时用 reasoning_content；否则用 content
        return content || reasoning
      }
      return ''
    },
  },
  ling: {
    host: new URL(sharedLing.endpoint).hostname,
    path: new URL(sharedLing.endpoint).pathname,
    format: sharedLing.format,
    model: () => process.env.COMPRESS_MODEL || sharedLing.defaultModel,
    apiKey: () => process.env.COMPRESS_KEY || process.env.LING_KEY || '',
    headers: (key, length) => sharedLing.headers(key, length),
    buildPayload: (model, systemPrompt, text, maxTokens) =>
      JSON.stringify(sharedLing.buildPayload(model, systemPrompt, text, maxTokens)),
    parseText: (j) => {
      return j.content ? j.content.map((b) => b.text || '').join('') : ''
    },
  },
  deepseek: {
    host: 'api.deepseek.com',
    path: '/chat/completions',
    format: 'openai',
    model: () => process.env.COMPRESS_MODEL || 'deepseek-chat',
    apiKey: () => process.env.COMPRESS_KEY || process.env.DEEPSEEK_KEY || '',
    headers: (key, length) => ({
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Content-Length': length,
    }),
    buildPayload: (model, systemPrompt, text, maxTokens) =>
      JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        max_tokens: maxTokens,
        stream: false,
        temperature: 0.2,
      }),
    parseText: (j) => {
      if (j.choices && j.choices[0]) {
        return j.choices[0].message?.content || ''
      }
      return ''
    },
  },
  deepseekAnthropic: {
    host: 'api.deepseek.com',
    path: '/anthropic/v1/messages',
    format: 'anthropic',
    model: () => process.env.COMPRESS_MODEL || 'deepseek-v4-flash',
    apiKey: () => process.env.COMPRESS_KEY || process.env.DEEPSEEK_KEY || '',
    headers: (key, length) => ({
      'x-api-key': key,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
      'Content-Length': length,
    }),
    buildPayload: (model, systemPrompt, text, maxTokens) =>
      JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: false,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    parseText: (j) => {
      if (!j.content) return ''
      return j.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text || '')
        .join('')
    },
  },
  sensenova: {
    host: 'token.sensenova.cn',
    path: '/v1/messages',
    format: 'anthropic',
    model: () => process.env.COMPRESS_MODEL || 'deepseek-v4-flash',
    apiKey: () => process.env.COMPRESS_KEY || '',
    headers: (key, length) => ({
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Content-Length': length,
    }),
    buildPayload: (model, systemPrompt, text, maxTokens) =>
      JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    parseText: (j) => {
      if (!j.content) return ''
      // 只取 text 类型块，thinking 是思考过程不是结果
      const texts = j.content.filter((b) => b.type === 'text').map((b) => b.text || '')
      return texts.join('')
    },
  },
  rhythm: {
    host: 'tokenrhythm.studio',
    path: '/v1/messages',
    format: 'anthropic',
    model: () => process.env.COMPRESS_MODEL || 'deepseek-v4-flash-0731',
    apiKey: () => process.env.COMPRESS_KEY || '',
    headers: (key, length) => ({
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'Content-Length': length,
    }),
    buildPayload: (model, systemPrompt, text, maxTokens) =>
      JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    parseText: (j) => {
      if (!j.content) return ''
      // 只取 text 类型的块。thinking 是模型的思考过程，不是输出结果，
      // 绝不能当合并结果（否则思考过程会被当成信息，导致体积膨胀）。
      const texts = j.content.filter((b) => b.type === 'text').map((b) => b.text || '')
      return texts.join('')
    },
  },
}

// ===== 调用压缩 API =====
function callCompress(systemPrompt, text, opts = {}) {
  return new Promise((resolve) => {
    const providerName = opts.provider || process.env.COMPRESS_PROVIDER || 'ling'
    const provider = PROVIDERS[providerName]
    if (!provider) {
      resolve({ ok: false, reason: `未知提供商: ${providerName}` })
      return
    }

    const t0 = Date.now()
    const model = provider.model()
    const apiKey = provider.apiKey()
    const maxTokens = opts.maxTokens || 8192

    if (!apiKey) {
      resolve({ ok: false, reason: `${providerName} API key 未设置` })
      return
    }

    const payload = provider.buildPayload(model, systemPrompt, text, maxTokens)
    const u = new URL(`https://${provider.host}${provider.path}`)

    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: provider.headers(apiKey, Buffer.byteLength(payload)),
        timeout: 120000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks).toString('utf8')
          const ms = (Date.now() - t0) / 1000
          try {
            const j = JSON.parse(buf)
            if (j.error) {
              resolve({ ok: false, reason: j.error.message || JSON.stringify(j.error), ms })
              return
            }
            const out = provider.parseText(j)
            const outBytes = Buffer.byteLength(out)
            // 空响应也保留原始 buf 供诊断（限流、输入超限等情况 content 为空但 status 200）
            resolve({
              ok: out.length > 0,
              summary: out,
              outBytes,
              ms,
              provider: providerName,
              model,
              rawBuf: buf.slice(0, 300),
            })
          } catch (e) {
            resolve({ ok: false, reason: 'JSON parse error: ' + e.message + ' | ' + buf.slice(0, 200), ms })
          }
        })
      }
    )
    req.on('error', (e) => resolve({ ok: false, reason: e.message }))
    req.write(Buffer.from(payload))
    req.end()
  })
}

module.exports = { callCompress, PROVIDERS }
