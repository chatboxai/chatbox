import type { MarketplaceSkill, SkillSource } from '@shared/types/skills'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getLogger } from '../util'
import { type DetectedSkill, detectSkillsInRepo, downloadSkillFiles, getLatestCommitHash } from './github-fetcher'
import { parseSkillFile } from './parser'
import { listScriptNames, readSourceJson, writeSourceJson } from './skill-dir'
import { isValidSkillName } from './validation'

const log = getLogger('skills:installer')

function getSkillsDir(): string {
  return path.join(app.getPath('userData'), 'skills')
}

interface InstallResult {
  success: boolean
  skillName: string
  error?: string
  /** Present on success: executable scripts the installed skill ships (FABLE §7.6 trust UX). */
  scriptNames?: string[]
}

interface DeleteResult {
  success: boolean
  error?: string
}

interface UpdateCheckResult {
  hasUpdate: boolean
  currentHash?: string
  latestHash?: string
  error?: string
}

function resolveSkillDir(skillName: string): string | null {
  const skillsDir = path.resolve(getSkillsDir())
  const skillDir = path.resolve(skillsDir, skillName)
  if (!skillDir.startsWith(`${skillsDir}${path.sep}`)) {
    return null
  }
  return skillDir
}

function parseGitHubUrl(source: string): { owner: string; repo: string } | null {
  const trimmed = source.trim()
  const githubMatch = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:[/?#]|$)/i)
  if (githubMatch) {
    return { owner: githubMatch[1], repo: githubMatch[2] }
  }

  const repoMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:[/?#]|$)/)
  if (repoMatch) {
    return { owner: repoMatch[1], repo: repoMatch[2] }
  }

  return null
}

export async function installSkillFromGitHub(owner: string, repo: string, skillPath: string): Promise<InstallResult> {
  try {
    const skillsDir = getSkillsDir()
    fs.mkdirSync(skillsDir, { recursive: true })

    const tempDir = path.join(skillsDir, `.tmp-${Date.now()}`)

    try {
      await downloadSkillFiles(owner, repo, skillPath, tempDir)

      const skillMdPath = path.join(tempDir, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) {
        return {
          success: false,
          skillName: '',
          error: 'No SKILL.md found in the specified path',
        }
      }

      const parsed = parseSkillFile(skillMdPath)
      if (!parsed) {
        return {
          success: false,
          skillName: '',
          error: 'Invalid SKILL.md: missing required fields (name, description)',
        }
      }

      const skillName = parsed.metadata.name
      const targetDir = path.join(skillsDir, skillName)
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true })
      }
      fs.renameSync(tempDir, targetDir)

      const commitHash = await getLatestCommitHash(owner, repo, skillPath)
      const source: SkillSource = {
        type: 'github',
        repo: `${owner}/${repo}`,
        skillPath: skillPath || undefined,
        commitHash: commitHash || undefined,
        installedAt: new Date().toISOString(),
      }
      writeSourceJson(targetDir, source)

      log.info(`Installed skill "${skillName}" from ${owner}/${repo}`)
      return { success: true, skillName, scriptNames: listScriptNames(targetDir) }
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error(`Failed to install skill from ${owner}/${repo}`, error)
    return { success: false, skillName: '', error: message }
  }
}

function resolveSkillPath(detected: DetectedSkill[], targetNames: string[]): string {
  if (detected.length === 0) return ''

  for (const targetName of targetNames) {
    const exact = detected.find((s) => s.name === targetName)
    if (exact) return exact.path
  }

  for (const targetName of targetNames) {
    const lowerTarget = targetName.toLowerCase()
    const caseMatch = detected.find((s) => s.name.toLowerCase() === lowerTarget)
    if (caseMatch) return caseMatch.path
  }

  for (const targetName of targetNames) {
    const lowerTarget = targetName.toLowerCase()
    const dirMatch = detected.find((s) => {
      const dirName = s.path.split('/').pop() || ''
      return dirName === targetName || dirName.toLowerCase() === lowerTarget
    })
    if (dirMatch) return dirMatch.path
  }

  const tokenize = (value: string): string[] =>
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  const similarity = (left: string, right: string): number => {
    const leftTokens = tokenize(left)
    const rightTokens = tokenize(right)
    if (leftTokens.length === 0 || rightTokens.length === 0) return 0
    const rightSet = new Set(rightTokens)
    const overlap = leftTokens.filter((token) => rightSet.has(token)).length
    return overlap / Math.max(leftTokens.length, rightTokens.length)
  }

  let bestMatch: { path: string; score: number } | null = null
  for (const detectedSkill of detected) {
    const dirName = detectedSkill.path.split('/').pop() || ''
    for (const targetName of targetNames) {
      const score = Math.max(similarity(targetName, detectedSkill.name), similarity(targetName, dirName))
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { path: detectedSkill.path, score }
      }
    }
  }

  if (bestMatch && bestMatch.score >= 0.6) {
    return bestMatch.path
  }

  if (detected.length === 1) return detected[0].path

  return ''
}

