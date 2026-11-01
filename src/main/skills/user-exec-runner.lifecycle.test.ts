import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn(), capture: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../process-tree', () => ({ killProcessTree: mocks.kill }))
vi.mock('../command-output-capture', () => ({
  COMMAND_OUTPUT_CAPTURE_FAILED_MESSAGE: 'capture failed',
  createCommandOutputCapturePath: () => '/tmp/lifecycle-capture',
  createCommandOutputCapture: mocks.capture,
}))
vi.mock('../util', () => ({ getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../sandbox/login-shell-env', () => ({ getLoginShellPathIfReady: () => undefined }))

import { cancelUserExecCommand, executeUserExecCommand } from './user-exec-runner'

function createChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    killed: false,
    kill: vi.fn(),
  })
}

let child: ReturnType<typeof createChild>
let limitExceeded: boolean
let releaseDrain: (() => void) | undefined
let backpressure: boolean
let captured: string
const params = { command: 'fixture', sessionId: 'lifecycle', toolCallId: 'lifecycle' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  child = createChild()
  mocks.spawn.mockReturnValue(child)
  limitExceeded = false
  backpressure = false
  releaseDrain = undefined
  captured = ''
  mocks.capture.mockReturnValue({
    append: (_source: string, data: Buffer) => {
      captured += data.toString()
      return !backpressure
    },
    onDrain: (callback: () => void) => {
      releaseDrain = callback
    },
    isLimitExceeded: () => limitExceeded,
    isFailed: () => false,
    finish: async () => undefined,
  })
})

afterEach(() => {
  child.stdout.destroy()
  child.stderr.destroy()
  child.stdin.destroy()
  vi.useRealTimers()
})

describe('user exec lifecycle', () => {
  it('preserves output held behind capture backpressure after wrapper exit', async () => {
    const execution = executeUserExecCommand(params)
    backpressure = true
    child.stdout.write('first')
    child.stdout.write('last')
    child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(child.stdout.destroyed).toBe(false)
    backpressure = false
    releaseDrain?.()
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(execution).resolves.toMatchObject({ success: true, stdout: 'firstlast' })
    expect(captured).toBe('firstlast')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['cancel', 'timeout', 'output-limit'] as const)(
    'force-cleans descendants before settling %s after wrapper exit',
    async (reason) => {
      const execution = executeUserExecCommand({ ...params, timeout: 500 })
      if (reason === 'cancel') cancelUserExecCommand(params)
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(500)
      if (reason === 'output-limit') {
        limitExceeded = true
        child.stdout.write('limit')
      }
      child.emit('exit', null, 'SIGTERM')
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(execution).resolves.toMatchObject({ success: false })
      expect(mocks.kill).toHaveBeenCalledWith(child, 'SIGKILL')
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('cancels immediately during the drain window and force-cleans the process group', async () => {
    const execution = executeUserExecCommand(params)
    child.emit('exit', 0, null)
    expect(cancelUserExecCommand(params)).toEqual({ killed: true })
    await expect(execution).resolves.toMatchObject({ cancelled: true, exitCode: 130 })
    expect(mocks.kill).toHaveBeenCalledWith(child, 'SIGKILL')
    expect(child.stdout.destroyed).toBe(true)
    expect(cancelUserExecCommand(params)).toEqual({ killed: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['cancel', 'timeout', 'output-limit'] as const)(
    'settles %s even when kill emits neither exit nor close',
    async (reason) => {
      const execution = executeUserExecCommand({ ...params, timeout: 500 })
      if (reason === 'cancel') cancelUserExecCommand(params)
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(500)
      if (reason === 'output-limit') {
        limitExceeded = true
        child.stderr.write('limit')
      }
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(execution).resolves.toMatchObject({ success: false })
      expect(child.stdout.destroyed).toBe(true)
      expect(child.stderr.destroyed).toBe(true)
      expect(cancelUserExecCommand(params)).toEqual({ killed: false })
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})
