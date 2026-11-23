import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'

/** DotHoosh OpenAI-compatible base URL; the SDK appends `/chat/completions`. */
export const DOTHOOSH_API_HOST = 'https://gateway.dothoosh.com/v1'

/**
 * Normalize the base URL a user may paste in Settings. DotHoosh serves one
 * `/v1` surface, so `https://gateway.dothoosh.com`, the documented
 * `.../v1`, a trailing-slash variant and a pasted full
 * `.../v1/chat/completions` all resolve to the same base instead of producing
 * `/v1/v1/chat/completions`.
 */
export function normalizeDotHooshApiHost(apiHost?: string): string {
  const value = (apiHost || '').trim()
  if (!value) return DOTHOOSH_API_HOST
  return normalizeOpenAIApiHostAndPath({ apiHost: value }).apiHost
}

/** Trim copied keys and drop a pasted `Bearer` prefix or wrapping quotes. */
export function normalizeDotHooshApiKey(apiKey?: string): string {
  return (apiKey || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^"+|"+$/g, '')
    .trim()
}

interface Options extends OpenAICompatibleSettings {}

export default class DotHoosh extends OpenAICompatible {
  public name = 'DotHoosh'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    const normalizedOptions: Options = {
      ...options,
      apiKey: normalizeDotHooshApiKey(options.apiKey),
      apiHost: normalizeDotHooshApiHost(options.apiHost),
      // DotHoosh reports usage on the final chat-completions SSE chunk.
      includeUsage: true,
    }
    super(normalizedOptions, dependencies)
    this.options = normalizedOptions
  }
}
