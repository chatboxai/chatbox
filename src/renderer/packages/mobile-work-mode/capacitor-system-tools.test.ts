// @vitest-environment jsdom
import NiceModal from '@ebay/nice-modal-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapacitorWorkspace } from './CapacitorWorkspace'
import {
  adaptCapacitorSystemTools,
  createCapacitorSystemToolGroups,
  type CapacitorSystemToolsPlugin,
} from './capacitor-system-tools'

const registered = vi.hoisted(() => ({
  calendarRead: vi.fn(async () => ({ value: [] })),
  healthRead: vi.fn(async () => ({ value: { availability: 'no_readable_data' } })),
}))
afterEach(() => vi.clearAllMocks())

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'ios', isPluginAvailable: () => true },
  registerPlugin: () => registered,
}))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: vi.fn(), hide: vi.fn() } }))
vi.mock('@/i18n', () => ({
  default: { t: (value: string, args?: { provider?: string }) => value.replace('{{provider}}', args?.provider ?? '') },
}))

describe('Capacitor native system tool adapter', () => {
  it('maps positional shared calls to native objects and unwraps every result', async () => {
    const native: CapacitorSystemToolsPlugin = {
      calendarRead: vi.fn(async () => ({ value: [{ title: 'Meeting' }] })),
      calendarSave: vi.fn(async () => ({ value: 'event' })),
      remindersRead: vi.fn(async () => ({ value: [] })),
      reminderCreate: vi.fn(async () => ({ value: 'reminder' })),
      reminderComplete: vi.fn(async () => ({ value: true })),
      photoSave: vi.fn(async () => ({ value: true })),
      healthRead: vi.fn(async () => ({ value: { availability: 'no_readable_data' } })),
    }
    const adapter = adaptCapacitorSystemTools(native)
    expect(await adapter.calendarRead(1, 2)).toEqual([{ title: 'Meeting' }])
    expect(native.calendarRead).toHaveBeenCalledWith({ start: 1, end: 2 })
    expect(await adapter.calendarSave(null, 'Meeting', 1, 2, true)).toBe('event')
    expect(native.calendarSave).toHaveBeenCalledWith({ id: null, title: 'Meeting', start: 1, end: 2, allDay: true })
    expect(await adapter.remindersRead(false)).toEqual([])
    expect(await adapter.reminderCreate('Follow up', null)).toBe('reminder')
    expect(native.reminderCreate).toHaveBeenCalledWith({ title: 'Follow up', due: null })
    expect(await adapter.reminderComplete('reminder', true)).toBe(true)
    expect(await adapter.photoSave('file:///cache/photo.png')).toBe(true)
    expect(native.photoSave).toHaveBeenCalledWith({ uri: 'file:///cache/photo.png' })
    expect(await adapter.healthRead('sleep', 1, 2)).toEqual({ availability: 'no_readable_data' })
    expect(native.healthRead).toHaveBeenCalledWith({ kind: 'sleep', start: 1, end: 2 })
  })
})

describe('Capacitor disclosure and picker consent', () => {
  const options = { toolCallId: 'test', messages: [] }
  it('asks again before disclosing another health data type', async () => {
    vi.mocked(NiceModal.show).mockResolvedValue(true)
    const groups = createCapacitorSystemToolGroups({
      sessionId: 'health-test',
      providerLabel: 'Example provider',
      workspace: new CapacitorWorkspace(),
    })
    const tools = await groups.find((group) => group.id === 'health')!.load()
    await tools.health_summary.execute!({ kind: 'steps', start: 1, end: 2 }, options)
    await tools.health_summary.execute!({ kind: 'sleep', start: 1, end: 2 }, options)
    expect(NiceModal.show).toHaveBeenCalledTimes(2)
    expect(registered.healthRead).toHaveBeenCalledTimes(2)
  })

  it('keeps read grants separate for equally named recipients', async () => {
    vi.mocked(NiceModal.show).mockResolvedValue(true)
    for (const providerIdentity of ['custom-one/model', 'custom-two/model']) {
      const groups = createCapacitorSystemToolGroups({
        sessionId: 'same-name-provider-test',
        providerLabel: 'Company Gateway / Model',
        providerIdentity,
        workspace: new CapacitorWorkspace(),
      })
      const tools = await groups.find((group) => group.id === 'calendar')!.load()
      await tools.calendar_read.execute!({ start: 1, end: 2 }, options)
      await tools.calendar_read.execute!({ start: 1, end: 2 }, options)
    }
    expect(NiceModal.show).toHaveBeenCalledTimes(2)
    const props = vi.mocked(NiceModal.show).mock.calls[0][1] as { message: string }
    expect(props.message).toContain('Company Gateway / Model')
    expect(props.message).not.toContain('custom-one')
  })

  it('starts the picker inside the confirmation callback before its promise resolves', async () => {
    let allow: ((value: boolean) => void) | undefined
    vi.mocked(NiceModal.show).mockImplementation(
      () =>
        new Promise((resolve) => {
          allow = resolve
        })
    )
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'))
    })
    const groups = createCapacitorSystemToolGroups({
      sessionId: 'photo-test',
      providerLabel: 'Example provider',
      workspace: new CapacitorWorkspace(),
    })
    const tools = await groups.find((group) => group.id === 'photos')!.load()
    const result = tools.photos_select.execute!({}, options)
    await vi.waitFor(() => expect(NiceModal.show).toHaveBeenCalledTimes(1))
    expect(click).not.toHaveBeenCalled()
    const props = vi.mocked(NiceModal.show).mock.calls[0][1] as { onConfirm(): void }
    props.onConfirm()
    expect(click).toHaveBeenCalledTimes(1)
    allow?.(true)
    expect(await result).toEqual({ status: 'canceled', files: [] })
    click.mockRestore()
  })
})
