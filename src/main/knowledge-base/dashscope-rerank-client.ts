/**
 * Minimal rerank client for Alibaba Cloud Model Studio (DashScope / Bailian).
 *
 * Chatbox's built-in Cohere client speaks the Cohere `/v1/rerank` protocol, while
 * DashScope exposes its rerank models on
 *   POST {origin}/api/v1/services/rerank/text-rerank/text-rerank
 * with a DashScope-specific request/response shape. This client adapts that
 * endpoint to the same minimal interface used by `rerank()` in `@shared/models/rerank`.
 */

export interface RerankClientArgs {
  query: string
  documents: string[]
  model: string
  topN?: number
}

export interface RerankClientResponse {
  results: Array<{
    index: number
    relevanceScore: number
  }>
}

/** Best-effort check for Alibaba Cloud DashScope / Bailian hosts. */
export function isDashScopeHost(apiHost: string | undefined | null): boolean {
  if (!apiHost) return false
  const h = apiHost.toLowerCase()
  return h.includes('aliyuncs.com') || h.includes('dashscope') || h.includes('maas.')
}

/**
 * Reduce an API host to `scheme://host[:port]`, dropping any API path suffix
 * such as `/compatible-mode/v1`, `/compatible-api/v1` or `/api/v1`.
 */
export function toDashScopeOrigin(apiHost: string): string {
  let h = (apiHost || '').trim().replace(/\/+$/, '')
  h = h.replace(/\/(compatible-mode|compatible-api|openai|api)(\/.*)?$/i, '')
  return h.replace(/\/+$/, '')
}

export class DashScopeRerankClient {
  private readonly apiHost: string
  private readonly token: string

  constructor(options: { apiHost?: string; token?: string }) {
    this.apiHost = options.apiHost ?? ''
    this.token = options.token ?? ''
  }

  async rerank({ query, documents, model, topN }: RerankClientArgs): Promise<RerankClientResponse> {
    if (!documents.length) {
      return { results: [] }
    }

    const url = `${toDashScopeOrigin(this.apiHost)}/api/v1/services/rerank/text-rerank/text-rerank`
    const body = {
      model,
      input: { query, documents },
      parameters: {
        top_n: topN && topN > 0 ? Math.min(topN, documents.length) : documents.length,
        return_documents: false,
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`DashScope rerank request failed: HTTP ${response.status} ${detail.slice(0, 300)}`)
    }

    const data = (await response.json()) as {
      output?: { results?: Array<{ index: number; relevance_score: number }> }
      code?: string
      message?: string
    }

    if (data?.code) {
      throw new Error(`DashScope rerank error: ${data.code} ${data.message ?? ''}`.trim())
    }

    const results = (data?.output?.results ?? []).map((item) => ({
      index: item.index,
      relevanceScore: item.relevance_score,
    }))

    return { results }
  }
}
