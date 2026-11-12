import type { Message, MessageFile, MessageLink } from '@shared/types'
import { uploadedFilePath, uploadedFileToolHint } from '@shared/uploaded-file-tools'
import { describe, expect, it } from 'vitest'
import { collectCompactedAttachments, describeCompactedAttachments, withRequestAttachmentState } from './attachments'

const file = (id: string, extra: Partial<MessageFile> = {}): MessageFile => ({
  id,
  name: `${id}.txt`,
  fileType: 'text/plain',
  storageKey: `${id}-key`,
  ...extra,
})
const link: MessageLink = { id: 'link', url: 'https://example.com', title: 'Example', storageKey: 'link-key' }

describe('compacted attachments', () => {
  it('collects covered files and links, including those an earlier summary carried', () => {
    const messages: Message[] = [
      { id: 'summary', role: 'assistant', isSummary: true, contentParts: [], compactedFiles: [file('a')] },
      { id: 'u1', role: 'user', contentParts: [], files: [file('b')], links: [link] },
      { id: 'u2', role: 'user', contentParts: [], files: [file('a', { lineCount: 9 })] },
      { id: 'a1', role: 'assistant', contentParts: [] },
    ]

    expect(collectCompactedAttachments(messages)).toEqual({
      compactedFiles: [file('a', { lineCount: 9 }), file('b')],
      compactedLinks: [link],
    })
    expect(collectCompactedAttachments([{ id: 'a1', role: 'assistant', contentParts: [] }])).toEqual({})
  })

  it('describes each attachment by a path only where the request has a tool that opens it', () => {
    const attachments = { compactedFiles: [file('a')], compactedLinks: [link] }

    const unreadable = describeCompactedAttachments(attachments)
    expect(unreadable).toContain('<FILE_NAME>a.txt</FILE_NAME>')
    expect(unreadable).toContain('<FILE_NAME>Example</FILE_NAME>')
    expect(unreadable).not.toContain('<FILE_PATH>')
    expect(unreadable).toContain('cannot be reopened')

    const fileTools = describeCompactedAttachments(attachments, { modelSupportToolUseForFile: true })
    expect(fileTools).toContain(`<FILE_PATH>${uploadedFilePath('a-key')}</FILE_PATH>`)
    expect(fileTools).toContain(uploadedFileToolHint('a-key'))
    expect(fileTools).toContain(`<FILE_PATH>${uploadedFilePath('link-key')}</FILE_PATH>`)

    // Workspace tools hold uploaded files only; a link stays a name.
    const workspace = describeCompactedAttachments(attachments, { workspacePath: (entry) => `input/${entry.name}` })
    expect(workspace).toContain('<WORKSPACE_PATH>input/a.txt</WORKSPACE_PATH>')
    expect(workspace).not.toContain('<FILE_PATH>')

    expect(describeCompactedAttachments({})).toBe('')
  })

  const indexed = file('pdf', {
    ragMode: 'session-retrieval',
    sessionAttachmentId: 7,
    sessionAttachmentIndexStatus: 'ready',
  })

  it('gives a retrieval file its retrieval block only with the file tools that register retrieval', () => {
    const withTools = describeCompactedAttachments({ compactedFiles: [indexed] }, { modelSupportToolUseForFile: true })
    expect(withTools).toContain('<FILE_KEY>session-attachment:7</FILE_KEY>')
    expect(withTools).toContain('<INDEX_STATUS>ready</INDEX_STATUS>')

    const withoutTools = describeCompactedAttachments({ compactedFiles: [indexed] })
    expect(withoutTools).toContain('<FILE_NAME>pdf.txt</FILE_NAME>')
    expect(withoutTools).toContain('cannot be reopened')
    expect(withoutTools).not.toContain('session-attachment:7')
    expect(withoutTools).not.toContain('RETRIEVAL_MODE')

    const sandbox = describeCompactedAttachments({ compactedFiles: [indexed] }, { sandboxMode: true })
    expect(sandbox).toContain('<SANDBOX_PATH>')
    expect(sandbox).not.toContain('RETRIEVAL_MODE')
  })

  it('names a covered file that has no location at all', () => {
    const local = file('local', { storageKey: undefined, localPath: '/tmp/local.txt' })
    expect(describeCompactedAttachments({ compactedFiles: [local] })).toContain('<FILE_NAME>local.txt</FILE_NAME>')
  })

  it("takes each file's state from the request when the request holds it", () => {
    const stored = { ...indexed, sessionAttachmentIndexStatus: 'pending' as const }
    const request: Message[] = [{ id: 'u', role: 'user', contentParts: [], files: [indexed] }]

    expect(withRequestAttachmentState({ compactedFiles: [stored, file('b')] }, request)).toEqual({
      compactedFiles: [indexed, file('b')],
    })
    expect(withRequestAttachmentState({}, request)).toEqual({})
  })
})
