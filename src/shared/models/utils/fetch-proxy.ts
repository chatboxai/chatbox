import type { ModelDependencies } from '../../types/adapters'

type ApiRequestSignal = Parameters<ModelDependencies['request']['apiRequest']>[0]['signal']

// React Native and DOM fetch declarations expose compatible runtime signals
// through distinct ambient interfaces. Keep the conversion at this boundary.
function toApiRequestSignal(signal: RequestInit['signal']): ApiRequestSignal {
  return (signal ?? undefined) as unknown as ApiRequestSignal
}

/** Passes the provider's network-compatibility preference to the host request adapter. */
export function createFetchWithProxy(useProxy: boolean | undefined, dependencies: ModelDependencies) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const headers = (init?.headers as Record<string, string>) || {}

    if (method === 'POST') {
      // POST to AI providers may be billable; a transient network error can occur
      // after the server already processed the request. Retrying would double-charge.
      const response = await dependencies.request.apiRequest({
        url: url.toString(),
        method: 'POST',
        headers,
        body: init?.body,
        signal: toApiRequestSignal(init?.signal),
        useProxy,
        retry: 0,
      })
      return response
    } else {
      const response = await dependencies.request.apiRequest({
        url: url.toString(),
        method: 'GET',
        headers,
        signal: toApiRequestSignal(init?.signal),
        useProxy,
      })
      return response
    }
  }
}
