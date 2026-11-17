// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { cancelRunSource, parseRunOutcome, redactUrl, runScriptSource } from './script-run'

// Chromium provides these; jsdom does not.
if (!globalThis.CSS?.escape) {
  Object.assign(globalThis, { CSS: { escape: (value: string) => value } })
}
if (!Element.prototype.scrollBy) {
  Element.prototype.scrollBy = () => undefined
}

function evaluate(source: string): Promise<unknown> {
  return Promise.resolve(new Function(`return ${source}`)())
}

describe('run wrapper', () => {
  const key = '__chatboxRun_op_test'

  it('does not run the body on another url', async () => {
    const result = await evaluate(runScriptSource('window.ran = true', 'https://other.example/', key))
    expect(result).toEqual({ kind: 'page_changed' })
    expect((window as unknown as { ran?: boolean }).ran).toBeUndefined()
  })

  it('returns values and script errors separately and removes its run record', async () => {
    await expect(evaluate(runScriptSource('return { a: 1 }', location.href, key))).resolves.toEqual({
      kind: 'value',
      value: '{"a":1}',
      truncated: false,
      violations: [],
    })
    await expect(evaluate(runScriptSource("throw new Error('Failed to fetch')", location.href, key))).resolves.toEqual({
      kind: 'error',
      message: 'Failed to fetch',
      violations: [],
    })
    expect(key in window).toBe(false)
  })

  it('reports a return value it cannot serialize as a failure, not an unknown outcome', async () => {
    const result = await evaluate(runScriptSource('const a = {}; a.self = a; return a', location.href, key))
    expect(result).toMatchObject({ kind: 'error', message: expect.stringContaining('cannot be serialized') })
  })

  it('collects CSP violations the page reports while the body runs', async () => {
    const body = `const event = new Event('securitypolicyviolation', { bubbles: true });
      Object.assign(event, { effectiveDirective: 'connect-src', blockedURI: 'http://127.0.0.1:9000/a?x=1' });
      document.body.dispatchEvent(event);
      throw new TypeError('Failed to fetch')`
    const outcome = parseRunOutcome(await evaluate(runScriptSource(body, location.href, key)))
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Failed to fetch',
      violations: [{ directive: 'connect-src', blocked: 'http://127.0.0.1:9000/a?x=1' }],
    })
  })

  it('collects CSP violations of a failure the body caught itself', async () => {
    const body = `setTimeout(() => {
        const event = new Event('securitypolicyviolation', { bubbles: true });
        Object.assign(event, { effectiveDirective: 'connect-src', blockedURI: 'https://api.example/x' });
        document.body.dispatchEvent(event);
      }, 0);
      return 'caught'`
    const outcome = parseRunOutcome(await evaluate(runScriptSource(body, location.href, key)))
    expect(outcome).toMatchObject({
      kind: 'value',
      value: 'caught',
      violations: [{ directive: 'connect-src', blocked: 'https://api.example/x' }],
    })
  })

  it('lets the host stop a running body at its next helper wait', async () => {
    const running = evaluate(runScriptSource('for (;;) await browser.sleep(5)', location.href, key))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await evaluate(cancelRunSource(key))).toEqual([])
    await expect(running).resolves.toMatchObject({ kind: 'error', message: expect.stringContaining('stopped') })
    expect(await evaluate(cancelRunSource(key))).toBeNull()
  })

  it('stops a cancelled body at its next scroll', async () => {
    const body = 'for (;;) { await new Promise((resolve) => setTimeout(resolve, 5)); browser.scroll(10) }'
    const running = evaluate(runScriptSource(body, location.href, key))
    await new Promise((resolve) => setTimeout(resolve, 20))
    await evaluate(cancelRunSource(key))
    await expect(running).resolves.toMatchObject({ kind: 'error', message: expect.stringContaining('stopped') })
  })
})

describe('redactUrl', () => {
  it('keeps origin and path only', () => {
    expect(redactUrl('https://user:pw@s3.example/bucket/key.png?X-Amz-Signature=abc#frag')).toBe(
      'https://s3.example/bucket/key.png'
    )
    expect(redactUrl('inline')).toBe('inline')
    expect(redactUrl('data:image/png;base64,AAAA')).toBe('data')
    expect(redactUrl('not a url')).toBe('')
    expect(redactUrl(`https://a.example/${'p'.repeat(300)}`).length).toBeLessThan(160)
  })
})
