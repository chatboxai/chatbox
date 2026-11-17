import type { Message } from '@chatbox/core'
import { useEffect, useState } from 'react'

export function useRetryCountdown(status: Extract<NonNullable<Message['status']>[number], { type: 'retrying' }>) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!status.retryAt) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [status.retryAt])
  const values = {
    attempt: Math.max(1, status.attempt - 1),
    maxAttempts: Math.max(1, status.maxAttempts - 1),
    seconds: Math.max(1, Math.ceil(((status.retryAt ?? now) - now) / 1000)),
  }
  return values
}
