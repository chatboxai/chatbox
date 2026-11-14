import type { ChatboxAILicenseDetail, Settings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { describe, expect, it, vi } from 'vitest'
import { getModel } from '../providers'
import '../providers/builtin-registration'
import ChatboxAI from '../providers/definitions/models/chatboxai'
import FishAudio from '../providers/definitions/models/fish-audio'
import { ApiError } from './errors'
import { encodeMultipart, isWavOnlyTranscriptionModel, transcribeWithProvider } from './transcription'

const AUDIO = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])

function bodyText(init: RequestInit | undefined) {
  return new TextDecoder('latin1').decode(init?.body as Uint8Array)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function createDependencies(overrides: Partial<ModelDependencies['request']> = {}): ModelDependencies {
  return {
    request: { apiRequest: vi.fn(), fetchWithOptions: vi.fn(), ...overrides },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: { captureException: vi.fn(), withScope: vi.fn() },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }
}

describe('transcribeWithProvider', () => {
  it('posts an OpenAI-compatible multipart request', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ text: ' 你好 ' }))

    const text = await transcribeWithProvider(
      { baseURL: 'https://api.example.com/v1/', apiKey: 'key', headers: { 'X-Extra': '1' }, fetch },
      'whisper-large-v3-turbo',
      AUDIO,
      { mediaType: 'audio/wav', language: 'zh' }
    )

    expect(text).toBe('你好')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/audio/transcriptions')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer key')
    expect(headers['X-Extra']).toBe('1')
    const boundary = headers['Content-Type'].match(/^multipart\/form-data; boundary=(.+)$/)?.[1]
    expect(boundary).toBeTruthy()
    const body = bodyText(init)
    expect(body).toContain('name="model"\r\n\r\nwhisper-large-v3-turbo\r\n')
    expect(body).toContain('name="language"\r\n\r\nzh\r\n')
    expect(body).toContain('name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF')
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true)
    expect(body).not.toContain('response_format')
  })

  it('omits the language field when the service should detect it', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ text: 'hello' }))
    await transcribeWithProvider({ baseURL: 'https://x/v1', apiKey: 'k', fetch }, 'm', AUDIO, {
      mediaType: 'audio/mp4',
    })
    const body = bodyText(fetch.mock.calls[0][1])
    expect(body).not.toContain('name="language"')
    expect(body).toContain('filename="audio.m4a"\r\nContent-Type: audio/mp4')
  })

  it('keeps the service error message and status', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"Upgrade required"}}', { status: 403 }))
    const error = await transcribeWithProvider({ baseURL: 'https://x/v1', apiKey: 'k', fetch }, 'm', AUDIO, {
      mediaType: 'audio/wav',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).statusCode).toBe(403)
    expect((error as ApiError).responseBody).toContain('Upgrade required')
  })

  it('passes the abort signal to the request', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    const pending = transcribeWithProvider({ baseURL: 'https://x/v1', apiKey: 'k', fetch }, 'm', AUDIO, {
      mediaType: 'audio/wav',
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('provider transcription endpoints', () => {
  it('sends Chatbox AI requests to the gateway with the license and instance id', async () => {
    const fetchWithOptions = vi.fn(async () => jsonResponse({ text: 'ok' }))
    const model = new ChatboxAI(
      {
        licenseKey: 'test-license',
        licenseInstances: { 'test-license': 'test-instance' },
        licenseDetail: {} as ChatboxAILicenseDetail,
        model: { modelId: 'chatbox-asr-1' },
        language: 'en',
        dalleStyle: 'vivid',
      },
      { uuid: 'test-uuid' },
      createDependencies({ fetchWithOptions })
    )

    await expect(model.transcribe(AUDIO, { mediaType: 'audio/wav' })).resolves.toBe('ok')

    const [url, init, options] = fetchWithOptions.mock.calls[0] as unknown as [string, RequestInit, unknown]
    expect(url).toMatch(/\/gateway\/openai\/v1\/audio\/transcriptions$/)
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-license')
    expect(headers['Instance-Id']).toBe('test-instance')
    expect(options).toEqual({ parseChatboxRemoteError: true })
  })

  it('sends Fish Audio requests to its OpenAI-compatible endpoint', async () => {
    const apiRequest = vi.fn(async () => jsonResponse({ text: 'fish' }))
    const model = new FishAudio(
      { apiKey: 'fish-key', model: { modelId: 'fish-audio/transcribe-1', type: 'transcription' } },
      createDependencies({ apiRequest })
    )

    await expect(model.transcribe(AUDIO, { mediaType: 'audio/wav', language: 'en' })).resolves.toBe('fish')

    const [request] = apiRequest.mock.calls[0] as unknown as [{ url: string; headers: Record<string, string> }]
    expect(request.url).toBe('https://api.fish.audio/compat/v1/audio/transcriptions')
    expect(request.headers.Authorization).toBe('Bearer fish-key')
  })
})

describe('MiniMax speech to text', () => {
  type ApiRequest = { url: string; headers: Record<string, string>; body: Uint8Array }

  function miniMaxModel(provider: 'minimax' | 'minimax-cn', response: Response) {
    const apiRequest = vi.fn(async (_request: ApiRequest) => response)
    const settings = { providers: { [provider]: { apiKey: 'mm-key' } } } as unknown as Settings
    const model = getModel(
      { provider, modelId: 'asr-1.0' },
      settings,
      { uuid: 'test' },
      createDependencies({ apiRequest: apiRequest as unknown as ModelDependencies['request']['apiRequest'] })
    )
    return { model, apiRequest }
  }

  it.each([
    ['minimax', 'https://api.minimax.io/v1/speech_to_text'],
    ['minimax-cn', 'https://api.minimaxi.com/v1/speech_to_text'],
  ] as const)('posts %s recordings to its regional endpoint', async (provider, url) => {
    const { model, apiRequest } = miniMaxModel(provider, jsonResponse({ text: ' 你好 ', duration: 1.2, trace_id: 't' }))

    await expect(model.transcribe?.(AUDIO, { mediaType: 'audio/wav', language: 'zh' })).resolves.toBe('你好')

    const [request] = apiRequest.mock.calls[0]
    expect(request.url).toBe(url)
    expect(request.headers.Authorization).toBe('Bearer mm-key')
    expect(request.headers.language).toBe('zh')
    const body = new TextDecoder('latin1').decode(request.body)
    expect(body).toContain('name="model"\r\n\r\nasr-1.0\r\n')
    expect(body).toContain('name="response_format"\r\n\r\njson\r\n')
    expect(body).toContain('name="file"; filename="audio.wav"')
    expect(body).not.toContain('name="language"')
  })

  it('omits the language header for automatic detection', async () => {
    const { model, apiRequest } = miniMaxModel('minimax', jsonResponse({ text: 'hello' }))
    await model.transcribe?.(AUDIO, { mediaType: 'audio/mp4' })
    expect(apiRequest.mock.calls[0][0].headers).not.toHaveProperty('language')
  })

  it('keeps the MiniMax error body and status', async () => {
    const { model } = miniMaxModel(
      'minimax',
      jsonResponse(
        { type: 'error', error: { type: 'authentication_error', message: 'invalid api key', http_code: '401' } },
        401
      )
    )
    const error = await model.transcribe?.(AUDIO, { mediaType: 'audio/wav' }).catch((e: unknown) => e)
    expect(error).toMatchObject({ statusCode: 401 })
    expect((error as ApiError).responseBody).toContain('invalid api key')
  })
})

describe('DeepSeek speech to text', () => {
  type ApiRequest = { url: string; headers: Record<string, string>; body: Uint8Array; useProxy?: boolean }

  function deepSeekModel(response: Response) {
    const apiRequest = vi.fn(async (_request: ApiRequest) => response)
    const settings = { providers: { deepseek: { apiKey: 'ds-key' } } } as unknown as Settings
    const model = getModel(
      { provider: 'deepseek', modelId: 'deepseek-asr' },
      settings,
      { uuid: 'test' },
      createDependencies({ apiRequest: apiRequest as unknown as ModelDependencies['request']['apiRequest'] })
    )
    return { model, apiRequest }
  }

  it('posts only the recording to the DeepSeek ASR endpoint', async () => {
    const { model, apiRequest } = deepSeekModel(
      jsonResponse({ request_id: 'r', text: ' 今天上海天气怎么样？ ', duration_ms: 3200 })
    )

    await expect(model.transcribe?.(AUDIO, { mediaType: 'audio/wav', language: 'zh' })).resolves.toBe(
      '今天上海天气怎么样？'
    )

    const [request] = apiRequest.mock.calls[0]
    expect(request.url).toBe('https://api.deepseek.com/v1/tools/asr')
    expect(request.headers.Authorization).toBe('Bearer ds-key')
    expect(request.headers).not.toHaveProperty('language')
    const boundary = request.headers['Content-Type'].match(/^multipart\/form-data; boundary=(.+)$/)?.[1]
    const body = new TextDecoder('latin1').decode(request.body)
    const parts = body.split(`--${boundary}`).filter((part) => part.includes('Content-Disposition'))
    expect(parts).toHaveLength(1)
    expect(parts[0]).toContain('name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF')
    expect(body).not.toContain('name="model"')
    expect(body).not.toContain('name="language"')
  })

  it('rejects MP4 audio before uploading', async () => {
    const { model, apiRequest } = deepSeekModel(jsonResponse({ text: 'unused' }))
    const error = await model.transcribe?.(AUDIO, { mediaType: 'audio/mp4' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toContain('16-bit PCM WAV audio')
    expect((error as ApiError).message).not.toContain('Ogg Opus')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('rejects recordings over 8 MiB before uploading', async () => {
    const { model, apiRequest } = deepSeekModel(jsonResponse({ text: 'unused' }))
    const error = await model
      .transcribe?.(new Uint8Array(8 * 1024 * 1024 + 1), { mediaType: 'audio/wav' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toContain('8 MiB')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('keeps the DeepSeek error body and status', async () => {
    const { model } = deepSeekModel(jsonResponse({ error: { message: 'The service is busy' } }, 503))
    const error = await model.transcribe?.(AUDIO, { mediaType: 'audio/wav' }).catch((e: unknown) => e)
    expect(error).toMatchObject({ statusCode: 503 })
    expect((error as ApiError).responseBody).toContain('The service is busy')
  })
})

describe('encodeMultipart', () => {
  const decode = (body: Uint8Array) => new TextDecoder().decode(body)
  const file = (fileName: string) => ({ name: 'file', fileName, contentType: 'application/pdf', data: AUDIO })

  it('escapes quotes and line breaks in file and field names', () => {
    const { body } = encodeMultipart({ 'we"ird\r\nfield': 'v' }, file('re"port\r\n.pdf'))
    const text = decode(body)
    expect(text).toContain('name="we%22ird%0D%0Afield"')
    expect(text).toContain('filename="re%22port%0D%0A.pdf"')
    // the injected quote/CRLF must not create extra headers or end the header value early
    expect(text.match(/Content-Disposition/g)).toHaveLength(2)
    expect(text).not.toContain('re"port')
  })

  it('keeps ordinary and non-ASCII file names unchanged', () => {
    const { body } = encodeMultipart({}, file('报告 v1.pdf'))
    expect(decode(body)).toContain('filename="报告 v1.pdf"')
  })
})

describe('isWavOnlyTranscriptionModel', () => {
  it('marks DeepSeek ASR as WAV-only', () => {
    expect(isWavOnlyTranscriptionModel('deepseek', 'deepseek-asr')).toBe(true)
  })

  it.each([
    ['deepseek', 'deepseek-chat'],
    ['openai', 'gpt-4o-mini-transcribe'],
    ['chatbox-ai', 'whisper-1'],
  ])('allows %s/%s on mobile recordings', (providerId, modelId) => {
    expect(isWavOnlyTranscriptionModel(providerId, modelId)).toBe(false)
  })
})
