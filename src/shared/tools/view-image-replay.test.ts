import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { buildViewImageToolResultContent, buildViewImageUserMessage, viewImageAttachmentNotice } from './view-image'
import { createViewImageBatchBudget } from './view-image-batch'
import { boundToolResultImages } from './view-image-replay'

function batch(native: boolean, prefix: string, count: number): ModelMessage[] {
  const images = Array.from({ length: count }, (_, i) => ({
    filePath: `${prefix}-${i}.png`,
    base64Data: 'aW1hZ2U=',
    mediaType: 'image/png',
  }))
  return [
    {
      role: 'assistant',
      content: images.map((image) => ({
        type: 'tool-call',
        toolCallId: image.filePath,
        toolName: 'view_image',
        input: { file_path: image.filePath },
      })),
    },
    {
      role: 'tool',
      content: images.map((image) => ({
        type: 'tool-result',
        toolCallId: image.filePath,
        toolName: 'view_image',
        output: native
          ? buildViewImageToolResultContent(image)
          : { type: 'text', value: viewImageAttachmentNotice(image.filePath) },
      })),
    },
    ...(native ? [] : [buildViewImageUserMessage(images)]),
  ]
}

function countImages(messages: ModelMessage[]): number {
  return messages.reduce((count, message) => {
    if (message.role === 'user' && Array.isArray(message.content))
      return count + message.content.filter((part) => part.type === 'image').length
    if (message.role === 'tool')
      return (
        count +
        message.content.reduce(
          (n, part) =>
            n +
            (part.type === 'tool-result' && part.output.type === 'content'
              ? part.output.value.filter((value) => value.type === 'file').length
              : 0),
          0
        )
      )
    return count
  }, 0)
}

describe.each([true, false])('image replay native=%s', (native) => {
  it('keeps pending pixels on retries and returns to the historical window after a response', () => {
    const input = [...batch(native, 'old', 8), ...batch(native, 'new', 8)]
    const bounded = boundToolResultImages(input, 5)
    expect(countImages(bounded)).toBe(13)
    expect(countImages(input)).toBe(16)
    expect(boundToolResultImages(bounded, 5)).toEqual(bounded)
    expect(countImages(boundToolResultImages([...bounded, { role: 'assistant', content: 'Inspected.' }], 5))).toBe(5)
  })

  it('does not count a steered user message as model consumption', () => {
    const input = [...batch(native, 'new', 8), { role: 'user' as const, content: 'Also check the captions.' }]
    expect(countImages(boundToolResultImages(input, 5))).toBe(8)
  })
})

it('reserves a bounded number of calls per SDK prompt and permits the next step', () => {
  const reserve = createViewImageBatchBudget()
  const prompt: ModelMessage[] = []
  for (let i = 0; i < 8; i++) reserve(prompt)
  expect(() => reserve(prompt)).toThrow('Image not read')
  expect(() => reserve([...prompt, { role: 'assistant', content: 'Next batch.' }])).not.toThrow()
})
