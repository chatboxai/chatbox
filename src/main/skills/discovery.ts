import type { SkillInfo } from '@shared/types/skills'
import fs from 'fs'
import path from 'path'
import { getLogger } from '../util'
import { parseSkillFile } from './parser'
import { listScriptNames, readSourceJson } from './skill-dir'

const log = getLogger('skills:discovery')

export function discoverSkills(skillsDir: string): SkillInfo[] {
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true })
    log.info(`Created skills directory: ${skillsDir}`)
  }

  const customSkills: SkillInfo[] = []

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      const parsed = parseSkillFile(skillMdPath, entry.name)
      if (!parsed) continue

      const bodyTokenEstimate = Math.ceil(parsed.body.length / 4)

      const skillDir = path.join(skillsDir, entry.name)
      customSkills.push({
        ...parsed.metadata,
        path: skillDir,
        isBuiltin: false,
        bodyTokenEstimate,
        scriptNames: listScriptNames(skillDir),
        source: readSourceJson(skillDir) ?? undefined,
      })
    }
  } catch (error) {
    log.error(`Failed to scan skills directory: ${skillsDir}`, error)
  }

  const seenNames = new Set<string>()
  const deduplicatedSkills: SkillInfo[] = []
  for (const skill of customSkills) {
    if (seenNames.has(skill.name)) {
      log.warn(`Duplicate skill name "${skill.name}" found, keeping first occurrence`)
      continue
    }
    seenNames.add(skill.name)
    deduplicatedSkills.push(skill)
  }

  return deduplicatedSkills
}
