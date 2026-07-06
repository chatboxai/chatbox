import type { MarketplaceSkill, SkillInfo, SkillMetadata } from '@shared/types/skills'

interface SkillScriptResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
}

interface SkillInstallResult {
  success: boolean
  skillName: string
  error?: string
  scriptNames?: string[]
}

interface SkillScriptReadResult {
  success: boolean
  content?: string
  truncated?: boolean
  error?: string
}

interface SkillUpdateResult {
  hasUpdate: boolean
  currentHash?: string
  latestHash?: string
  error?: string
}

export const skillsController = {
  discoverSkills(): Promise<SkillInfo[]> {
    return window.electronAPI.invoke('skills:discover')
  },

  loadSkill(name: string): Promise<{ metadata: SkillMetadata; body: string } | null> {
    return window.electronAPI.invoke('skills:load', name)
  },

  getSkillsDirectory(): Promise<string> {
    return window.electronAPI.invoke('skills:get-directory')
  },

  createSkill(name: string, description: string, body: string): Promise<SkillInstallResult> {
    return window.electronAPI.invoke('skills:create', { name, description, body })
  },

  async openSkillsDirectory(): Promise<void> {
    await window.electronAPI.invoke('skills:open-directory')
  },

  executeScript(skillName: string, scriptName: string, args?: string[]): Promise<SkillScriptResult> {
    return window.electronAPI.invoke('skills:execute-script', { skillName, scriptName, args })
  },

  readScript(skillName: string, scriptName: string): Promise<SkillScriptReadResult> {
    return window.electronAPI.invoke('skills:read-script', { skillName, scriptName })
  },

  installSkill(owner: string, repo: string, skillPath: string): Promise<SkillInstallResult> {
    return window.electronAPI.invoke('skills:install', { owner, repo, skillPath })
  },

  installMarketplaceSkill(skill: MarketplaceSkill): Promise<SkillInstallResult> {
    return window.electronAPI.invoke('skills:install-marketplace', skill)
  },

  deleteSkill(name: string): Promise<{ success: boolean; error?: string }> {
    return window.electronAPI.invoke('skills:delete', name)
  },

  scanRepo(owner: string, repo: string): Promise<Array<{ name: string; path: string; description?: string }>> {
    return window.electronAPI.invoke('skills:scan-repo', owner, repo)
  },

  checkForUpdate(name: string): Promise<SkillUpdateResult> {
    return window.electronAPI.invoke('skills:check-update', name)
  },

  checkForUpdatesBatch(): Promise<Record<string, { hasUpdate: boolean; error?: string }>> {
    return window.electronAPI.invoke('skills:check-updates-batch')
  },
}
