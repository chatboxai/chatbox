import { describe, expect, it } from 'vitest'
import { validateBackupGlobal } from './globals'
import type { BackupBusinessRecord } from '../backup-v3'

type Global = Extract<BackupBusinessRecord, { type: 'global' }>
const check = (category: Global['category'], value: unknown, id = 'record') =>
  validateBackupGlobal({ type: 'global', category, id, value })
describe('V3 global payload validation', () => {
  it.each([
    ['copilot', { id: 'c', name: 'Name', prompt: 1 }],
    ['copilot', { id: 'c', name: 'Name', prompt: 'Prompt', avatar: { type: 'storage-key', storageKey: 42 } }],
    ['folder', { id: 'f', name: 12 }],
    ['soul', 'text'],
    ['global-memory', { id: 'm', content: { text: 'wrong' }, createdAt: 1 }],
    [
      'copilot-memory',
      [
        { id: 'm', content: 'ok', createdAt: 1 },
        { id: 'm', content: 'duplicate', createdAt: 2 },
      ],
    ],
    ['copilot-memory', null],
    ['session-settings', { modelId: 42 }],
    ['settings', { shortcuts: { inputBoxSendMessage: 'Alt+Enter' } }],
  ] as const)('rejects malformed %s values', (category, value) => {
    expect(() => check(category, value)).toThrow()
  })
  it('rejects malformed identity payloads instead of silently filtering them', () => {
    expect(() => check('memory-identities', { id: 'c', token: 'invalid token' }, 'token:c')).toThrow()
    expect(() => check('memory-identities', { id: 'c', token: 'valid', retirementToken: '' }, 'token:c')).toThrow()
    expect(() => check('memory-identities', { id: 'c', name: 12 }, 'owner:c')).toThrow()
    expect(() => check('memory-identities', { id: 'c', name: 'Name' }, 'unknown:c')).toThrow()
  })
  it('accepts portable data and leaves unknown business extensions intact', () => {
    const copilot = { id: 'c', name: 'Name', prompt: 'Prompt', extension: { version: 1 } }
    expect(() => check('copilot', copilot)).not.toThrow()
    expect(copilot.extension).toEqual({ version: 1 })
    expect(() => check('soul', { content: 'Soul', updatedAt: 1 })).not.toThrow()
    expect(() => check('global-memory', { id: 'm', content: 'Memory', createdAt: 1 })).not.toThrow()
    expect(() => check('copilot-memory', [])).not.toThrow()
    expect(() => check('memory-identities', { id: 'c', name: 'Name' }, 'owner:c')).not.toThrow()
    expect(() =>
      check('memory-identities', { id: 'c', token: 'valid-token', retirementToken: 'valid-retirement' }, 'token:c')
    ).not.toThrow()
  })
})
