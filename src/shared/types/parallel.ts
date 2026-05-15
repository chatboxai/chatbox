import type { Message } from './session'

/**
 * Parallel output state for a session
 */
export type ParallelOutputState = {
  sessionId: string
  parentMessageId: string // The user message that triggered parallel output
  slots: ParallelSlot[]
  selectedIndex: number | null // User selected index, null means not selected
  createdAt: number
}

/**
 * A single slot in parallel output
 */
export type ParallelSlot = {
  index: number
  message: Message | null // Generated message, null if not started
  status: 'waiting' | 'generating' | 'completed' | 'error'
  error?: string
}

/**
 * Configuration for parallel output
 */
export type ParallelOutputConfig = {
  count: number
  interval: number
}
