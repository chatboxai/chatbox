import type { MCPServerConfig } from './types'

/** Keep endpoint credentials out of connection status, logs and persisted tool errors. */
export function formatMCPError(error: unknown, transport: MCPServerConfig['transport']): string {
  let message = error instanceof Error ? error.message : String(error)
  const secrets = new Set<string>()
  const values = transport.type === 'http' ? transport.headers : transport.env
  for (const value of Object.values(values ?? {})) {
    if (value) secrets.add(value)
    if (/^(Bearer|Basic) /i.test(value)) secrets.add(value.slice(value.indexOf(' ') + 1))
  }
  if (transport.type === 'http') {
    try {
      const url = new URL(transport.url)
      if (url.username) secrets.add(decodeURIComponent(url.username))
      if (url.password) secrets.add(decodeURIComponent(url.password))
      for (const value of url.searchParams.values()) if (value) secrets.add(value)
    } catch {
      /* Malformed URLs are reported by connection validation. */
    }
  }
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join('[redacted]')
    message = message.split(encodeURIComponent(secret)).join('[redacted]')
  }
  return message
}
