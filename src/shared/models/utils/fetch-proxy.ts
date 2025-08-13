import type { ModelDependencies } from '../../types/adapters'
import { ApiError } from '../errors'

/**
 * Creates a fetch function that uses proxy when enabled,
 * or falls back to apiRequest for mobile CORS handling
 */
export function createFetchWithProxy(useProxy: boolean | undefined, dependencies: ModelDependencies) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const headers = (init?.headers as Record<string, string>) || {}

    if (method === 'POST') {
      const response = await dependencies.request.apiRequest({
        url: url.toString(),
        method: 'POST',
        headers,
        body: init?.body,
        signal: init?.signal || undefined,
        useProxy,
      })
      return response
    } else {
      const response = await dependencies.request.apiRequest({
        url: url.toString(),
        method: 'GET',
        headers,
        signal: init?.signal || undefined,
        useProxy,
      })
      return response
    }
  }
}

interface ListModelsResponse {
  object: 'list'
  data: {
    id: string
    object: 'model'
    created: number
    owned_by: string
  }[]
}

export async function fetchRemoteModels(
  params: { apiHost: string; apiKey: string; useProxy?: boolean },
  dependencies: ModelDependencies
) {
  const response = await dependencies.request.apiRequest({
    url: `${params.apiHost}/models`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
    useProxy: params.useProxy,
  })
  const json: ListModelsResponse = await response.json()
  if (!json.data) {
    throw new ApiError(JSON.stringify(json))
  }
  return json.data.map((item) => item.id)
}
