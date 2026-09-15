import { expect, it, vi } from 'vitest'
import { BackupResourcePayloadTransform } from './resource-payload'

it('translates a split memory context without changing tool arguments or adjacent resource metadata', () => {
  const context = {
    scope: { lifecycleToken: 'source-life', copilotId: 'tutor', type: 'copilot' },
    enabled: true,
    version: 1,
  }
  const translated = { ...context, scope: { ...context.scope, lifecycleToken: 'imported-life' } }
  const translate = vi.fn(() => translated)
  const message = {
    id: 'message',
    role: 'assistant',
    contentParts: [
      { type: 'text', text: '🙂\n"Quoted"' },
      {
        type: 'tool-call',
        toolName: 'save_memory',
        toolCallId: 'call',
        state: 'paused',
        args: { memoryToolContext: context },
        memoryToolContext: context,
        resultStorageKey: 'old-resource',
      },
    ],
  }
  const transform = new BackupResourcePayloadTransform(new Map([['old-resource', 'new-resource']]), translate)
  const input = new TextEncoder().encode(JSON.stringify(message))
  const output: Uint8Array[] = []
  for (let index = 0; index < input.length; index += 7)
    output.push(...transform.write(input.subarray(index, index + 7)))
  output.push(...transform.finish().bytes)
  const decoder = new TextDecoder()
  const restored = JSON.parse(
    output.map((bytes) => decoder.decode(bytes, { stream: true })).join('') + decoder.decode()
  )
  expect(translate).toHaveBeenCalledExactlyOnceWith(context)
  expect(restored).toEqual({
    ...message,
    contentParts: [
      message.contentParts[0],
      { ...message.contentParts[1], memoryToolContext: translated, resultStorageKey: 'new-resource' },
    ],
  })
})
