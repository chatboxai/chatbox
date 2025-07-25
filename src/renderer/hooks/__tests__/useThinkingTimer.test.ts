import { renderHook, act } from '@testing-library/react'
import { useThinkingTimer, formatElapsedTime } from '../useThinkingTimer'

// Mock Date.now to control time
const mockDateNow = jest.fn()
Date.now = mockDateNow

describe('useThinkingTimer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should return 0 when not active', () => {
    mockDateNow.mockReturnValue(1000)
    const { result } = renderHook(() => useThinkingTimer(500, false))
    expect(result.current).toBe(0)
  })

  it('should return 0 when startTime is undefined', () => {
    mockDateNow.mockReturnValue(1000)
    const { result } = renderHook(() => useThinkingTimer(undefined, true))
    expect(result.current).toBe(0)
  })

  it('should calculate elapsed time correctly', () => {
    const startTime = 1000
    mockDateNow.mockReturnValue(3500) // 2.5 seconds later
    
    const { result } = renderHook(() => useThinkingTimer(startTime, true))
    expect(result.current).toBe(2500)
  })

  it('should update elapsed time with interval', () => {
    const startTime = 1000
    mockDateNow.mockReturnValueOnce(2000) // Initial render: 1 second elapsed

    const { result } = renderHook(() => useThinkingTimer(startTime, true))
    expect(result.current).toBe(1000)

    // Advance time and trigger interval (now updates every 100ms)
    mockDateNow.mockReturnValue(3000) // 2 seconds elapsed
    act(() => {
      jest.advanceTimersByTime(100)
    })

    expect(result.current).toBe(2000)
  })
})

describe('formatElapsedTime', () => {
  it('should format time less than 1 second as "0.0s"', () => {
    expect(formatElapsedTime(500)).toBe('0.0s')
    expect(formatElapsedTime(999)).toBe('0.0s')
  })

  it('should format seconds with decimal precision under 60s', () => {
    expect(formatElapsedTime(1000)).toBe('1.0s')
    expect(formatElapsedTime(3200)).toBe('3.2s')
    expect(formatElapsedTime(15700)).toBe('15.7s')
    expect(formatElapsedTime(59900)).toBe('59.9s')
  })

  it('should format minutes correctly', () => {
    expect(formatElapsedTime(60000)).toBe('1m')
    expect(formatElapsedTime(120000)).toBe('2m')
  })

  it('should format minutes and seconds correctly (no decimals for minutes)', () => {
    expect(formatElapsedTime(65000)).toBe('1m 5s')
    expect(formatElapsedTime(125000)).toBe('2m 5s')
    expect(formatElapsedTime(183000)).toBe('3m 3s')
  })
})
