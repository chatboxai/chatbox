import type { Message, MessageFile, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessionsMock, sessionQueryBridgeMock, generationRuntimeMock, ragControllerMock, guardSessionActionMock } =
  vi.hoisted(() => ({
    sessionsMock: {
      removeMessage: vi.fn().mockResolvedValue(undefined),
      updateSessionWithMessages: vi.fn(),
    },
    sessionQueryBridgeMock: {
      getSession: vi.fn(),
    },
    generationRuntimeMock: {
      get: vi.fn(() => undefined),
      discard: vi.fn(),
    },
    ragControllerMock: {
      rebindAttachment: vi.fn().mockResolvedValue(undefined),
      deleteMessageAttachments: vi.fn().mockResolvedValue([]),
    },
    guardSessionActionMock: vi.fn().mockResolvedValue(true),
  }))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: sessionsMock,
    sessionQueryBridge: sessionQueryBridgeMock,
    generationRuntime: generationRuntimeMock,
  },
}))
vi.mock('@/platform', () => ({
  default: { isDesktopLike: true, getSessionAttachmentRagController: () => ragControllerMock },
}))
vi.mock('./action-guard', () => ({ guardSessionAction: guardSessionActionMock }))
vi.mock('@/adapters', () => ({ createModel: vi.fn() }))
vi.mock('@/packages/context-management', () => ({ runCompactionWithUIState: vi.fn() }))
vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: vi.fn() }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: () => 0 }))
vi.mock('../sessionAttachmentRagIndexing', () => ({ ensureMessageFileSessionAttachment: vi.fn() }))
vi.mock('../settingActions', () => ({ isPro: () => false, getRemoteConfig: vi.fn() }))
vi.mock('../settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => ({}) }) } }))
vi.mock('./session-settings', () => ({ getSessionSettings: vi.fn() }))
vi.mock('./utils', () => ({ getSessionWebBrowsing: vi.fn() }))

import { deleteFork } from './forks'
import { removeMessage } from './messages'

function ragFile(sessionAttachmentId: number): MessageFile {
  return {
    id: `file-${sessionAttachmentId}`,
    name: 'doc.pdf',
    fileType: 'application/pdf',
    ragMode: 'session-retrieval',
    storageKey: 'storage-doc',
    sessionAttachmentId,
  } as MessageFile
}

function message(id: string, role: 'user' | 'assistant', files?: MessageFile[]): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }], files } as Message
}

beforeEach(() => {
  vi.clearAllMocks()
  guardSessionActionMock.mockResolvedValue(true)
  generationRuntimeMock.get.mockReturnValue(undefined)
})

describe('shared attachment ownership', () => {
  it('rebinds a shared attachment to the surviving version before deleting the original prompt', async () => {
    // Save & Resend shape: the original prompt lives in a fork branch while
    // its versioned copy heads the active tail, both referencing attachment 42.
    const original = message('original', 'user', [ragFile(42)])
    const replacement = message('replacement', 'user', [ragFile(42)])
    const session: Session = {
      id: 'session-1',
      name: 'Test',
      messages: [message('pivot', 'assistant'), replacement],
      messageForksHash: {
        pivot: {
          position: 1,
          createdAt: 0,
          lists: [{ id: 'list-0', messages: [original, message('old-reply', 'assistant')] }],
        },
      },
    } as Session
    sessionQueryBridgeMock.getSession.mockResolvedValue(session)

    await removeMessage('session-1', 'original')

    expect(ragControllerMock.rebindAttachment).toHaveBeenCalledWith({
      attachmentId: 42,
      sessionId: 'session-1',
      messageId: 'replacement',
    })
    expect(ragControllerMock.deleteMessageAttachments).toHaveBeenCalledWith('original')
    expect(sessionsMock.removeMessage).toHaveBeenCalledWith('session-1', 'original')
  })

  it('leaves unshared attachments with the deleted message', async () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test',
      messages: [message('lonely', 'user', [ragFile(7)]), message('reply', 'assistant')],
    } as Session
    sessionQueryBridgeMock.getSession.mockResolvedValue(session)

    await removeMessage('session-1', 'lonely')

    expect(ragControllerMock.rebindAttachment).not.toHaveBeenCalled()
    expect(ragControllerMock.deleteMessageAttachments).toHaveBeenCalledWith('lonely')
  })

  it('still deletes the message when the rebind fails', async () => {
    ragControllerMock.rebindAttachment.mockRejectedValueOnce(new Error('ipc failed'))
    const session: Session = {
      id: 'session-1',
      name: 'Test',
      messages: [message('kept', 'user', [ragFile(42)]), message('doomed', 'user', [ragFile(42)])],
    } as Session
    sessionQueryBridgeMock.getSession.mockResolvedValue(session)

    await removeMessage('session-1', 'doomed')

    expect(sessionsMock.removeMessage).toHaveBeenCalledWith('session-1', 'doomed')
  })

  it('rebinds attachments shared with survivors when the active branch is deleted', async () => {
    const original = message('original', 'user', [ragFile(42)])
    const replacement = message('replacement', 'user', [ragFile(42)])
    const session: Session = {
      id: 'session-1',
      name: 'Test',
      messages: [message('pivot', 'assistant'), replacement],
      messageForksHash: {
        pivot: {
          position: 1,
          createdAt: 0,
          lists: [{ id: 'list-0', messages: [original, message('old-reply', 'assistant')] }],
        },
      },
    } as Session
    sessionsMock.updateSessionWithMessages.mockImplementation(
      async (_id: string, updater: (session: Session) => Session, options: { onFullSessionPersisted?: () => void }) => {
        const updated = updater(session)
        options?.onFullSessionPersisted?.()
        return updated
      }
    )

    await deleteFork('session-1', 'pivot')
    // The rebind is fire-and-forget from the persistence callback.
    await vi.waitFor(() => expect(ragControllerMock.rebindAttachment).toHaveBeenCalled())

    // Deleting the active branch drops the versioned copy and restores the
    // original prompt, so the shared row follows the survivor.
    expect(ragControllerMock.rebindAttachment).toHaveBeenCalledWith({
      attachmentId: 42,
      sessionId: 'session-1',
      messageId: 'original',
    })
  })
})
