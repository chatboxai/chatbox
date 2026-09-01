export interface OpenAICompatibleTranscriptionConfig {
  baseUrl: string
  model: string
  apiKey?: string
}

type FetchLike = typeof fetch

function getTranscriptionUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return `${normalized}/v1/audio/transcriptions`
}

export async function transcribeOpenAICompatibleAudio(
  config: OpenAICompatibleTranscriptionConfig,
  file: File,
  request: FetchLike = fetch
): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('model', config.model.trim())

  const apiKey = config.apiKey?.trim()
  const response = await request(getTranscriptionUrl(config.baseUrl), {
    method: 'POST',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: formData,
  })
  const payload = await response.json()

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'Audio transcription failed')
  }
  if (typeof payload?.text !== 'string' || !payload.text.trim()) {
    throw new Error('The transcription service returned no text')
  }

  return payload.text
}
