import type { Message } from '@shared/types'
import { migrateMessage } from '@shared/utils/message'
import { describe, expect, it } from 'vitest'
import { encodeSessionTree } from '../session/session-tree/encode'
import { legacyMessageChunks } from './legacy-message'
import { BackupMessageValidator, projectBackupMessage, serializeBackupPayload } from './payload'

function validate(message: Message) {
  return serializeBackupPayload(message).projection
}

describe('complex backup messages', () => {
  it('validates many text parts without accumulating their prefixes', () => {
    const message: Message = {
      id: 'many-parts',
      role: 'assistant',
      contentParts: Array.from({ length: 100 }, () => ({ type: 'text', text: '中'.repeat(4096) })),
    }
    const { blocks, projection } = serializeBackupPayload(message)
    expect(JSON.parse(new TextDecoder().decode(Buffer.concat(blocks)))).toEqual(message)
    expect(JSON.stringify(projection).length).toBeLessThan(8192)
  })

  it('validates large tool arrays and keeps resources after the oversized content', () => {
    const message: Message = {
      id: 'work',
      role: 'assistant',
      contentParts: [
        {
          type: 'tool-call',
          toolCallId: 'call',
          toolName: 'create_download',
          state: 'result',
          args: { values: Array.from({ length: 9000 }, (_, index) => index) },
          result: {
            values: Array.from({ length: 9000 }, () => 1),
            image_storage_key: 'image',
            artifacts: [
              {
                path: 'artifacts/report.pdf',
                name: 'report.pdf',
                mimeType: 'application/pdf',
                size: 1,
                storageKey: 'pdf',
              },
            ],
          },
        },
      ],
    }
    const projection = validate(message)
    expect(projection.contentParts).toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          image_storage_key: 'image',
          artifacts:
            message.contentParts[0].type === 'tool-call'
              ? (message.contentParts[0].result as { artifacts: unknown[] }).artifacts
              : [],
        }),
      }),
    ])
    expect(JSON.stringify(projection).length).toBeLessThan(8192)
  })

  it('still validates a malformed part after exceeding the full projection budget', () => {
    const validator = new BackupMessageValidator()
    const contentParts = Array.from({ length: 100 }, () => ({ type: 'text', text: 'x'.repeat(4096) }))
    validator.write(
      new TextEncoder().encode(
        JSON.stringify({ id: 'm', role: 'assistant', contentParts: [...contentParts, { type: 'text', text: 123 }] })
      )
    )
    expect(() => validator.finish()).toThrow()
  })

  it('preserves the existing projection for messages within the structure budget', () => {
    const message: Message = {
      id: 'small',
      role: 'assistant',
      contentParts: [
        { type: 'text', text: '中'.repeat(5000) },
        {
          type: 'tool-call',
          toolCallId: 'call',
          toolName: 'search',
          state: 'result',
          args: { query: 'test' },
          result: [1, null, { text: 'x'.repeat(5000) }],
        },
      ],
      errorExtra: { detail: 'e'.repeat(5000) },
    }
    expect(JSON.stringify(validate(message))).toBe(
      JSON.stringify({
        ...message,
        contentParts: [
          { type: 'text', text: '中'.repeat(4096) },
          { ...message.contentParts[1], result: [1, null, { text: 'x'.repeat(4096) }] },
        ],
        errorExtra: { detail: 'e'.repeat(4096) },
      })
    )
  })

  it('preserves legacy row identity and presentation metadata', () => {
    const message: Message = {
      id: 'm',
      role: 'assistant',
      timestamp: 10,
      updatedAt: 20,
      isSummary: true,
      generating: true,
      contentParts: [
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'p',
          toolName: 'run',
          pauseReason: { type: 'user_exec_approval', command: 'echo test', explanation: 'test' },
        },
        { type: 'tool-call', state: 'error', toolCallId: 'e', toolName: 'web_search', result: { errorCode: 20024 } },
      ],
      errorExtra: { values: Array.from({ length: 9000 }, () => 1) },
    }
    const encode = (value: Message) => {
      const result = encodeSessionTree({ id: 's', name: 'S', messages: [value] }, { activeThreadId: 't', now: 0 })
      if (!result.ok) throw new Error(result.reason)
      const { message: _body, ...row } = result.tree.messages[0]
      return { row, presentation: result.tree.session.presentation }
    }
    expect(encode(validate(message))).toEqual(encode(message))
  })

  it('uses identical projections for native and arbitrarily chunked payloads', () => {
    const message: Message = {
      id: 'chunks',
      role: 'assistant',
      contentParts: [
        ...Array.from({ length: 30 }, () => ({ type: 'text' as const, text: '中🙂\\\"\n'.repeat(1000) })),
        {
          result: { image_storage_key: 'image' },
          toolName: 'view_image',
          state: 'result',
          toolCallId: 'call',
          type: 'tool-call',
        },
      ],
    }
    const bytes = new TextEncoder().encode(JSON.stringify(message))
    const validator = new BackupMessageValidator()
    for (let offset = 0; offset < bytes.length; offset += 17) validator.write(bytes.subarray(offset, offset + 17))
    expect(validator.finish()).toEqual(projectBackupMessage(message))
  })

  it.each([
    ['duplicate key', '{"a":1,"a":2}', 'Duplicate backup JSON key'],
    ['escaped duplicate key', '{"a":1,"\\u0061":2}', 'Duplicate backup JSON key'],
    ['missing value', '{"a":}', 'Invalid backup JSON end'],
    ['trailing comma', '[1,]', 'Invalid backup JSON end'],
    ['invalid number', '[01]', 'Invalid backup JSON number'],
    ['nesting', `${'['.repeat(130)}0${']'.repeat(130)}`, 'Backup JSON nesting exceeds budget'],
  ])('rejects %s inside a discarded tool argument', (_label, args, error) => {
    const validator = new BackupMessageValidator()
    const prefix =
      '{"id":"m","role":"assistant","contentParts":[{"type":"tool-call","toolCallId":"c","toolName":"t","state":"result","result":[' +
      '1,'.repeat(9000) +
      '1],"args":'
    expect(() => {
      validator.write(new TextEncoder().encode(`${prefix}${args}}]}`))
      validator.finish()
    }).toThrow(error)
  })

  it('keeps the projection bounded across thousands of streamed tool calls', () => {
    const validator = new BackupMessageValidator()
    const encoder = new TextEncoder()
    validator.write(encoder.encode('{"id":"work","role":"assistant","contentParts":['))
    for (let index = 0; index < 10000; index++) {
      validator.write(
        encoder.encode(
          (index ? ',' : '') +
            JSON.stringify({
              type: 'tool-call',
              toolName: 'search',
              toolCallId: `call-${index}`,
              state: 'result',
              args: { query: 'query' },
              result: { values: [1, 2, 3], text: 'x'.repeat(100) },
            })
        )
      )
    }
    validator.write(encoder.encode(']}'))
    expect(JSON.stringify(validator.finish()).length).toBeLessThan(1024)
  })

  const tool: Message['contentParts'][number] = {
    type: 'tool-call',
    toolName: 'search',
    toolCallId: 'c',
    state: 'result',
    result: [],
  }
  it.each(
    [
      [tool],
      [tool, { ...tool, toolCallId: 'other' }],
      [{ type: 'reasoning', text: 'thinking' }],
      [{ type: 'text', text: '...' }],
      [{ type: 'text', text: '...' }, tool],
      [
        { type: 'text', text: '' },
        { type: 'text', text: '' },
      ],
      [
        { type: 'text', text: '' },
        { type: 'text', text: '正文' },
      ],
    ].map((contentParts, index) => ({ contentParts: contentParts as Message['contentParts'], index }))
  )('preserves legacy migration semantics for compact projection $index', async ({ contentParts }) => {
    const message = {
      id: 'legacy',
      role: 'assistant' as const,
      contentParts,
      content: 'legacy text',
      webBrowsing: { query: ['query'], links: [] },
      errorExtra: { values: Array.from({ length: 9000 }, () => 1) },
    }
    const bytes = new TextEncoder().encode(JSON.stringify(message))
    const validator = new BackupMessageValidator()
    validator.write(bytes)
    const { message: projection } = validator.finishLegacy()
    const chunks: Uint8Array[] = []
    for await (const chunk of legacyMessageChunks(new Blob([bytes]), 0, bytes.length, projection)) chunks.push(chunk)
    const migrated = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))
    expect(migrated.contentParts).toEqual(migrateMessage(structuredClone(message)).contentParts)
  })
})
