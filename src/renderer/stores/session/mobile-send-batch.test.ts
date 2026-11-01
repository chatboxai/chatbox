import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  insertMessage: vi.fn(),
  insertMessages: vi.fn(),
  generate: vi.fn(),
  compaction: vi.fn(),
  platform: { type: 'mobile', isDesktopLike: false },
  settings: { provider: 'chatbox-ai', modelId: 'deepseek-v4-flash' },
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { insertMessage: mocks.insertMessage, insertMessages: mocks.insertMessages },
    sessionQueryBridge: { getSession: mocks.getSession },
  },
}))
vi.mock('@/platform', () => ({ default: mocks.platform }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/adapters', () => ({ createModel: vi.fn().mockResolvedValue({}) }))
vi.mock('@/packages/context-management', () => ({ runCompactionWithUIState: mocks.compaction }))
vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: vi.fn() }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: vi.fn().mockReturnValue(1) }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))
vi.mock('./session-settings', () => ({
  getSessionHeader: mocks.getSession,
  getSessionSettings: vi.fn().mockResolvedValue(mocks.settings),
  getSessionTokenModel: vi.fn().mockReturnValue('deepseek'),
}))
vi.mock('./agent-mode', () => ({ getSessionAgentModeEntry: () => ({ value: 'off' }) }))
vi.mock('./generation', () => ({ _generateWithoutSessionLock: mocks.generate }))
vi.mock('../sessionActivityStore', () => ({ markSessionReplyFailed: vi.fn() }))
vi.mock('../sessionAttachmentRagIndexing', () => ({ ensureMessageFileSessionAttachment: vi.fn() }))
vi.mock('../settingActions', () => ({ isPro: () => false, getRemoteConfig: vi.fn().mockResolvedValue({}) }))
vi.mock('../settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => mocks.settings }) } }))
vi.mock('./utils', () => ({ getSessionWebBrowsing: () => false }))

import { submitNewUserMessageUnlocked } from './messages'

const session: Session = { id: 's', name: 'Conversation', type: 'chat', messages: [] }
const user = (): Message => ({ id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.platform.type = 'mobile'
  mocks.getSession.mockResolvedValue(session)
  mocks.insertMessage.mockResolvedValue(undefined)
  mocks.insertMessages.mockResolvedValue(undefined)
  mocks.compaction.mockResolvedValue({ status: 'skipped' })
})

describe('mobile send persistence', () => {
  it('releases the draft and starts generation only after one durable insertion completes', async () => {
    let complete!: () => void
    const pending = new Promise<void>((resolve) => {
      complete = resolve
    })
    mocks.insertMessages.mockReturnValue(pending)
    const ready = vi.fn()
    const send = submitNewUserMessageUnlocked('s', {
      newUserMsg: user(),
      needGenerating: true,
      onUserMessageReady: ready,
    })
    await vi.waitFor(() => expect(mocks.insertMessages).toHaveBeenCalledTimes(1))
    expect(ready).not.toHaveBeenCalled()
    expect(mocks.insertMessage).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.insertMessages).toHaveBeenCalledWith('s', [
      expect.objectContaining({ id: 'user', role: 'user', tokenCount: 1 }),
      expect.objectContaining({ role: 'assistant', generating: true, tokenCount: 1 }),
    ])
    complete()
    await send
    expect(ready).toHaveBeenCalledTimes(1)
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft and does not generate when the atomic insert fails', async () => {
    mocks.insertMessages.mockRejectedValueOnce(new Error('Disk unavailable'))
    const onUserMessageReady = vi.fn()
    await expect(
      submitNewUserMessageUnlocked('s', { newUserMsg: user(), needGenerating: true, onUserMessageReady })
    ).rejects.toThrow('Disk unavailable')
    expect(onUserMessageReady).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('persists a user-only send independently', async () => {
    await submitNewUserMessageUnlocked('s', { newUserMsg: user(), needGenerating: false })
    expect(mocks.insertMessage).toHaveBeenCalledTimes(1)
    expect(mocks.insertMessages).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('retains sequential insertion on desktop', async () => {
    mocks.platform.type = 'desktop'
    await submitNewUserMessageUnlocked('s', { newUserMsg: user(), needGenerating: true })
    expect(mocks.insertMessage).toHaveBeenCalledTimes(2)
    expect(mocks.insertMessages).not.toHaveBeenCalled()
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })
})
