import { tool, type ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { LocalWorkMode, WORK_INSTRUCTIONS } from './LocalWorkMode'
import { MobileExecutionService } from './MobileExecutionService'
import type { LocalWorkspacePort } from './workspace-port'

function fixture() {
  const workspace: LocalWorkspacePort = {
    snapshot: vi.fn(async () => ({})),
    commit: vi.fn(async () => {}),
    readText: vi.fn(async () => ''),
    readBase64: vi.fn(async () => ''),
    deliver: vi.fn(async () => ({ path: 'artifacts/report.txt', name: 'report.txt', mimeType: 'text/plain', size: 0 })),
  }
  const calendarRead = vi.fn(async () => ({ events: [] }))
  const photosSelect = vi.fn(async () => ({ files: [] }))
  const work = new LocalWorkMode(workspace, new MobileExecutionService(), () => [
    {
      id: 'calendar',
      description: 'Calendar',
      load: async () => ({ calendar_read: tool({ inputSchema: z.object({}), execute: calendarRead }) }),
    },
    {
      id: 'photos',
      description: 'Photos',
      load: async () => ({ photos_select: tool({ inputSchema: z.object({}), execute: photosSelect }) }),
    },
  ])
  return { work, workspace, calendarRead, photosSelect }
}
const execute = (tools: ToolSet, name: string, input: unknown) =>
  tools[name].execute?.(input, { toolCallId: name, messages: [] })

describe('local load_skill contract', () => {
  it('exposes a short catalog and activates only the selected system skill', async () => {
    const { work, workspace, calendarRead, photosSelect } = fixture()
    const { tools, active } = await work.createTools({
      sessionId: 'one',
      skillPreferences: { spreadsheets: true, presentations: true },
      modelName: 'custom',
      capabilities: ['calendar', 'photos'],
      signal: new AbortController().signal,
    })
    expect(active.has('load_skill')).toBe(true)
    expect(tools.load_tools).toBeUndefined()
    expect(tools.install_skill).toBeUndefined()
    expect(active.has('calendar_read')).toBe(false)
    expect(tools.load_skill.description).toContain('spreadsheets:')
    expect(tools.load_skill.description).not.toContain('docs.readSpreadsheet')
    expect(WORK_INSTRUCTIONS).not.toContain('docs.writePresentation')
    const result = await execute(tools, 'load_skill', { name: 'calendar' })
    expect(result).toHaveProperty('instructions', expect.stringContaining('calendar_read'))
    expect(active.has('calendar_read')).toBe(true)
    expect(active.has('photos_select')).toBe(false)
    expect(calendarRead).not.toHaveBeenCalled()
    expect(photosSelect).not.toHaveBeenCalled()
    expect(workspace.snapshot).not.toHaveBeenCalled()
    await execute(tools, 'calendar_read', {})
    expect(calendarRead).toHaveBeenCalledOnce()
  })

  it('loads document task instructions without exposing system schemas and validates name arguments', async () => {
    const { work } = fixture()
    const { tools, active } = await work.createTools({
      sessionId: 'one',
      skillPreferences: { spreadsheets: true, presentations: true },
      modelName: 'custom',
      capabilities: [],
      signal: new AbortController().signal,
    })
    for (const name of ['spreadsheets', 'presentations', 'websites'])
      expect(await execute(tools, 'load_skill', { name })).toHaveProperty('instructions')
    expect(await execute(tools, 'load_skill', { name: 'health' })).toHaveProperty(
      'error',
      expect.stringContaining('not enabled or available')
    )
    await expect(execute(tools, 'load_skill', { group: 'spreadsheets' })).rejects.toThrow()
    expect(active.has('calendar_read')).toBe(false)
    const output = await execute(tools, 'load_skill', { name: 'presentations' })
    expect(
      await tools.load_skill.toModelOutput?.({ toolCallId: 'load', input: { name: 'presentations' }, output })
    ).toMatchObject({ type: 'text', value: expect.stringContaining('docs.writePresentation') })
  })
})

it('uses the conversation device selection when restoring a paused request', async () => {
  const { work } = fixture()
  const preferences = { documents: true, calendar: false }
  const { tools, active } = await work.createTools(
    {
      sessionId: 'device-selected',
      modelName: 'custom',
      capabilities: ['calendar'],
      skillPreferences: preferences,
      signal: new AbortController().signal,
    },
    {},
    true
  )
  expect(tools.calendar_read).toBeDefined()
  expect(active.has('calendar_read')).toBe(true)
  expect(await execute(tools, 'load_skill', { name: 'calendar' })).not.toHaveProperty('error')
})