function getMarketplaceSkillCandidates(skill: MarketplaceSkill): string[] {
  const fromId = skill.id.split('/').pop() || ''
  return Array.from(new Set([skill.name, skill.skillId, fromId].filter((value) => value.trim().length > 0)))
}

function getFallbackCandidatePaths(names: string[]): string[] {
  const paths = names.flatMap((name) => [`skills/${name}`, `.claude/skills/${name}`, name])
  return Array.from(new Set(paths))
}

export async function installSkillFromMarketplace(marketplaceSkill: MarketplaceSkill): Promise<InstallResult> {
  try {
    const parsed = parseGitHubUrl(marketplaceSkill.source)
    if (!parsed) {
      return {
        success: false,
        skillName: marketplaceSkill.name,
        error: `Invalid source URL: ${marketplaceSkill.source}`,
      }
    }

    const detected = await detectSkillsInRepo(parsed.owner, parsed.repo)
    const skillCandidates = getMarketplaceSkillCandidates(marketplaceSkill)
    const resolvedPath = resolveSkillPath(detected, skillCandidates)
    const candidatePaths = Array.from(
      new Set([resolvedPath, ...getFallbackCandidatePaths(skillCandidates)].filter(Boolean))
    )
    candidatePaths.push('')

    let lastResult: InstallResult = {
      success: false,
      skillName: marketplaceSkill.name,
      error: 'No SKILL.md found in the specified path',
    }

    for (const candidatePath of candidatePaths) {
      const result = await installSkillFromGitHub(parsed.owner, parsed.repo, candidatePath)
      if (result.success) {
        const skillDir = path.join(getSkillsDir(), result.skillName)
        const source = readSourceJson(skillDir)
        if (source) {
          source.type = 'marketplace'
          writeSourceJson(skillDir, source)
        }
        return result
      }

      lastResult = result
      if (!result.error?.includes('No SKILL.md found')) {
        return result
      }
    }

    return lastResult
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error(`Failed to install marketplace skill "${marketplaceSkill.name}"`, error)
    return { success: false, skillName: marketplaceSkill.name, error: message }
  }
}

export async function deleteSkill(skillName: string): Promise<DeleteResult> {
  try {
    if (!skillName || typeof skillName !== 'string' || !isValidSkillName(skillName)) {
      return { success: false, error: 'Invalid skill name' }
    }

    const skillDir = resolveSkillDir(skillName)
    if (!skillDir) {
      return { success: false, error: 'Invalid skill name' }
    }

    if (!fs.existsSync(skillDir)) {
      return { success: false, error: `Skill "${skillName}" not found` }
    }

    fs.rmSync(skillDir, { recursive: true, force: true })
    log.info(`Deleted skill "${skillName}"`)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error(`Failed to delete skill "${skillName}"`, error)
    return { success: false, error: message }
  }
}

export async function checkForUpdates(skillName: string): Promise<UpdateCheckResult> {
  try {
    if (!skillName || !isValidSkillName(skillName)) {
      return { hasUpdate: false, error: 'Invalid skill name' }
    }

    const skillDir = resolveSkillDir(skillName)
    if (!skillDir) {
      return { hasUpdate: false, error: 'Invalid skill name' }
    }

    const source = readSourceJson(skillDir)

    if (!source) {
      return { hasUpdate: false, error: 'No source.json found for this skill' }
    }

    if (!source.repo) {
      return { hasUpdate: false, error: 'Skill has no repository information' }
    }

    const parsed = parseGitHubUrl(source.repo)
    if (!parsed) {
      return { hasUpdate: false, error: `Invalid repo format: ${source.repo}` }
    }

    const latestHash = await getLatestCommitHash(parsed.owner, parsed.repo, source.skillPath || '')
    if (!latestHash) {
      return { hasUpdate: false, error: 'Could not fetch latest commit hash' }
    }

    const currentHash = source.commitHash
    return {
      hasUpdate: !!currentHash && currentHash !== latestHash,
      currentHash: currentHash || undefined,
      latestHash,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error(`Failed to check updates for "${skillName}"`, error)
    return { hasUpdate: false, error: message }
  }
}
