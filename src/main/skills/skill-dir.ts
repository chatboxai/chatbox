import fs from 'node:fs'
import path from 'node:path'
import type { SkillSource } from '@shared/types/skills'
import { isValidScriptName } from './validation'

export function readSourceJson(skillDir: string): SkillSource | null {
  const sourcePath = path.join(skillDir, 'source.json')
  try {
    if (!fs.existsSync(sourcePath)) return null
    return JSON.parse(fs.readFileSync(sourcePath, 'utf-8')) as SkillSource
  } catch {
    return null
  }
}

export function writeSourceJson(skillDir: string, source: SkillSource): void {
  fs.writeFileSync(path.join(skillDir, 'source.json'), JSON.stringify(source, null, 2), 'utf-8')
}

// Names a skill's executable scripts (FABLE §7.6 trust UX). Only files that
// pass the same name validation execute-script enforces are listed — anything
// else in scripts/ can never run, so surfacing it would only confuse.
export function listScriptNames(skillDir: string): string[] {
  const scriptsDir = path.join(skillDir, 'scripts')
  try {
    if (!fs.existsSync(scriptsDir)) return []
    return fs
      .readdirSync(scriptsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isValidScriptName(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}
