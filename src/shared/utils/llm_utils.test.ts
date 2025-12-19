import type { Message } from 'src/shared/types'
import { describe, expect, it } from 'vitest'
import { normalizeOpenAIApiHostAndPath, normalizeOpenAIResponsesHostAndPath } from './llm_utils'
import { fixMessageRoleSequence } from './message'

describe('normalizeOpenAIApiHostAndPath', () => {
  it('默认值', () => {
    const result = normalizeOpenAIApiHostAndPath({})
    expect(result).toEqual({ apiHost: 'https://api.openai.com/v1', apiPath: '/chat/completions' })
  })

  it('OpenAI API', () => {
    const result = normalizeOpenAIApiHostAndPath({
      apiHost: 'https://api.openai.com/v1',
      apiPath: '/chat/completions',
    })
    expect(result).toEqual({ apiHost: 'https://api.openai.com/v1', apiPath: '/chat/completions' })
  })
  it('OpenAI API 2', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.openai.com/v1' })
    expect(result).toEqual({ apiHost: 'https://api.openai.com/v1', apiPath: '/chat/completions' })
  })
  it('OpenAI API 3', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.openai.com' })
    expect(result).toEqual({ apiHost: 'https://api.openai.com/v1', apiPath: '/chat/completions' })
  })
  it('OpenAI API 4', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.openai.com/v1/chat/completions' })
    expect(result).toEqual({ apiHost: 'https://api.openai.com/v1', apiPath: '/chat/completions' })
  })
  it('OpenAI API 4', () => {
    const result = normalizeOpenAIApiHostAndPath({
      apiHost: 'https://api.openai.com/',
      apiPath: '/v1/chat/completions',
    })
    expect(result).toEqual({ apiHost: 'https://api.openai.com/v1', apiPath: '/chat/completions' })
  })

  it('OpenRouter API 1', () => {
    const result = normalizeOpenAIApiHostAndPath({
      apiHost: 'https://openrouter.ai/api/v1',
      apiPath: '/chat/completions',
    })
    expect(result).toEqual({ apiHost: 'https://openrouter.ai/api/v1', apiPath: '/chat/completions' })
  })
  it('OpenRouter API 2', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://openrouter.ai/api/v1' })
    expect(result).toEqual({ apiHost: 'https://openrouter.ai/api/v1', apiPath: '/chat/completions' })
  })
  it('OpenRouter API 3', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://openrouter.ai/api' })
    expect(result).toEqual({ apiHost: 'https://openrouter.ai/api/v1', apiPath: '/chat/completions' })
  })
  it('OpenRouter API 4', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://openrouter.ai/api/v1/chat/completions/' })
    expect(result).toEqual({ apiHost: 'https://openrouter.ai/api/v1', apiPath: '/chat/completions' })
  })

  it('xAPI 1', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.x.com/v1', apiPath: '/chat/completions' })
    expect(result).toEqual({ apiHost: 'https://api.x.com/v1', apiPath: '/chat/completions' })
  })
  it('xAPI 2', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.x.com/v1' })
    expect(result).toEqual({ apiHost: 'https://api.x.com/v1', apiPath: '/chat/completions' })
  })
  it('xAPI 3', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.x.com' })
    expect(result).toEqual({ apiHost: 'https://api.x.com/v1', apiPath: '/chat/completions' })
  })
  it('xAPI 4', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.x.com/v1/chat/completions/' })
    expect(result).toEqual({ apiHost: 'https://api.x.com/v1', apiPath: '/chat/completions' })
  })
  it('xAPI 5', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.x.com', apiPath: '/chat/completions' })
    expect(result).toEqual({ apiHost: 'https://api.x.com/v1', apiPath: '/chat/completions' })
  })

  it('自定义代理地址', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com' })
    expect(result).toEqual({ apiHost: 'https://my-proxy.com/v1', apiPath: '/chat/completions' })
  })
  it('自定义代理地址带完整路径', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com/v1/chat/completions' })
    expect(result).toEqual({ apiHost: 'https://my-proxy.com/v1', apiPath: '/chat/completions' })
  })
  it('自定义 API 路径', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com', apiPath: '/custom/path' })
    expect(result).toEqual({ apiHost: 'https://my-proxy.com', apiPath: '/custom/path' })
  })

  it('斜杠 1', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com/', apiPath: '/chat/completions' })
    expect(result).toEqual({ apiHost: 'https://my-proxy.com', apiPath: '/chat/completions' })
  })
  it('斜杠 2', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com', apiPath: 'custom/path' })
    expect(result).toEqual({ apiHost: 'https://my-proxy.com', apiPath: '/custom/path' })
  })

  it('http 协议', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'http://my-proxy.com', apiPath: '/chat/completions' })
    expect(result).toEqual({ apiHost: 'http://my-proxy.com', apiPath: '/chat/completions' })
  })
  it('http 协议 2', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com', apiPath: '/chat/completions' })
    expect(result).toEqual({ apiHost: 'https://my-proxy.com', apiPath: '/chat/completions' })
  })
  it('http 协议 3', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'my-proxy.com', apiPath: '/chat/completions' })
    expect(result).toEqual({ apiHost: 'https://my-proxy.com', apiPath: '/chat/completions' })
  })
})

