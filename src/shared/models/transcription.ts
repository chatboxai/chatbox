import { ApiError } from './errors'

export type TranscriptionMediaType = 'audio/wav' | 'audio/mp4'

export interface TranscribeOptions {
  mediaType: TranscriptionMediaType
  /** ISO-639-1 hint such as `zh` or `en`; omitted means the service detects the language. */
  language?: string
  signal?: RequestInit['signal']
}

/**
 * Where a provider serves transcription: OpenAI-compatible `POST {baseURL}/audio/transcriptions` by default,
 * MiniMax `POST {baseURL}/speech_to_text`, which takes the language in a `language` header, or DeepSeek
 * `POST {baseURL}/v1/tools/asr`, which takes only the audio file and detects the language itself.
 */
export interface TranscriptionEndpoint {
  api?: 'openai' | 'minimax' | 'deepseek'
  baseURL: string
  apiKey: string
  headers?: Record<string, string>
  fetch: (url: string, init: RequestInit) => Promise<Response>
}

const FILE_EXTENSIONS: Record<TranscriptionMediaType, string> = {
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
}

/** DeepSeek ASR accepts 16-bit PCM WAV files of at most 8 MiB. */
const DEEPSEEK_MAX_AUDIO_BYTES = 8 * 1024 * 1024

/** Mobile voice input records MP4, so WAV-only models such as DeepSeek ASR cannot be used there. */
export function isWavOnlyTranscriptionModel(providerId: string, modelId: string): boolean {
  return providerId === 'deepseek' && modelId === 'deepseek-asr'
}

/**
 * Sends one recording to a transcription endpoint and returns the text.
 *
 * The multipart body is encoded here as bytes rather than through FormData/Blob, because React Native
 * cannot build a Blob from bytes and the host request adapters forward byte bodies unchanged.
 */
export async function transcribeWithProvider(
  endpoint: TranscriptionEndpoint,
  model: string,
  audio: Uint8Array,
  options: TranscribeOptions
): Promise<string> {
  const minimax = endpoint.api === 'minimax'
  const deepseek = endpoint.api === 'deepseek'
  if (deepseek && options.mediaType !== 'audio/wav') {
    throw new ApiError('DeepSeek speech recognition only accepts 16-bit PCM WAV audio')
  }
  if (deepseek && audio.length > DEEPSEEK_MAX_AUDIO_BYTES) {
    throw new ApiError('DeepSeek speech recognition accepts recordings of at most 8 MiB')
  }
  const fields: Record<string, string> = deepseek ? {} : minimax ? { model, response_format: 'json' } : { model }
  if (options.language && !minimax && !deepseek) fields.language = options.language
  const { body, contentType } = encodeMultipart(fields, {
    name: 'file',
    fileName: `audio.${FILE_EXTENSIONS[options.mediaType]}`,
    contentType: options.mediaType,
    data: audio,
  })

  const path = deepseek ? '/v1/tools/asr' : minimax ? '/speech_to_text' : '/audio/transcriptions'
  const response = await endpoint.fetch(`${endpoint.baseURL.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: {
      ...endpoint.headers,
      ...(minimax && options.language ? { language: options.language } : {}),
      Authorization: `Bearer ${endpoint.apiKey}`,
      'Content-Type': contentType,
    },
    body,
    signal: options.signal,
  })
  const responseText = await response.text()
  if (!response.ok) {
    throw new ApiError(`Status Code ${response.status}, ${responseText}`, responseText, response.status)
  }
  const result = JSON.parse(responseText) as { text?: unknown }
  return typeof result.text === 'string' ? result.text.trim() : ''
}

/** Escapes a form-data header parameter the way browsers do (RFC 7578 / WHATWG): `"`, CR and LF become percent escapes. */
function escapeFormDataParam(value: string): string {
  return value.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export function encodeMultipart(
  fields: Record<string, string>,
  file: { name: string; fileName: string; contentType: string; data: Uint8Array }
): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = `----chatbox-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  const encoder = new TextEncoder()
  let head = ''
  for (const [name, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${escapeFormDataParam(name)}"\r\n\r\n${value}\r\n`
  }
  head += `--${boundary}\r\nContent-Disposition: form-data; name="${escapeFormDataParam(file.name)}"; filename="${escapeFormDataParam(file.fileName)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
  const headBytes = encoder.encode(head)
  const tailBytes = encoder.encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(new ArrayBuffer(headBytes.length + file.data.length + tailBytes.length))
  body.set(headBytes, 0)
  body.set(file.data, headBytes.length)
  body.set(tailBytes, headBytes.length + file.data.length)
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}
