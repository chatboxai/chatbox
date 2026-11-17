import { runRequest, type WorkerRequest } from './runtime'

const worker = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: unknown): void
}
let running = false
worker.onmessage = (event) => {
  if (running) return
  running = true
  void runRequest(event.data).then((response) => worker.postMessage(response))
}
