import { describe, expect, test, vi } from 'vitest'
import type { ModelInterface } from '../models/types'
import type { Session, Settings } from '../types'
import {
  InMemoryBlobStorage,
  InMemorySessionRepository,
  InMemorySettingsRepository,
  InMemorySettingsStorage,
  MockModelFactory,
  runSessionRepositoryContract,
} from './index'

describe('portable testing adapters', () => {
  test('provides a reusable SessionRepository contract suite', async () => {
    await runSessionRepositoryContract(() => new InMemorySessionRepository())
  })

  test('retain sessions, metadata, raw settings and blobs in memory', async () => {
    const sessions = new InMemorySessionRepository()
    const settings = new InMemorySettingsStorage()
    const blobs = new InMemoryBlobStorage()
    const session = { id: 'session', name: 'Test', type: 'chat', messages: [] } satisfies Session

    await sessions.initialize()
    await sessions.setSession(session)
    await sessions.meta.create({
      id: session.id,
      name: session.name,
      type: session.type,
      sortOrder: 1,
      createdAt: 1,
    })
    await settings.write({ language: 'en' })
    await blobs.set('result', 'value')

    await expect(sessions.getSession(session.id)).resolves.toBe(session)
    await expect(sessions.meta.getById(session.id)).resolves.toMatchObject({ id: session.id })
    expect(settings.snapshot()).toEqual({ language: 'en' })
    await expect(blobs.get('result')).resolves.toBe('value')
  })

  test('publishes settings updates and creates models with an explicit context', async () => {
    const initialSettings = { language: 'en' } as Settings
    const settings = new InMemorySettingsRepository(initialSettings)
    const listener = vi.fn()
    settings.subscribe(listener)
    settings.updateSettings({ language: 'zh-Hans' })

    const model = { name: 'Mock', modelId: 'mock' } as ModelInterface
    const models = new MockModelFactory(model, { runtime: 'test' })
    const created = await models.createContext({ provider: 'openai', modelId: 'mock' })

    expect(settings.getSettings().language).toBe('zh-Hans')
    expect(listener).toHaveBeenCalledOnce()
    expect(created).toEqual({ model, context: { runtime: 'test' } })
    expect(models.requestedSettings).toHaveLength(1)
  })
})
