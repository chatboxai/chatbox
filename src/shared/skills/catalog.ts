import type { SkillMetadata } from '../types/skills'

export interface LoadedSkill {
  instructions: string
  skillRoot?: string
  files?: string[]
}

/** Catalogs expose metadata separately from instructions, regardless of the host's skill storage. */
export interface SkillCatalog {
  list(): Promise<readonly SkillMetadata[]>
  load(name: string): Promise<LoadedSkill | null>
}

export function formatLoadSkillOutput(output: unknown): string {
  const record =
    output !== null && typeof output === 'object' && !Array.isArray(output) ? (output as Record<string, unknown>) : null
  const stringField = (key: string) => (typeof record?.[key] === 'string' ? (record[key] as string) : undefined)
  const error = stringField('error')
  if (error) return `Error: ${error}`
  const instructions = stringField('instructions') ?? JSON.stringify(output) ?? String(output)
  const skillRoot = stringField('skillRoot')
  const filesValue = record?.files
  const files = Array.isArray(filesValue) ? filesValue.filter((file): file is string => typeof file === 'string') : []
  const sections = [instructions]
  if (skillRoot)
    sections.push(`Skill root: ${skillRoot}\nReplace <SKILL_ROOT> with this absolute path when using referenced files.`)
  if (files.length > 0) sections.push(`Available skill files:\n${files.map((file) => `- ${file}`).join('\n')}`)
  return sections.join('\n\n')
}
