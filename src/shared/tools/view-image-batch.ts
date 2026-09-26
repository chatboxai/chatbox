import type { ModelMessage } from 'ai'

export const VIEW_IMAGE_MAX_CALLS_PER_STEP = 8
export const VIEW_IMAGE_MAX_NORMALIZED_LENGTH = 3 * 1024 * 1024

export const VIEW_IMAGE_BATCH_GUIDANCE =
  `Call view_image at most ${VIEW_IMAGE_MAX_CALLS_PER_STEP} times per model step; request additional images in a later step. ` +
  'New image results are included in the next model request. Only the five most recent historical tool images are retained; ' +
  'write important visual observations and their source paths into your working notes before continuing.'

/** AI SDK supplies the same messages array to all concurrent tool calls in a step. */
export function createViewImageBatchBudget(): (messages: ModelMessage[]) => void {
  const callsByStep = new WeakMap<ModelMessage[], number>()
  return (messages) => {
    const calls = callsByStep.get(messages) ?? 0
    if (calls >= VIEW_IMAGE_MAX_CALLS_PER_STEP) {
      throw new Error(
        `Image not read: at most ${VIEW_IMAGE_MAX_CALLS_PER_STEP} images can be viewed or captured per step. Request this image in the next step.`
      )
    }
    // Reserve before asynchronous reads so concurrent calls cannot overbook the batch.
    callsByStep.set(messages, calls + 1)
  }
}

/** Results following the last assistant response have no subsequent model response yet. */
export function lastAssistantMessageIndex(messages: ReadonlyArray<{ role: string }>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') return index
  }
  return -1
}
