import { describe, expect, it, vi } from 'vitest'
import { createOllamaReasoningFetch } from './ollama-reasoning-fetch'

function createRecordingFetch() {
  const fetchFunction = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('{}')))
  return { fetchFunction, wrapped: createOllamaReasoningFetch(fetchFunction) }
}

function sentBody(fetchFunction: ReturnType<typeof createRecordingFetch>['fetchFunction']) {
  return JSON.parse(String(fetchFunction.mock.calls[0]?.[1]?.body))
}

describe('createOllamaReasoningFetch', () => {
  it('moves assistant reasoning_content to the reasoning field', async () => {
    const { fetchFunction, wrapped } = createRecordingFetch()
    await wrapped('http://127.0.0.1:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.5:9b',
        messages: [
          { role: 'user', content: 'Read the attachment' },
          { role: 'assistant', content: null, reasoning_content: 'I need to read the file', tool_calls: [] },
        ],
      }),
    })

    expect(fetchFunction.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect(fetchFunction.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    expect(sentBody(fetchFunction)).toEqual({
      model: 'qwen3.5:9b',
      messages: [
        { role: 'user', content: 'Read the attachment' },
        { role: 'assistant', content: null, reasoning: 'I need to read the file', tool_calls: [] },
      ],
    })
  })

  it('keeps an existing reasoning field and drops reasoning_content', async () => {
    const { fetchFunction, wrapped } = createRecordingFetch()
    await wrapped('http://ollama/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ role: 'assistant', content: 'Done', reasoning: 'Original', reasoning_content: 'Duplicate' }],
      }),
    })

    expect(sentBody(fetchFunction).messages).toEqual([{ role: 'assistant', content: 'Done', reasoning: 'Original' }])
  })

  it('leaves non-assistant messages unchanged', async () => {
    const { fetchFunction, wrapped } = createRecordingFetch()
    const init = {
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Hi', reasoning_content: 'user field' },
          { role: 'tool', tool_call_id: 'call-1', content: 'ok', reasoning_content: 'tool field' },
        ],
      }),
    }
    await wrapped('http://ollama/v1/chat/completions', init)

    expect(fetchFunction).toHaveBeenCalledWith('http://ollama/v1/chat/completions', init)
  })

  it('passes the request through when no assistant message has string reasoning_content', async () => {
    const { fetchFunction, wrapped } = createRecordingFetch()
    const init = {
      body: JSON.stringify({
        messages: [
          { role: 'assistant', content: 'No reasoning' },
          { role: 'assistant', content: 'Structured', reasoning_content: { text: 'not a string' } },
          null,
          'plain string',
        ],
      }),
    }
    await wrapped('http://ollama/v1/chat/completions', init)

    expect(fetchFunction).toHaveBeenCalledWith('http://ollama/v1/chat/completions', init)
  })

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a JSON body without messages', JSON.stringify({ model: 'qwen3.5:9b' })],
    ['a JSON null body', 'null'],
    ['a messages field that is not an array', JSON.stringify({ messages: { role: 'assistant' } })],
  ])('passes %s through unchanged', async (_name, body) => {
    const { fetchFunction, wrapped } = createRecordingFetch()
    const init = { method: 'POST', body }
    await wrapped('http://ollama/v1/chat/completions', init)

    expect(fetchFunction).toHaveBeenCalledWith('http://ollama/v1/chat/completions', init)
  })

  it('passes non-string bodies and missing init through unchanged', async () => {
    const { fetchFunction, wrapped } = createRecordingFetch()
    const binaryInit = { method: 'POST', body: new Uint8Array([123, 125]) }
    await wrapped('http://ollama/api/upload', binaryInit)
    await wrapped('http://ollama/api/tags')

    expect(fetchFunction).toHaveBeenNthCalledWith(1, 'http://ollama/api/upload', binaryInit)
    expect(fetchFunction).toHaveBeenNthCalledWith(2, 'http://ollama/api/tags', undefined)
  })
})
