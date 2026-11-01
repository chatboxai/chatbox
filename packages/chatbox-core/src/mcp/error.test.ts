import { expect, it } from 'vitest'
import { formatMCPError } from './error'

it('redacts configured headers, bearer tokens and query credentials from errors', () => {
  const result = formatMCPError(
    new Error('401 Bearer synthetic-token; synthetic-token; license-secret; key=query-secret'),
    {
      type: 'http',
      url: 'https://example.test/mcp?key=query-secret',
      headers: { Authorization: 'Bearer synthetic-token', 'x-chatbox-license': 'license-secret' },
    }
  )
  expect(result).toContain('401')
  for (const secret of ['synthetic-token', 'license-secret', 'query-secret']) expect(result).not.toContain(secret)
})
