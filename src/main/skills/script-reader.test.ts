import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_SCRIPT_PREVIEW_BYTES, readSkillScript } from './script-reader'

describe('readSkillScript', () => {
  let skillsDir: string

  beforeEach(() => {
    skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'))
    fs.mkdirSync(path.join(skillsDir, 'my-skill', 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(skillsDir, 'my-skill', 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n')
  })

  afterEach(() => {
    fs.rmSync(skillsDir, { recursive: true, force: true })
  })

  it('reads a script inside the skills directory', () => {
    const result = readSkillScript(skillsDir, 'my-skill', 'run.sh')
    expect(result).toEqual({ success: true, content: '#!/bin/sh\necho hi\n', truncated: false })
  })

  it('rejects invalid skill and script names', () => {
    expect(readSkillScript(skillsDir, '../evil', 'run.sh').success).toBe(false)
    expect(readSkillScript(skillsDir, 'my-skill', '../SKILL.md').success).toBe(false)
    expect(readSkillScript(skillsDir, 'my-skill', '.hidden').success).toBe(false)
  })

  it('errors on a missing script', () => {
    const result = readSkillScript(skillsDir, 'my-skill', 'nope.sh')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('refuses a symlink that escapes the skills directory', () => {
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.sh`)
    fs.writeFileSync(outside, 'echo outside')
    try {
      fs.symlinkSync(outside, path.join(skillsDir, 'my-skill', 'scripts', 'link.sh'))
      const result = readSkillScript(skillsDir, 'my-skill', 'link.sh')
      expect(result.success).toBe(false)
      expect(result.error).toContain('escapes')
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('truncates oversized scripts', () => {
    fs.writeFileSync(path.join(skillsDir, 'my-skill', 'scripts', 'big.sh'), 'a'.repeat(MAX_SCRIPT_PREVIEW_BYTES + 10))
    const result = readSkillScript(skillsDir, 'my-skill', 'big.sh')
    expect(result.success).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.content).toHaveLength(MAX_SCRIPT_PREVIEW_BYTES)
  })
})
