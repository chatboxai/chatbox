import { describe, expect, it } from 'vitest'
import { getComposerPlaceholder, getSubmitAction, getSubmitControl } from './submitAction'

const base = {
  generating: false,
  needGenerating: true,
  sessionType: 'chat' as const,
  queueLength: 0,
  blockedForOtherReasons: false,
  queueEnabled: true,
  hasModel: true,
}

describe('getSubmitAction', () => {
  it('sends in the normal idle case', () => {
    expect(getSubmitAction(base)).toBe('send')
  })

  it('blocks when other guards are active or there is no model', () => {
    expect(getSubmitAction({ ...base, blockedForOtherReasons: true })).toBe('block')
    expect(getSubmitAction({ ...base, hasModel: false })).toBe('block')
    expect(getSubmitAction({ ...base, generating: true, blockedForOtherReasons: true })).toBe('block')
  })

  it('queues while generating', () => {
    expect(getSubmitAction({ ...base, generating: true })).toBe('queue')
  })

  it('blocks instead of queueing while generating when the queue is disabled (chat mode)', () => {
    expect(getSubmitAction({ ...base, generating: true, queueEnabled: false })).toBe('block')
  })

  it('still drains behind legacy queued items when the queue is disabled', () => {
    // Order preservation wins over "no new enqueues": an idle send must not
    // jump ahead of items queued before the mode split.
    expect(getSubmitAction({ ...base, queueEnabled: false, queueLength: 2 })).toBe('queue-resume')
  })

  it('keeps the historical no-op for "insert without reply" during generation', () => {
    expect(getSubmitAction({ ...base, generating: true, needGenerating: false })).toBe('block')
  })

  it('keeps legacy picture sessions read-only', () => {
    expect(getSubmitAction({ ...base, sessionType: 'picture' })).toBe('block')
    expect(getSubmitAction({ ...base, generating: true, sessionType: 'picture' })).toBe('block')
    expect(getSubmitAction({ ...base, needGenerating: false, sessionType: 'picture' })).toBe('block')
  })

  it('queues behind pending items when idle so send order is preserved', () => {
    expect(getSubmitAction({ ...base, queueLength: 2 })).toBe('queue-resume')
  })

  it('sends directly when idle with an empty queue even without needGenerating', () => {
    expect(getSubmitAction({ ...base, needGenerating: false })).toBe('send')
    expect(getSubmitAction({ ...base, needGenerating: false, queueLength: 1 })).toBe('send')
  })
})

describe('getSubmitControl', () => {
  const controlBase = {
    generating: true,
    hasDraft: true,
    canQueueDraft: true,
    queueEnabled: true,
    sessionType: 'chat' as const,
    hasModel: true,
  }

  it('shows the normal send control while idle', () => {
    expect(getSubmitControl({ ...controlBase, generating: false, hasDraft: false, canQueueDraft: false })).toBe('send')
    expect(getSubmitControl({ ...controlBase, generating: false })).toBe('send')
  })

  it('shows stop for an empty draft while generating', () => {
    expect(getSubmitControl({ ...controlBase, hasDraft: false })).toBe('stop')
  })

  it('replaces stop with the queue send control when the draft can be queued', () => {
    expect(getSubmitControl(controlBase)).toBe('queue')
  })

  it('keeps stop available when a non-empty draft cannot be queued', () => {
    expect(getSubmitControl({ ...controlBase, canQueueDraft: false })).toBe('stop')
  })

  it('keeps stop available when generating sessions do not support queueing', () => {
    expect(getSubmitControl({ ...controlBase, sessionType: 'picture' })).toBe('stop')
    expect(getSubmitControl({ ...controlBase, hasModel: false })).toBe('stop')
  })

  it('keeps stop while generating when the queue is disabled (chat mode)', () => {
    expect(getSubmitControl({ ...controlBase, queueEnabled: false })).toBe('stop')
  })
})

describe('getComposerPlaceholder', () => {
  const placeholderBase = {
    blockReason: undefined,
    generating: false,
    queueEnabled: true,
  }

  it('prompts normally while idle', () => {
    expect(getComposerPlaceholder(placeholderBase)).toEqual({ kind: 'idle' })
  })

  it('shows the hard block reason regardless of streaming', () => {
    expect(getComposerPlaceholder({ ...placeholderBase, blockReason: 'compaction' })).toEqual({
      kind: 'locked',
      reason: 'compaction',
    })
    expect(
      getComposerPlaceholder({ ...placeholderBase, blockReason: 'awaiting-pause-decision', generating: true })
    ).toEqual({
      kind: 'locked',
      reason: 'awaiting-pause-decision',
    })
  })

  it('offers the queue hint while generating in work mode', () => {
    expect(getComposerPlaceholder({ ...placeholderBase, generating: true })).toEqual({ kind: 'queue' })
  })

  it('shows the generating lock notice instead of the queue hint in chat mode', () => {
    // The placeholder must match what pressing Enter actually does: chat mode
    // rejects the send with the generating notice rather than queueing it.
    expect(getComposerPlaceholder({ ...placeholderBase, generating: true, queueEnabled: false })).toEqual({
      kind: 'locked',
      reason: 'generating',
    })
  })
})
