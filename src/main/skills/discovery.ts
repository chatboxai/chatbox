import type { SkillInfo, SkillSource } from '@shared/types/skills'
import fs from 'fs'
import path from 'path'
import { getLogger } from '../util'
import { parseSkillFile } from './parser'
import { normalizeClaudeSkillName } from './validation'

const log = getLogger('skills:discovery')

// How many directory levels under the skills root to search for a SKILL.md
// (e.g. <skillsDir>/ai/offensive-ai-security/SKILL.md is 2 levels deep).
// Bounded so a pathologically deep or cyclic directory tree can't be scanned
// forever.
const MAX_SKILL_DISCOVERY_DEPTH = 5

export function discoverSkills(skillsDir: string): SkillInfo[] {
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true })
    log.info(`Created skills directory: ${skillsDir}`)
  }

  const customSkills: SkillInfo[] = []

  // Recursively walks `dir` looking for a SKILL.md at any depth, so a skill
  // placed at <skillsDir>/<category>/<skill-name>/SKILL.md is found just like
  // one placed directly at <skillsDir>/<skill-name>/SKILL.md. Once a
  // directory is found to *be* a skill (it directly contains SKILL.md), it's
  // treated as a leaf — we don't recurse into a skill's own bundled
  // subdirectories (scripts/, references/, examples/, ...) looking for more
  // skills, since those may legitimately contain their own SKILL.md-named
  // example files.
  function scanDir(dir: string, depth: number): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      log.error(`Failed to scan skills directory: ${dir}`, error)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const entryPath = path.join(dir, entry.name)
      const skillMdPath = path.join(entryPath, 'SKILL.md')

      if (fs.existsSync(skillMdPath)) {
        const parsed = parseSkillFile(skillMdPath, entry.name)
        if (!parsed) continue

        let source: SkillSource | undefined
        const sourcePath = path.join(entryPath, 'source.json')
        try {
          if (fs.existsSync(sourcePath)) {
            source = JSON.parse(fs.readFileSync(sourcePath, 'utf-8')) as SkillSource
          }
        } catch {
          log.warn(`Failed to read source.json for skill "${entry.name}"`)
        }

        customSkills.push({
          ...parsed.metadata,
          path: entryPath,
          isBuiltin: false,
          source,
        })
        continue
      }

      // Not a skill itself — keep looking deeper.
      if (depth < MAX_SKILL_DISCOVERY_DEPTH) {
        scanDir(entryPath, depth + 1)
      } else {
        log.warn(`Skipping "${entryPath}": exceeds max skill discovery depth (${MAX_SKILL_DISCOVERY_DEPTH})`)
      }
    }
  }

  try {
    scanDir(skillsDir, 0)
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

/**
 * Discover skills from an external agent skills directory that follows the
 * "<dir>/<skill-name>/SKILL.md" layout (e.g. ~/.claude/skills or ~/.agents/skills).
 * Follows symlinks, deduplicates by realpath, normalizes names to kebab-case.
 * @param skillsDir Path to the external agent skills directory
 * @param excludeNames Names already claimed by earlier sources (earlier sources win collisions)
 * @param sourceType Source type to tag discovered skills with
 */
export function discoverExternalAgentSkills(
  skillsDir: string,
  excludeNames: Set<string>,
  sourceType: 'claude-code' | 'agents'
): SkillInfo[] {
  if (!fs.existsSync(skillsDir)) {
    return []
  }

  const agentSkills: SkillInfo[] = []
  const seenRealPaths = new Set<string>()

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(skillsDir, entry.name)

      // Use statSync to follow symlinks (entry.isDirectory() returns false for symlinks)
      let stat: fs.Stats
      try {
        stat = fs.statSync(entryPath)
      } catch {
        // Broken symlink or inaccessible — skip
        continue
      }
      if (!stat.isDirectory()) continue

      // Deduplicate by realpath (symlinked skills resolve to same target)
      let realPath: string
      try {
        realPath = fs.realpathSync(entryPath)
      } catch {
        continue
      }
      if (seenRealPaths.has(realPath)) continue
      seenRealPaths.add(realPath)

      const skillMdPath = path.join(entryPath, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      // Parse with relaxed validation — don't pass directoryName to avoid strict name matching
      const parsed = parseSkillFile(skillMdPath)
      if (!parsed) continue

      const normalizedName = normalizeClaudeSkillName(parsed.metadata.name, entry.name)
      if (!normalizedName) {
        log.warn(`Could not normalize agent skill name for "${entry.name}", skipping`)
        continue
      }

      // Earlier sources win name collisions
      if (excludeNames.has(normalizedName)) continue

      agentSkills.push({
        ...parsed.metadata,
        name: normalizedName,
        path: entryPath,
        isBuiltin: false,
        source: { type: sourceType, skillPath: realPath },
      })
    }
  } catch (error) {
    log.error(`Failed to scan agent skills directory: ${skillsDir}`, error)
  }

  // Deduplicate by normalized name (keep first occurrence)
  const seenNames = new Set<string>()
  const deduplicatedSkills: SkillInfo[] = []
  for (const skill of agentSkills) {
    if (seenNames.has(skill.name)) continue
    seenNames.add(skill.name)
    deduplicatedSkills.push(skill)
  }

  return deduplicatedSkills
}

/**
 * Discover skills from Claude Code's skills directory (~/.claude/skills/).
 * Thin wrapper over {@link discoverExternalAgentSkills} tagged as `claude-code`.
 */
export function discoverClaudeSkills(claudeSkillsDir: string, excludeNames: Set<string>): SkillInfo[] {
  return discoverExternalAgentSkills(claudeSkillsDir, excludeNames, 'claude-code')
}

/**
 * Discover skills from the shared agent skills directory (~/.agents/skills/),
 * used by codex and other agents. Tagged as `agents`.
 */
export function discoverAgentSkills(agentSkillsDir: string, excludeNames: Set<string>): SkillInfo[] {
  return discoverExternalAgentSkills(agentSkillsDir, excludeNames, 'agents')
}
