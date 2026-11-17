// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLogin } from './useLogin'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/packages/remote', () => ({ sendEmailLoginCode: mocks.send, loginOrSignupWithEmailCode: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  mocks.send.mockReset()
})
afterEach(() => vi.useRealTimers())

it('releases the send button and aborts when the request never responds', async () => {
  mocks.send.mockImplementation(
    ({ signal }: { signal?: AbortSignal }) =>
      new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
  )
  const { result } = renderHook(() => useLogin({ language: 'en', onLoginSuccess: vi.fn() }))
  act(() => result.current.setEmail('user@example.test'))
  act(() => {
    void result.current.sendCode()
  })
  expect(result.current.loginState).toBe('sending_code')
  const signal = mocks.send.mock.calls[0][0].signal as AbortSignal
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000)
  })
  expect(result.current.loginState).toBe('error')
  expect(signal?.aborted).toBe(true)
  expect(result.current.canSendCode).toBe(true)
  expect(result.current.loginError).toEqual({ title: 'Failed to send login code', message: 'Connection timed out' })
})

it('keeps a successful send and countdown after the deadline', async () => {
  mocks.send.mockResolvedValue('sent')
  const { result } = renderHook(() => useLogin({ language: 'en', onLoginSuccess: vi.fn() }))
  act(() => result.current.setEmail('user@example.test'))
  await act(async () => {
    await result.current.sendCode()
  })
  const signal = mocks.send.mock.calls[0][0].signal as AbortSignal
  expect(result.current.loginState).toBe('code_sent')
  expect(result.current.hasEnteredCodeStep).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000)
  })
  expect(result.current.loginState).toBe('code_sent')
  expect(signal?.aborted).toBe(false)
})

it('ignores a late response after timing out', async () => {
  let resolveSend: (result: string) => void = () => {}
  mocks.send.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveSend = resolve
      })
  )
  const { result } = renderHook(() => useLogin({ language: 'en', onLoginSuccess: vi.fn() }))
  act(() => result.current.setEmail('user@example.test'))
  act(() => {
    void result.current.sendCode()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000)
  })
  await act(async () => {
    resolveSend('sent')
    await Promise.resolve()
  })
  expect(result.current.loginState).toBe('error')
  expect(result.current.hasEnteredCodeStep).toBe(false)
})
