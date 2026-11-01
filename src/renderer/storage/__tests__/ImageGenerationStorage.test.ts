import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { ImageGeneration } from '@shared/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { IndexedDBImageGenerationStorage } from '../ImageGenerationStorage'

const record: ImageGeneration = {
  id: 'record-1',
  prompt: 'a cat',
  referenceImages: [],
  generatedImages: ['picture:image-gen:record-1'],
  createdAt: 1,
  model: { provider: 'chatbox-ai', modelId: 'gpt-image-1' },
  status: 'done',
}

async function writeRaw(value: Record<string, unknown>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('chatbox-image-generation', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('records', { keyPath: 'id' })
      store.createIndex('createdAt', 'createdAt', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const put = db.transaction('records', 'readwrite').objectStore('records').put(value)
    put.onsuccess = () => resolve()
    put.onerror = () => reject(put.error)
  })
  db.close()
}

describe('IndexedDBImageGenerationStorage', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory()
  })

  it('round-trips a complete record', async () => {
    const storage = new IndexedDBImageGenerationStorage()
    await storage.initialize()
    await storage.create(record)

    expect(await storage.getById(record.id)).toEqual(record)
    expect((await storage.getPage(0)).items).toEqual([record])
  })

  it('stops paging once the stored records run out', async () => {
    const storage = new IndexedDBImageGenerationStorage()
    await storage.initialize()
    for (let i = 0; i < 3; i++) {
      await storage.create({ ...record, id: `record-${i}`, createdAt: i })
    }

    const first = await storage.getPage(0, 2)
    expect(first.items.map((item) => item.id)).toEqual(['record-2', 'record-1'])
    expect(first.nextCursor).toBe(2)

    const second = await storage.getPage(first.nextCursor ?? 0, 2)
    expect(second.items.map((item) => item.id)).toEqual(['record-0'])
    expect(second.nextCursor).toBeNull()
  })

  it('stops paging when a record is missing from the createdAt index', async () => {
    const { createdAt: _createdAt, ...withoutCreatedAt } = record
    await writeRaw({ ...withoutCreatedAt, id: 'unindexed' })

    const storage = new IndexedDBImageGenerationStorage()
    await storage.initialize()
    await storage.create(record)

    const page = await storage.getPage(0, 20)
    expect(page.items.map((item) => item.id)).toEqual([record.id])
    expect(page.nextCursor).toBeNull()
    // Counts what paging can actually yield, so a consumer recomputing the offset agrees.
    expect(page.total).toBe(1)
    expect(await storage.getTotal()).toBe(2)
  })

  it('keeps a record without a model readable', async () => {
    const { model: _model, ...withoutModel } = record
    await writeRaw(withoutModel)

    const storage = new IndexedDBImageGenerationStorage()
    await storage.initialize()

    const expected = { ...withoutModel, model: { provider: '', modelId: '' } }
    expect(await storage.getById(record.id)).toEqual(expected)
    expect((await storage.getPage(0)).items).toEqual([expected])
  })

  it('fills the other required fields consumers dereference', async () => {
    await writeRaw({ id: record.id, createdAt: record.createdAt, status: 'done' })

    const storage = new IndexedDBImageGenerationStorage()
    await storage.initialize()

    expect(await storage.getById(record.id)).toEqual({
      id: record.id,
      createdAt: record.createdAt,
      status: 'done',
      model: { provider: '', modelId: '' },
      prompt: '',
      referenceImages: [],
      generatedImages: [],
    })
  })
})
