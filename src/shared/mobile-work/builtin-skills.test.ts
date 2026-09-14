import { describe, expect, it } from 'vitest'
import { createLocalBuiltinSkillCatalog, getLocalSkillCapability } from './builtin-skills'

describe('portable built-in skill catalog', () => {
  it('lists task metadata separately from loaded runtime instructions', async () => {
    const catalog = createLocalBuiltinSkillCatalog([], { spreadsheets: true, presentations: true })
    const metadata = await catalog.list()
    expect(metadata.map((skill) => skill.name)).toEqual(['documents', 'spreadsheets', 'presentations', 'websites'])
    expect(metadata.every((skill) => Object.keys(skill).sort().join(',') === 'description,name')).toBe(true)
    expect(JSON.stringify(metadata)).not.toContain('docs.writePresentation')
    expect((await catalog.load('spreadsheets'))?.instructions).toContain('docs.readSpreadsheet')
    expect((await catalog.load('presentations'))?.instructions).toContain('docs.writePresentation')
    expect((await catalog.load('websites'))?.instructions).toContain('create_download')
    expect(await catalog.load('websites')).not.toHaveProperty('skillRoot')
  })

  it('only exposes the enabled host system capabilities', async () => {
    const catalog = createLocalBuiltinSkillCatalog(['calendar', 'photos', 'unknown-plugin'], {
      spreadsheets: true,
      presentations: true,
    })
    expect((await catalog.list()).map((skill) => skill.name)).toEqual([
      'documents',
      'spreadsheets',
      'presentations',
      'websites',
      'photos',
      'calendar',
    ])
    expect(await catalog.load('health')).toBeNull()
    expect(await catalog.load('unknown-plugin')).toBeNull()
    expect(await catalog.load('../../SKILL.md')).toBeNull()
    expect(getLocalSkillCapability('calendar')).toBe('calendar')
    expect(getLocalSkillCapability('spreadsheets')).toBeUndefined()
  })

  it('keeps instruction loading deterministic and catalog metadata isolated', async () => {
    const catalog = createLocalBuiltinSkillCatalog(['health'])
    const metadata = await catalog.list()
    metadata[0].description = 'changed by caller'
    expect((await catalog.list())[0].description).not.toBe('changed by caller')
    expect(await catalog.load('health')).toEqual(await catalog.load('health'))
    expect((await catalog.load('health'))?.instructions).toContain('explicit consent')
    expect(
      await createLocalBuiltinSkillCatalog([], { spreadsheets: true, presentations: true }).load('health')
    ).toBeNull()
  })
})

it('defaults to documents and websites and respects explicit skill overrides', async () => {
  expect((await createLocalBuiltinSkillCatalog([]).list()).map((s) => s.name)).toEqual(['documents', 'websites'])
  const preferences = { documents: false, spreadsheets: true, calendar: false }
  const catalog = createLocalBuiltinSkillCatalog(['calendar'], preferences)
  expect((await catalog.list()).map((s) => s.name)).toEqual(['spreadsheets', 'websites', 'calendar'])
  expect(await catalog.load('calendar')).not.toBeNull()
  expect(await catalog.load('presentations')).toBeNull()
})
