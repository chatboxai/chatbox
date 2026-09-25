/** Accepts full URLs and bare hosts such as `example.com` or `localhost:3000`. */
export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('URL is empty')
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[^/:]+:\d+(\/|$)/.test(trimmed)
  if (hasScheme) return new URL(trimmed).toString()
  const scheme = /^(localhost|127\.|\[::1\])/i.test(trimmed) ? 'http' : 'https'
  return new URL(`${scheme}://${trimmed}`).toString()
}
