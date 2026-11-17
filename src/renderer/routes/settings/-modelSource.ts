/** Labels the configured service endpoint, not the model's execution or privacy guarantees. */
export function modelEndpointLocation(endpoint: string | undefined, isChatbox: boolean): string {
  if (isChatbox) return 'Remote · Chatbox AI'
  if (!endpoint) return 'Provider-managed service'
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Check provider endpoint'
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host)
      ? 'Local service · This device'
      : 'Remote service'
  } catch {
    return 'Check provider endpoint'
  }
}