describe('normalizeOpenAIResponsesHostAndPath', () => {
  it('appends /v1 when only host is provided', () => {
    const result = normalizeOpenAIResponsesHostAndPath({ apiHost: 'https://api.openai.com' })
    expect(result).toEqual({ apiHost: 'https://api.openai.com/v1', apiPath: '/responses' })
  })

  it('appends /v1 even when caller passes default /responses path', () => {
    const result = normalizeOpenAIResponsesHostAndPath({
      apiHost: 'https://custom-proxy.com',
      apiPath: '/responses',
    })
    expect(result).toEqual({ apiHost: 'https://custom-proxy.com/v1', apiPath: '/responses' })
  })

  it('respects custom api path overrides', () => {
    const result = normalizeOpenAIResponsesHostAndPath({
      apiHost: 'https://custom-proxy.com',
      apiPath: '/custom/path',
    })
    expect(result).toEqual({ apiHost: 'https://custom-proxy.com', apiPath: '/custom/path' })
  })
})

describe('fixMessageRoleSequence', () => {
  it('应该处理空数组', () => {
    const messages: Message[] = []
    expect(fixMessageRoleSequence(messages)).toEqual([])
  })

  it('应该处理单条消息', () => {
    const messages: Message[] = [{ id: '', role: 'user', contentParts: [{ type: 'text', text: '你好' }] }]
    expect(fixMessageRoleSequence(messages)).toEqual([
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '你好' }] },
    ])
  })

  it('应该合并连续的相同角色消息', () => {
    const messages: Message[] = [
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '你好' }] },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '请问一下' }] },
    ]
    expect(fixMessageRoleSequence(messages)).toEqual([
      {
        id: '',
        role: 'user',
        contentParts: [
          { type: 'text', text: '你好' },
          { type: 'text', text: '请问一下' },
        ],
      },
    ])
  })

  it('应该正确处理交替的角色消息', () => {
    const messages: Message[] = [
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '你好' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: '你好！有什么可以帮你的？' }] },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '请问一下' }] },
    ]
    expect(fixMessageRoleSequence(messages)).toEqual([
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '你好' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: '你好！有什么可以帮你的？' }] },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '请问一下' }] },
    ])
  })

  it('应该处理多个连续相同角色的消息', () => {
    const messages: Message[] = [
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '你好' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: '你好！' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: '有什么可以帮你的？' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: '请随时告诉我' }] },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '谢谢' }] },
    ]
    expect(fixMessageRoleSequence(messages)).toEqual([
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '你好' }] },
      {
        id: '',
        role: 'assistant',
        contentParts: [
          { type: 'text', text: '你好！' },
          { type: 'text', text: '有什么可以帮你的？' },
          { type: 'text', text: '请随时告诉我' },
        ],
      },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: '谢谢' }] },
    ])
  })

  it('应该在第一条 assistant 消息前添加 user 消息', () => {
    const messages: Message[] = [
      { id: '', role: 'system', contentParts: [{ type: 'text', text: 'System prompt' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'Hello' }] },
    ]
    const expected: Message[] = [
      { id: '', role: 'system', contentParts: [{ type: 'text', text: 'System prompt' }] },
      { id: 'user_before_assistant_id', role: 'user', contentParts: [{ type: 'text', text: 'OK.' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'Hello' }] },
    ]
    expect(fixMessageRoleSequence(messages)).toEqual(expected)
  })
  it('应该在第一条 assistant 消息前添加 user 消息', () => {
    const messages: Message[] = [{ id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'Hello' }] }]
    const expected: Message[] = [
      { id: 'user_before_assistant_id', role: 'user', contentParts: [{ type: 'text', text: 'OK.' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'Hello' }] },
    ]
    expect(fixMessageRoleSequence(messages)).toEqual(expected)
  })

  it('不应该在已有 user 消息后的 assistant 消息前添加新的 user 消息', () => {
    const messages: Message[] = [
      { id: '', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'Hi' }] },
    ]
    expect(fixMessageRoleSequence(messages)).toEqual(messages)
  })

  it('应该正确处理多组对话', () => {
    const messages: Message[] = [
      { id: '', role: 'system', contentParts: [{ type: 'text', text: 'System prompt' }] },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'Hi' }] },
      { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'How are you?' }] },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: 'Good' }] },
    ]
    const expected: Message[] = [
      { id: '', role: 'system', contentParts: [{ type: 'text', text: 'System prompt' }] },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] },
      {
        id: '',
        role: 'assistant',
        contentParts: [
          { type: 'text', text: 'Hi' },
          { type: 'text', text: 'How are you?' },
        ],
      },
      { id: '', role: 'user', contentParts: [{ type: 'text', text: 'Good' }] },
    ]
    expect(fixMessageRoleSequence(messages)).toEqual(expected)
  })
})
