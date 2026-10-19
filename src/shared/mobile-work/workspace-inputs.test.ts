import { expect, it } from 'vitest'
import { InMemoryBlobStorage } from '@chatbox/core/testing'
import { collectWorkspaceInputs, type AttachmentMessage } from './workspace-inputs'

it('preflights streamed attachment facts and new-message images without conversation text', async () => {
  const blobs = new InMemoryBlobStorage()
  await blobs.set('raw', 'data:text/plain;base64,YQ==')
  await blobs.set('photo', 'data:image/png;base64,Yg==')
  async function* references(): AsyncGenerator<AttachmentMessage> {
    yield { files: [{ id: 'f', name: 'file.txt', storageKey: 'parsed', rawStorageKey: 'raw' }], contentParts: [] }
    yield { contentParts: [{ type: 'image', storageKey: 'photo' }] }
    yield { contentParts: [{ type: 'image', storageKey: 'photo' }] }
  }
  const result = await collectWorkspaceInputs({}, references(), blobs, async () => 'image-hash')
  expect(result).toEqual({ 'input/66-file.txt': { base64: 'YQ==' }, 'input/image-image-hash.png': { base64: 'Yg==' } })
})

it('does not return a partial workspace when the metadata source fails at completion', async () => {
  async function* references(): AsyncGenerator<AttachmentMessage> {
    yield { contentParts: [] }
    throw new Error('Session changed')
  }
  await expect(collectWorkspaceInputs({}, references(), new InMemoryBlobStorage(), async () => 'hash')).rejects.toThrow(
    'Session changed'
  )
})
