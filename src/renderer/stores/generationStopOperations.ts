export type GenerationStopStatus = 'idle' | 'stopping' | 'failed'

type StopOperation = {
  status: Exclude<GenerationStopStatus, 'idle'>
  task?: Promise<void>
}

const operations = new Map<string, StopOperation>()
const listeners = new Set<() => void>()

export function sessionStopOperationKey(sessionId: string): string {
  return `session:${sessionId}`
}

export function messageStopOperationKey(sessionId: string, messageId: string): string {
  return `message:${sessionId}\u0000${messageId}`
}

function notifyListeners(): void {
  for (const listener of listeners) listener()
}

export function subscribeGenerationStopOperations(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getGenerationStopStatus(key: string | undefined): GenerationStopStatus {
  return (key && operations.get(key)?.status) || 'idle'
}

export function startGenerationStop(key: string, run: () => Promise<void>): Promise<void> {
  const current = operations.get(key)
  if (current?.status === 'stopping' && current.task) return current.task

  const operation: StopOperation = { status: 'stopping' }
  operations.set(key, operation)
  notifyListeners()

  let task: Promise<void>
  try {
    task = Promise.resolve(run())
  } catch (error) {
    task = Promise.reject(error)
  }
  operation.task = task
  void task.then(
    () => clearGenerationStopOperation(key, operation),
    () => {
      if (operations.get(key) !== operation) return
      operation.status = 'failed'
      operation.task = undefined
      notifyListeners()
    }
  )
  return task
}

function clearGenerationStopOperation(key: string, expected?: StopOperation): void {
  if (expected && operations.get(key) !== expected) return
  if (!operations.delete(key)) return
  notifyListeners()
}

export function clearMessageGenerationStopOperation(sessionId: string, messageId: string): void {
  clearGenerationStopOperation(messageStopOperationKey(sessionId, messageId))
}

export function clearSessionGenerationStopOperations(sessionId: string): void {
  const sessionKey = sessionStopOperationKey(sessionId)
  const messagePrefix = `message:${sessionId}\u0000`
  let changed = false
  for (const key of operations.keys()) {
    if (key === sessionKey || key.startsWith(messagePrefix)) {
      operations.delete(key)
      changed = true
    }
  }
  if (changed) notifyListeners()
}
