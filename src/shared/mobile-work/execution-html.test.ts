import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { buildExecutionHtml, EXECUTION_MESSAGE_CHANNEL } from './execution-html'

it('wraps worker replies in the authenticated parent bridge and keeps RN optional', () => {
  const messages: string[] = []
  const html = buildExecutionHtml({ id: 'job', code: '1', files: {}, timeoutMs: 100 }, '', {
    type: 'parent',
    token: 'secret',
  })
  const response = { id: 'job', result: { stdout: 'ok', files: {} } }
  runInNewContext(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')), {
    Blob: class {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Worker: class {
      onmessage?: (event: { data: typeof response }) => void
      postMessage() {
        this.onmessage?.({ data: response })
      }
      terminate() {}
    },
    parent: { postMessage: (value: string) => messages.push(value) },
    setTimeout: () => {},
  })
  expect(JSON.parse(messages[0])).toEqual({ ...response, channel: EXECUTION_MESSAGE_CHANNEL, token: 'secret' })
  expect(html).toContain("connect-src 'none'")
  expect(html).not.toContain('ReactNativeWebView')
})
