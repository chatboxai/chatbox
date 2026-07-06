import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverSkills } from '../discovery'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}))

vi.mock('../parser', () => ({
  parseSkillFile: vi.fn(),
}))

vi.mock('../../util', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

import type { Dirent } from 'fs'
import fs from 'fs'
import { parseSkillFile } from '../parser'

const mockedExistsSync = vi.mocked(fs.existsSync)
const mockedMkdirSync = vi.mocked(fs.mkdirSync)
const mockedReaddirSync = vi.mocked(fs.readdirSync)
const mockedParseSkillFile = vi.mocked(parseSkillFile)

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '/skills',
  } as Dirent
}

describe('discoverSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty list when directory is empty', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddirSync.mockReturnValue([])

    const result = discoverSkills('/skills')

    expect(result).toHaveLength(0)
  })

  it('should discover valid skills from directory', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddirSync.mockReturnValue([makeDirent('my-skill', true)] as Dirent[])
    mockedParseSkillFile.mockReturnValue({
      metadata: { name: 'my-skill', description: 'Custom skill' },
      body: 'Custom body content',
    })

    const result = discoverSkills('/skills')

    expect(result).toHaveLength(1)
    const custom = result.find((s) => s.name === 'my-skill')
    expect(custom).toBeDefined()
    expect(custom!.isBuiltin).toBe(false)
    expect(custom!.path).toBe('/skills/my-skill')
  })

  it('should skip non-directory entries', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddirSync.mockReturnValue([makeDirent('readme.md', false)] as Dirent[])

    const result = discoverSkills('/skills')

    expect(result).toHaveLength(0)
  })

  it('should skip directories without SKILL.md', () => {
    mockedExistsSync.mockImplementation((p) => {
      if (p === '/skills') return true
      return false
    })
    mockedReaddirSync.mockReturnValue([makeDirent('no-skill-md', true)] as Dirent[])

    const result = discoverSkills('/skills')

    expect(result).toHaveLength(0)
  })

  it('should handle duplicate skill names by keeping first occurrence', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddirSync.mockReturnValue([makeDirent('dup-skill', true), makeDirent('dup-skill-2', true)] as Dirent[])
    mockedParseSkillFile
      .mockReturnValueOnce({
        metadata: { name: 'dup-skill', description: 'First' },
        body: 'First body',
      })
      .mockReturnValueOnce({
        metadata: { name: 'dup-skill', description: 'Second' },
        body: 'Second body',
      })

    const result = discoverSkills('/skills')

    const customSkills = result.filter((s) => !s.isBuiltin)
    expect(customSkills).toHaveLength(1)
    expect(customSkills[0].description).toBe('First')
  })

  it('should create directory if not exists', () => {
    mockedExistsSync.mockReturnValue(false)
    mockedReaddirSync.mockReturnValue([])

    discoverSkills('/new-skills-dir')

    expect(mockedMkdirSync).toHaveBeenCalledWith('/new-skills-dir', { recursive: true })
  })

  it('should calculate bodyTokenEstimate for custom skills', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddirSync.mockReturnValue([makeDirent('my-skill', true)] as Dirent[])
    const body = 'a'.repeat(400)
    mockedParseSkillFile.mockReturnValue({
      metadata: { name: 'my-skill', description: 'desc' },
      body,
    })

    const result = discoverSkills('/skills')
    const custom = result.find((s) => s.name === 'my-skill')

    expect(custom!.bodyTokenEstimate).toBe(Math.ceil(400 / 4))
  })

  it('populates scriptNames and source for installed skills', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddirSync.mockImplementation((dirPath) => {
      if (String(dirPath).endsWith('scripts')) {
        return [makeDirent('run.sh', false), makeDirent('nested', true)] as unknown as ReturnType<typeof fs.readdirSync>
      }
      return [makeDirent('my-skill', true)] as unknown as ReturnType<typeof fs.readdirSync>
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ type: 'github', repo: 'owner/repo' }))
    mockedParseSkillFile.mockReturnValue({
      metadata: { name: 'my-skill', description: 'desc' },
      body: 'body',
    })

    const result = discoverSkills('/skills')

    expect(result).toHaveLength(1)
    expect(result[0].scriptNames).toEqual(['run.sh'])
    expect(result[0].source?.type).toBe('github')
  })

  it('leaves scriptNames empty and source undefined when absent', () => {
    mockedExistsSync.mockImplementation((p) => !String(p).endsWith('scripts') && !String(p).endsWith('source.json'))
    mockedReaddirSync.mockReturnValue([makeDirent('my-skill', true)] as Dirent[])
    mockedParseSkillFile.mockReturnValue({
      metadata: { name: 'my-skill', description: 'desc' },
      body: 'body',
    })

    const result = discoverSkills('/skills')

    expect(result[0].scriptNames).toEqual([])
    expect(result[0].source).toBeUndefined()
  })

  it('should skip skills where parser returns null', () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddirSync.mockReturnValue([makeDirent('bad-skill', true)] as Dirent[])
    mockedParseSkillFile.mockReturnValue(null)

    const result = discoverSkills('/skills')

    const customSkills = result.filter((s) => !s.isBuiltin)
    expect(customSkills).toHaveLength(0)
  })
})
