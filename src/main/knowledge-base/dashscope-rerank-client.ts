/**
 * Minimal rerank client for Alibaba Cloud Model Studio (DashScope / Bailian).
 *
 * Bailian serves rerank models over two different HTTP protocols, picked per model:
 *
 *  1. `qwen3-rerank` — workspace OpenAI-compatible rerank API
 *       POST {origin}/compatible-api/v1/reranks
 *       body:   { model, query, documents, top_n, instruct? }
 *       result: { object: 'list', results: [{ index, relevance_score }] }
 *
 *  2. everything else (`qwen3.7-text-rerank`, `qwen3-vl-rerank`, `gte-rerank-v2`) — DashScope native API
 *       POST {origin}/api/v1/services/rerank/text-rerank/text-rerank
 *       body:   { model, input: { query, documents }, parameters: { top_n, return_documents } }
 *       result: { output: { results: [{ index, relevance_score }] } }
 *
 * Both responses are normalised into the minimal contract consumed by `rerank()`
 * in `@shared/models/rerank`.
 *
 * Reference: https://help.aliyun.com/zh/model-studio/text-rerank-api
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

/** Request timeout so a hung rerank call cannot stall the RAG pipeline. */
export const DASHSCOPE_RERANK_TIMEOUT_MS = 30_000

/** Models served by the workspace OpenAI-compatible `/reranks` endpoint. */
const COMPATIBLE_RERANK_MODELS = new Set(['qwen3-rerank'])

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

/** Whether the model is served by the OpenAI-compatible `/reranks` endpoint. */
export function usesCompatibleRerankApi(model: string): boolean {
  return COMPATIBLE_RERANK_MODELS.has((model || '').trim().toLowerCase())
}

/** Build the endpoint + request body for the given host and model. */
export function buildRerankRequest(args: {
  apiHost: string
  model: string
  query: string
  documents: string[]
  topN?: number
}): { url: string; body: Record<string, unknown> } {
  const origin = toDashScopeOrigin(args.apiHost)
  const topN =
    args.topN && args.topN > 0 ? Math.min(args.topN, args.documents.length) : args.documents.length

  if (usesCompatibleRerankApi(args.model)) {
    return {
      url: `${origin}/compatible-api/v1/reranks`,
      body: {
        model: args.model,
        query: args.query,
        documents: args.documents,
        top_n: topN,
      },
    }
  }

  return {
    url: `${origin}/api/v1/services/rerank/text-rerank/text-rerank`,
    body: {
      model: args.model,
      input: { query: args.query, documents: args.documents },
      parameters: { top_n: topN, return_documents: false },
    },
  }
}

/** Normalise either protocol's response payload into the shared result shape. */
export function parseRerankResponse(data: unknown): RerankClientResponse['results'] {
  const payload = (data ?? {}) as { output?: { results?: unknown }; results?: unknown }
  const raw = Array.isArray(payload.output?.results)
    ? (payload.output?.results as unknown[])
    : Array.isArray(payload.results)
      ? (payload.results as unknown[])
      : []

  return raw
    .map((item) => {
      const r = (item ?? {}) as { index?: unknown; relevance_score?: unknown; relevanceScore?: unknown }
      const score = typeof r.relevance_score === 'number' ? r.relevance_score : r.relevanceScore
      return {
        index: typeof r.index === 'number' ? r.index : -1,
        relevanceScore: typeof score === 'number' ? score : 0,
      }
    })
    .filter((item) => item.index >= 0)
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

    const { url, body } = buildRerankRequest({ apiHost: this.apiHost, model, query, documents, topN })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DASHSCOPE_RERANK_TIMEOUT_MS)

    let data: unknown
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(
          `DashScope rerank request failed: HTTP ${response.status} ${detail.slice(0, 300)}`
        )
      }

      data = await response.json()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`DashScope rerank request timed out after ${DASHSCOPE_RERANK_TIMEOUT_MS}ms`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }

    const payload = (data ?? {}) as { code?: string; message?: string }
    if (payload.code) {
      throw new Error(`DashScope rerank error: ${payload.code} ${payload.message ?? ''}`.trim())
    }

    const results = parseRerankResponse(data)

    // A 2xx response we cannot parse means the payload does not match the protocol
    // we picked. Throwing lets the caller fall back to the un-reranked results
    // instead of silently dropping the whole retrieval context.
    if (results.length === 0) {
      throw new Error('DashScope rerank returned no parsable results (unexpected response shape)')
    }

    return { results }
  }
}
