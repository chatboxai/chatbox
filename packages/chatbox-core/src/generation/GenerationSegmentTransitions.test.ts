import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { GenerationSegmentTransitions } from './GenerationSegmentTransitions'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('GenerationSegmentTransitions', () => {
  it('makes Stop wait for the durable split and adopt before finalizing', async () => {
    const abort = new AbortController()
    const transitions = new GenerationSegmentTransitions(abort.signal)
    const write = deferred<boolean>()
    let target = 'original'
    const split = transitions.run(
      () => write.promise,
      () => {
        target = 'tail'
      }
    )
    await Promise.resolve()
    abort.abort()
    let stopped: string | undefined
    const stop = transitions.settle().then(() => {
      stopped = target
    })
    await Promise.resolve()
    assert.equal(stopped, undefined)
    write.resolve(true)
    assert.equal(await split, true)
    await stop
    assert.equal(stopped, 'tail')
  })

  it('keeps the original target after an uncommitted atomic write', async () => {
    const transitions = new GenerationSegmentTransitions(new AbortController().signal)
    let adopted = false
    assert.equal(
      await transitions.run(
        async () => false,
        () => {
          adopted = true
        }
      ),
      false
    )
    await transitions.settle()
    assert.equal(adopted, false)
  })

  it('does not let failed persistence prevent cancellation cleanup', async () => {
    const transitions = new GenerationSegmentTransitions(new AbortController().signal)
    const write = deferred<boolean>()
    const split = transitions.run(
      () => write.promise,
      () => {
        throw new Error('must not adopt')
      }
    )
    const stop = transitions.settle()
    write.reject(new Error('disk error'))
    await assert.rejects(split, /disk error/)
    await stop
  })

  it('does not start a structural write when already aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    const transitions = new GenerationSegmentTransitions(abort.signal)
    assert.equal(
      await transitions.run(
        async () => {
          throw new Error('must not write')
        },
        () => {}
      ),
      false
    )
  })
})
