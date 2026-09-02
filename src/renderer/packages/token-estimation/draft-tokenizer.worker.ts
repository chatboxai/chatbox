import {
  type DraftTokenizationWorkerRequest,
  type DraftTokenizationWorkerResponse,
  handleDraftTokenizationRequest,
} from './draft-tokenizer-worker-handler'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<DraftTokenizationWorkerRequest>) => void) | null
  postMessage(message: DraftTokenizationWorkerResponse): void
}

workerScope.onmessage = (event) => {
  const { id, text, tokenizerType } = event.data
  try {
    const { tokens } = handleDraftTokenizationRequest({ text, tokenizerType })
    workerScope.postMessage({ id, tokens })
  } catch (error) {
    workerScope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
