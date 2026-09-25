import { describe, expect, it, vi } from 'vitest'
import { transcribeOpenAICompatibleAudio } from './openai-compatible'

describe('transcribeOpenAICompatibleAudio', () => {
  it('posts an OpenAI-compatible multipart request without forcing a JSON content type', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: 'recognized text' }), { status: 200 }))
    const audio = new File(['audio'], 'meeting.webm', { type: 'audio/webm' })

    await expect(
      transcribeOpenAICompatibleAudio(
        {
          baseUrl: 'http://127.0.0.1:8000/v1/',
          model: 'FunAudioLLM/SenseVoiceSmall',
          apiKey: ' local-token ',
        },
        audio,
        request
      )
    ).resolves.toBe('recognized text')

    const [url, init] = request.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer local-token' })
    expect(init.headers).not.toHaveProperty('Content-Type')
    expect(init.body.get('model')).toBe('FunAudioLLM/SenseVoiceSmall')
    expect(init.body.get('file')).toBeInstanceOf(File)
  })
})
