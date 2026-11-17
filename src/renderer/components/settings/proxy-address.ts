const PROXY_SCHEME = '(?:https?|socks[45]?[ah]?|quic)'
const HOST = '(?:\\[[0-9a-f:.]+\\]|[^\\s/:@;=,\\[\\]]+)'
// [<proxy-scheme>://]<host>[:<port>] (IPv6 hosts in brackets), or direct:// for no proxy.
const PROXY_URI = new RegExp(`^(?:direct://|(?:${PROXY_SCHEME}://)?(?:[^\\s/@;=,]+@)?${HOST}(?::\\d{1,5})?/?)$`, 'i')
const URL_SCHEME = /^[a-z][a-z0-9+.-]*$/i

/**
 * Whether a proxy setting looks like Electron's `proxyRules` grammar, used to warn about typos:
 * `;`-separated rules, each an optional `<url-scheme>=` followed by a `,`-separated list of proxy
 * URIs. Empty means a direct connection.
 */
export function isValidProxyAddress(value: string) {
  if (value === '') return true
  return value.split(';').every((rule) => {
    const trimmed = rule.trim()
    if (trimmed === '') return false
    const separator = trimmed.indexOf('=')
    const scheme = separator >= 0 ? trimmed.slice(0, separator).trim() : undefined
    if (scheme !== undefined && !URL_SCHEME.test(scheme)) return false
    const list = separator >= 0 ? trimmed.slice(separator + 1) : trimmed
    return list.split(',').every((uri) => PROXY_URI.test(uri.trim()))
  })
}
