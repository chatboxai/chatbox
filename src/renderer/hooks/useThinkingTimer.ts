import { useEffect, useState } from 'react'

/**
 * Custom hook for tracking real-time elapsed time for thinking processes
 * Handles cleanup on component unmount and provides smooth 100ms updates
 * @param startTime - The timestamp when thinking started (in milliseconds)
 * @param isActive - Whether the thinking process is currently active
 * @returns The elapsed time in milliseconds
 */
export function useThinkingTimer(startTime: number | undefined, isActive: boolean): number {
  const [elapsedTime, setElapsedTime] = useState(0)

  useEffect(() => {
    if (!isActive || !startTime) {
      setElapsedTime(0)
      return
    }

    // Update immediately to avoid delay
    const updateElapsed = () => {
      setElapsedTime(Date.now() - startTime)
    }

    updateElapsed()

    // Set up interval to update every 100ms for smooth real-time updates
    // This provides responsive feedback while being performant
    const interval = setInterval(updateElapsed, 100)

    // Cleanup interval on unmount or when dependencies change
    return () => clearInterval(interval)
  }, [startTime, isActive])

  return elapsedTime
}

/**
 * Format elapsed time in a human-readable format
 * @param milliseconds - Time in milliseconds
 * @returns Formatted time string (e.g., "3.2s", "15.7s", "1m 23s")
 */
export function formatElapsedTime(milliseconds: number): string {
  if (milliseconds < 1000) {
    return '0.0s'
  }

  const totalSeconds = milliseconds / 1000

  if (totalSeconds < 60) {
    // Show one decimal place for seconds under 60
    return `${totalSeconds.toFixed(1)}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = Math.floor(totalSeconds % 60)

  if (remainingSeconds === 0) {
    return `${minutes}m`
  }

  return `${minutes}m ${remainingSeconds}s`
}
