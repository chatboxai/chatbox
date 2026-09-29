import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { buildExecutionHtml, EXECUTION_MESSAGE_CHANNEL } from './execution-html'

const job = { id: 'job', code: 'console.log(55)', files: {}, timeoutMs: 100 }
const response = { id: job.id, result: { stdout: '55', files: {} } }

function runHost(Worker: unknown, bridge: 'parent' | 'react-native' = 'parent', source = '') {
  const messages: string[] = []
  const clearTimeout = vi.fn()
  const setTimeout = vi.fn(() => 7)
  const html = buildExecutionHtml(
    job,
    source,
    bridge === 'parent' ? { type: 'parent', token: 'secret' } : { type: bridge }
  )
  runInNewContext(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')), {
    Worker,
    parent: { postMessage: (value: string) => messages.push(value) },
    window: { ReactNativeWebView: { postMessage: (value: string) => messages.push(value) } },
    setTimeout,
    clearTimeout,
  })
  return { html, messages, setTimeout, clearTimeout }
}

describe('execution host', () => {
  it.each(['parent', 'react-native'] as const)(
    'loads the complete Unicode worker and returns replies through %s',
    (bridge) => {
      const source = '/* </script> 中文 😀 % # */ self.onmessage = () => {}'
      let workerUrl = ''
      let posted: unknown
      const terminate = vi.fn()
      const { html, messages, clearTimeout } = runHost(
        class {
          onmessage?: (event: { data: typeof response }) => void
          constructor(url: string) {
            workerUrl = url
          }
          postMessage(value: unknown) {
            posted = value
            this.onmessage?.({ data: response })
          }
          terminate = terminate
        },
        bridge,
        source
      )
      expect(workerUrl).toMatch(/^data:text\/javascript;charset=utf-8,/)
      expect(workerUrl.length).toBeLessThan(1000)
      expect(posted).toEqual({ source, request: job })
      expect(JSON.parse(messages[0])).toEqual(
        bridge === 'parent' ? { ...response, channel: EXECUTION_MESSAGE_CHANNEL, token: 'secret' } : response
      )
      expect(terminate).toHaveBeenCalledOnce()
      expect(clearTimeout).toHaveBeenCalledWith(7)
      expect(html.match(/<\/script>/g)).toHaveLength(1)
      expect(html).toContain("connect-src 'none'")
      expect(html).toContain('worker-src data:')
    }
  )

  it('bootstraps the bundled worker before delivering the execution request', () => {
    let workerUrl = ''
    let envelope: unknown
    runHost(
      class {
        constructor(url: string) {
          workerUrl = url
        }
        postMessage(value: unknown) {
          envelope = value
        }
      },
      'parent',
      'self.onmessage=event=>self.postMessage(event.data)'
    )
    const postMessage = vi.fn()
    const self: { postMessage: typeof postMessage; onmessage?: (event: { data: unknown }) => void } = { postMessage }
    runInNewContext(decodeURIComponent(workerUrl.slice(workerUrl.indexOf(',') + 1)), { self })
    self.onmessage?.({ data: envelope })
    expect(postMessage).toHaveBeenCalledWith(job)
  })

  it('reports a synchronous Worker startup rejection immediately', () => {
    const { messages, setTimeout } = runHost(
      class {
        constructor() {
          throw new Error('Worker loading denied')
        }
      }
    )
    expect(JSON.parse(messages[0]).result.error).toBe('Execution worker failed')
    expect(setTimeout).not.toHaveBeenCalled()
  })

  it.each(['onerror', 'onmessageerror'] as const)(
    'terminates once and reports %s without waiting for timeout',
    (event) => {
      const terminate = vi.fn()
      const { messages, clearTimeout } = runHost(
        class {
          onerror?: () => void
          onmessageerror?: () => void
          onmessage?: (event: { data: typeof response }) => void
          postMessage() {
            this[event]?.()
            this.onmessage?.({ data: response })
          }
          terminate = terminate
        }
      )
      expect(messages).toHaveLength(1)
      expect(JSON.parse(messages[0]).result.error).toBe('Execution worker failed')
      expect(terminate).toHaveBeenCalledOnce()
      expect(clearTimeout).toHaveBeenCalledWith(7)
    }
  )
})
