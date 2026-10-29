import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { PageDebugger } from './page-debugger'

function fakeContents() {
  const target = Object.assign(new EventEmitter(), {
    attached: false,
    isAttached() {
      return this.attached
    },
    attach: vi.fn(function (this: { attached: boolean }) {
      this.attached = true
    }),
    detach: vi.fn(function (this: { attached: boolean }) {
      this.attached = false
    }),
    sendCommand: vi.fn(async () => ({})),
  })
  return { contents: { debugger: target } as unknown as WebContents, target }
}

describe('PageDebugger', () => {
  it('does not send a command whose signal already aborted', async () => {
    const { contents, target } = fakeContents()
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))

    await expect(new PageDebugger(contents).send('Page.enable', undefined, abort.signal)).rejects.toThrow('cancelled')
    expect(target.sendCommand).not.toHaveBeenCalled()
  })

  it('stops waiting for a command once its signal aborts', async () => {
    const { contents, target } = fakeContents()
    target.sendCommand.mockReturnValueOnce(new Promise(() => {}))
    const abort = new AbortController()

    const sent = new PageDebugger(contents).send('Runtime.evaluate', {}, abort.signal)
    abort.abort(new Error('timed out'))
    await expect(sent).rejects.toThrow('timed out')
  })

  it('ends its session on reset and attaches again for the next command', async () => {
    const { contents, target } = fakeContents()
    const pageDebugger = new PageDebugger(contents)
    await pageDebugger.send('Page.enable')

    pageDebugger.reset()
    expect(target.detach).toHaveBeenCalledOnce()
    expect(target.listenerCount('message')).toBe(0)

    await pageDebugger.send('Page.enable')
    expect(target.attach).toHaveBeenCalledTimes(2)
    expect(target.listenerCount('message')).toBe(1)
  })
})
