import type { MarketplaceSkill, SkillInfo, SkillMetadata } from '@shared/types/skills'
import type { UserExecApprovalSource } from '@shared/types/user-exec'

interface SkillScriptResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  cancelled?: boolean
  cwd?: string
  outputFile?: string
}

interface SkillInstallResult {
  success: boolean
  skillName: string
  error?: string
}

interface SkillUpdateResult {
  hasUpdate: boolean
  currentHash?: string
  latestHash?: string
  error?: string
}

const skillsChangeListeners = new Set<() => void>()

export function notifySkillsChanged(): void {
  for (const listener of skillsChangeListeners) {
    listener()
  }
}

export function subscribeSkillsChanged(listener: () => void): () => void {
  skillsChangeListeners.add(listener)
  return () => {
    skillsChangeListeners.delete(listener)
  }
}

export const skillsController = {
  discoverSkills(): Promise<SkillInfo[]> {
    return window.electronAPI.invoke('skills:discover')
  },

  loadSkill(
    name: string
  ): Promise<{ metadata: SkillMetadata; body: string; skillRoot?: string; files?: string[] } | null> {
    return window.electronAPI.invoke('skills:load', name)
  },

  getSkillsDirectory(): Promise<string> {
    return window.electronAPI.invoke('skills:get-directory')
  },

  async openSkillsDirectory(): Promise<void> {
    await window.electronAPI.invoke('skills:open-directory')
  },

  executeScript(skillName: string, scriptName: string, args?: string[]): Promise<SkillScriptResult> {
    return window.electronAPI.invoke('skills:execute-script', { skillName, scriptName, args })
  },

  async installSkill(owner: string, repo: string, skillPath: string): Promise<SkillInstallResult> {
    const result = await window.electronAPI.invoke('skills:install', { owner, repo, skillPath })
    if (result.success) notifySkillsChanged()
    return result
  },

  async installFromSandbox(sandboxPath: string, sessionId?: string, sourceInfo?: string): Promise<SkillInstallResult> {
    const result = await window.electronAPI.invoke('skills:install-from-sandbox', {
      sandboxPath,
      sessionId,
      sourceInfo,
    })
    if (result.success) notifySkillsChanged()
    return result
  },

  userExec(
    command: string,
    options?: {
      cwd?: string
      timeout?: number
      sessionId?: string
      toolCallId?: string
      approvalSource?: UserExecApprovalSource
      retryOf?: string
      shell?: 'bash' | 'powershell'
      baseCwd?: string
      injectBundledNode?: boolean
    }
  ): Promise<SkillScriptResult> {
    return window.electronAPI.invoke('skills:user-exec', { command, ...options })
  },

  resolveUserExecCwd(options: { cwd?: string; baseCwd?: string }): Promise<string> {
    return window.electronAPI.invoke('skills:resolve-user-exec-cwd', options)
  },

  resolveCommandRetry(options: {
    sessionId: string
    retryOf?: string
    command: string
    cwd: string
    shell: 'bash' | 'powershell'
  }): Promise<{ valid: true; retryOf: string } | { valid: false; error: string }> {
    return window.electronAPI.invoke('skills:resolve-command-retry', options)
  },

  cancelUserExec(options: { sessionId?: string; toolCallId: string }): Promise<{ killed: boolean }> {
    return window.electronAPI.invoke('skills:user-exec-cancel', options)
  },

  async installMarketplaceSkill(skill: MarketplaceSkill): Promise<SkillInstallResult> {
    const result = await window.electronAPI.invoke('skills:install-marketplace', skill)
    if (result.success) notifySkillsChanged()
    return result
  },

  async deleteSkill(name: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI.invoke('skills:delete', name)
    if (result.success) notifySkillsChanged()
    return result
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

  /** 触发后端内置 skill 同步（main 进程拉取 manifest 并按内容 hash 更新本地快照）。 */
  async syncBuiltinSkills(lang?: string): Promise<{ changed: boolean }> {
    const result = await window.electronAPI.invoke('skills:sync-builtin', lang)
    if (result?.changed) notifySkillsChanged()
    return result ?? { changed: false }
  },
}

// 监听 main 进程后台同步内置 skill 完成（有更新）的推送，刷新 renderer 侧 skill 列表与工具缓存
if (typeof window !== 'undefined' && window.electronAPI?.onSkillsBuiltinUpdated) {
  window.electronAPI.onSkillsBuiltinUpdated(() => notifySkillsChanged())
}
