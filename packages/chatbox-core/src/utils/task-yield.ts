const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

// The part of MessageChannel used here; runtimes type it differently and React Native does not provide it.
interface TaskChannel {
  port1: { onmessage: (() => void) | null; close(): void }
  port2: { postMessage(message: null): void }
}
const TaskChannel = (globalThis as unknown as { MessageChannel?: new () => TaskChannel }).MessageChannel

// Hosts throttle chained timers in hidden pages; message channel tasks are not throttled that way.
function nextTask(): Promise<void> {
  if (!TaskChannel) return new Promise((resolve) => setTimeout(resolve, 0))
  return new Promise((resolve) => {
    const channel = new TaskChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/** Returns a function that lets the host run pending UI work once `intervalMs` of work has passed since the last yield. */
export function createTaskYielder(intervalMs = 25): () => Promise<void> {
  let since = now()
  return async () => {
    if (now() - since < intervalMs) return
    await nextTask()
    since = now()
  }
}
