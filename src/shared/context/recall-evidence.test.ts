import type { Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildContext } from './builder'
import type { AttachmentResolver } from './types'

const resolver: AttachmentResolver = { read: async () => null }

function message(id: string, role: Message['role'], contentParts: Message['contentParts']): Message {
  return { id, role, timestamp: 1, contentParts } as Message
}

function recallPart(result: string) {
  return {
    type: 'tool-call' as const,
    state: 'result' as const,
    toolCallId: 'recall-1',
    toolName: 'retrieve_by_stamp',
    args: { stamp: 'a1b2c3d4e5f6', question: '原始结论' },
    result,
  }
}

describe('temporary recall evidence', () => {
  it('keeps recall evidence for the current and immediate follow-up prompt only', async () => {
    const messages: Message[] = [
      message('u1', 'user', [{ type: 'text', text: '开始任务' }]),
      message('a1', 'assistant', [recallPart('临时召回证据')]),
      message('u2', 'user', [{ type: 'text', text: '继续分析' }]),
      message('a2', 'assistant', [{ type: 'text', text: '继续结果' }]),
      message('u3', 'user', [{ type: 'text', text: '再继续' }]),
    ]

    const current = await buildContext(messages.slice(0, 2), { attachmentResolver: resolver, toolCleanupMode: 'none' })
    const followUp = await buildContext(messages.slice(0, 4), { attachmentResolver: resolver, toolCleanupMode: 'none' })
    const later = await buildContext(messages, { attachmentResolver: resolver, toolCleanupMode: 'none' })

    expect(JSON.stringify(current)).toContain('临时召回证据')
    expect(JSON.stringify(followUp)).toContain('临时召回证据')
    expect(JSON.stringify(later)).not.toContain('临时召回证据')
  })

  it('does not mutate history and preserves ordinary tool results', async () => {
    const recall = message('a1', 'assistant', [recallPart('临时召回证据')])
    const ordinary = message('a2', 'assistant', [{
      type: 'tool-call',
      state: 'result',
      toolCallId: 'read-1',
      toolName: 'read_file',
      result: '普通工具结果',
    }])
    const messages: Message[] = [
      message('u1', 'user', [{ type: 'text', text: '开始任务' }]),
      recall,
      message('u2', 'user', [{ type: 'text', text: '继续分析' }]),
      ordinary,
      message('u3', 'user', [{ type: 'text', text: '再继续' }]),
    ]

    const result = await buildContext(messages, { attachmentResolver: resolver, toolCleanupMode: 'none' })

    expect(JSON.stringify(result)).not.toContain('临时召回证据')
    expect(JSON.stringify(result)).toContain('普通工具结果')
    expect(JSON.stringify(messages)).toContain('临时召回证据')
  })
})
