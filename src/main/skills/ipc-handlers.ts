import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MarketplaceSkill } from '@shared/types/skills'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { resolveFailedCommandRetry } from '../command-execution-policy'
import { getLoginShellPath } from '../sandbox/login-shell-env'
import { getLogger } from '../util'
import { discoverBuiltinSkills, ensureBuiltinSeeded, syncBuiltinSkills } from './builtin-sync'
import { discoverAgentSkills, discoverClaudeSkills, discoverSkills } from './discovery'
import { detectSkillsInRepo } from './github-fetcher'
import {
  checkForUpdates,
  deleteSkill,
  installSkillFromGitHub,
  installSkillFromMarketplace,
  installSkillFromSandbox,
} from './installer'
import { parseSkillFile } from './parser'
import { collectSkillFiles, MAX_SKILL_FILES } from './skill-files'
import {
  cancelUserExecCommand,
  createDefaultUserExecRunner,
  resolveUserExecCwd,
  type UserExecParams,
} from './user-exec-runner'
import { isValidSkillName } from './validation'

const log = getLogger('skills:ipc-handlers')

const userExecRunner = createDefaultUserExecRunner()

function getSkillsDir(): string {
  return path.join(app.getPath('userData'), 'skills')
}

function getClaudeSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills')
}

function getAgentSkillsDir(): string {
  return path.join(os.homedir(), '.agents', 'skills')
}

// Module-level name→path cache for fast skill loading
let skillPathCache: Map<string, string> | null = null

function invalidateSkillCache(): void {
  skillPathCache = null
}

function broadcastBuiltinUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('skills:builtin-updated')
  }
}

function buildSkillCache(): Map<string, string> {
  const builtinSkillInfos = discoverBuiltinSkills()
  const chatboxSkills = discoverSkills(getSkillsDir())
  const claimedNames = new Set([...builtinSkillInfos.map((s) => s.name), ...chatboxSkills.map((s) => s.name)])
  const claudeSkills = discoverClaudeSkills(getClaudeSkillsDir(), claimedNames)
  for (const s of claudeSkills) claimedNames.add(s.name)
  const agentSkills = discoverAgentSkills(getAgentSkillsDir(), claimedNames)
  const allSkills = [...builtinSkillInfos, ...chatboxSkills, ...claudeSkills, ...agentSkills]
  skillPathCache = new Map(allSkills.map((s) => [s.name, s.path]))
  return skillPathCache
}

function getOrBuildSkillCache(): Map<string, string> {
  return skillPathCache ?? buildSkillCache()
}

export function registerSkillsHandlers() {
  // Warm the login-shell PATH probe at startup so user_exec's non-blocking read
  // (getLoginShellPathIfReady) is settled well before the first approved command.
  void getLoginShellPath()
  // 确保打包种子已落地，保证内置 skill 立即可用（含离线）
  ensureBuiltinSeeded()
  // 后台静默从后端同步内置 skill，有更新则覆盖快照并通知 renderer 刷新
  syncBuiltinSkills()
    .then((changed) => {
      if (changed) {
        invalidateSkillCache()
        broadcastBuiltinUpdated()
      }
    })
    .catch((error) => log.warn('initial builtin skills sync failed', error))

  ipcMain.handle('skills:sync-builtin', async (_event, lang?: string) => {
    try {
      const changed = await syncBuiltinSkills(lang)
      if (changed) invalidateSkillCache()
      return { changed }
    } catch (error) {
      log.error('skills:sync-builtin failed', error)
      return { changed: false }
    }
  })

  ipcMain.handle('skills:discover', () => {
    try {
      const builtinSkillInfos = discoverBuiltinSkills()
      const chatboxSkills = discoverSkills(getSkillsDir())
      const claimedNames = new Set([...builtinSkillInfos.map((s) => s.name), ...chatboxSkills.map((s) => s.name)])
      const claudeSkills = discoverClaudeSkills(getClaudeSkillsDir(), claimedNames)
      for (const s of claudeSkills) claimedNames.add(s.name)
      const agentSkills = discoverAgentSkills(getAgentSkillsDir(), claimedNames)
      const allSkills = [...builtinSkillInfos, ...chatboxSkills, ...claudeSkills, ...agentSkills]
      // Rebuild cache as a side effect of discovery
      skillPathCache = new Map(allSkills.map((s) => [s.name, s.path]))
      return allSkills
    } catch (error) {
      log.error('skills:discover failed', error)
      throw error
    }
  })

  ipcMain.handle('skills:load', (_event, name: string) => {
    try {
      if (!name || typeof name !== 'string') return null
      if (!isValidSkillName(name)) return null

      const loadFromPath = (skillPath: string) => {
        const skillMdPath = path.join(skillPath, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) return null
        const parsed = parseSkillFile(skillMdPath)
        if (!parsed) return null
        const { files, truncated } = collectSkillFiles(skillPath)
        if (truncated) {
          log.warn(`skills:load: file list for "${name}" truncated to ${MAX_SKILL_FILES} entries`)
        }
        return { body: parsed.body, metadata: parsed.metadata, skillRoot: skillPath, files }
      }

      const cache = getOrBuildSkillCache()
      const skillPath = cache.get(name)
      if (!skillPath) return null

      const result = loadFromPath(skillPath)
      if (result) return result

      // Stale cache — invalidate and retry once
      invalidateSkillCache()
      const retryCache = getOrBuildSkillCache()
      const retryPath = retryCache.get(name)
      if (!retryPath) return null
      return loadFromPath(retryPath)
    } catch (error) {
      log.error(`skills:load failed for name=${name}`, error)
      throw error
    }
  })

  ipcMain.handle('skills:get-directory', () => {
    return getSkillsDir()
  })

  ipcMain.handle('skills:open-directory', async () => {
    try {
      const skillsDir = getSkillsDir()
      if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true })
      }
      await shell.openPath(skillsDir)
      return { success: true }
    } catch (error) {
      log.error('skills:open-directory failed', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle(
    'skills:execute-script',
    async (
      _event,
      params: { skillName: string; scriptName: string; args?: string[] }
    ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> => {
      const { skillName, scriptName, args = [] } = params

      try {
        if (!skillName || !scriptName) {
          throw new Error('Skill name and script name are required')
        }

        if (skillName.includes('..') || skillName.includes('/') || skillName.includes('\\')) {
          throw new Error('Invalid skill name: path traversal not allowed')
        }

        if (scriptName.includes('..') || scriptName.includes('/') || scriptName.includes('\\')) {
          throw new Error('Invalid script name: path traversal not allowed')
        }

        const skillsDir = getSkillsDir()
        const scriptPath = path.join(skillsDir, skillName, 'scripts', scriptName)
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Script not found: ${scriptName}`)
        }
        const resolvedSkillsDir = fs.realpathSync(skillsDir)
        const resolvedScriptPath = fs.realpathSync(scriptPath)
        if (!resolvedScriptPath.startsWith(`${resolvedSkillsDir}${path.sep}`)) {
          throw new Error('Script path escapes skills directory')
        }

        const scriptDir = path.dirname(resolvedScriptPath)

        return await new Promise((resolve) => {
          const TIMEOUT_MS = 30_000
          let stdout = ''
          let stderr = ''
          let settled = false

          const resolveOnce = (result: {
            success: boolean
            stdout: string
            stderr: string
            exitCode: number | null
          }) => {
            if (settled) {
              return
            }
            settled = true
            resolve(result)
          }

          const child = spawn(resolvedScriptPath, args, {
            cwd: scriptDir,
            timeout: TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              LANG: process.env.LANG,
              TERM: process.env.TERM,
              SKILL_DIR: path.join(skillsDir, skillName),
            },
          })

          const MAX_OUTPUT_BYTES = 1024 * 1024 // 1MB
          child.stdout.on('data', (data: Buffer) => {
            if (stdout.length < MAX_OUTPUT_BYTES) stdout += data.toString()
          })

          child.stderr.on('data', (data: Buffer) => {
            if (stderr.length < MAX_OUTPUT_BYTES) stderr += data.toString()
          })

          child.on('error', (error) => {
            log.error(`skills:execute-script spawn error for ${skillName}/${scriptName}`, error)
            resolveOnce({ success: false, stdout, stderr: stderr || error.message, exitCode: null })
          })

          child.on('close', (code, signal) => {
            if (signal === 'SIGTERM') {
              resolveOnce({ success: false, stdout, stderr: stderr || 'Script timed out', exitCode: null })
            } else {
              resolveOnce({ success: code === 0, stdout, stderr, exitCode: code })
            }
          })

          setTimeout(() => {
            if (settled) {
              return
            }
            if (!child.killed) {
              child.kill('SIGTERM')
              resolveOnce({ success: false, stdout, stderr: stderr || 'Script timed out (30s)', exitCode: null })
            }
          }, TIMEOUT_MS)
        })
      } catch (error) {
        log.error(`skills:execute-script failed for ${skillName}/${scriptName}`, error)
        return {
          success: false,
          stdout: '',
          stderr: error instanceof Error ? error.message : 'Unknown error',
          exitCode: null,
        }
      }
    }
  )

  ipcMain.handle('skills:scan-repo', async (_event, owner: string, repo: string) => {
    try {
      return await detectSkillsInRepo(owner, repo)
    } catch (error) {
      log.error(`skills:scan-repo failed for ${owner}/${repo}`, error)
      throw error
    }
  })

  ipcMain.handle('skills:install', async (_event, params: { owner: string; repo: string; skillPath: string }) => {
    try {
      const result = await installSkillFromGitHub(params.owner, params.repo, params.skillPath)
      if (result.success) invalidateSkillCache()
      return result
    } catch (error) {
      log.error('skills:install failed', error)
      throw error
    }
  })

  ipcMain.handle('skills:install-marketplace', async (_event, skill: MarketplaceSkill) => {
    try {
      const result = await installSkillFromMarketplace(skill)
      if (result.success) invalidateSkillCache()
      return result
    } catch (error) {
      log.error('skills:install-marketplace failed', error)
      throw error
    }
  })

  ipcMain.handle(
    'skills:install-from-sandbox',
    async (_event, params: { sandboxPath: string; sessionId?: string; sourceInfo?: string }) => {
      try {
        const result = await installSkillFromSandbox(params.sandboxPath, params.sessionId, params.sourceInfo)
        if (result.success) invalidateSkillCache()
        return result
      } catch (error) {
        log.error('skills:install-from-sandbox failed', error)
        throw error
      }
    }
  )

  ipcMain.handle('skills:delete', async (_event, skillName: string) => {
    try {
      const result = await deleteSkill(skillName)
      if (result.success) invalidateSkillCache()
      return result
    } catch (error) {
      log.error(`skills:delete failed for "${skillName}"`, error)
      throw error
    }
  })

  ipcMain.handle('skills:check-update', async (_event, skillName: string) => {
    try {
      return await checkForUpdates(skillName)
    } catch (error) {
      log.error(`skills:check-update failed for "${skillName}"`, error)
      throw error
    }
  })

  ipcMain.handle('skills:user-exec', (_event, params: UserExecParams) => userExecRunner.run(params))
  ipcMain.handle('skills:resolve-user-exec-cwd', (_event, params: Pick<UserExecParams, 'cwd' | 'baseCwd'>) =>
    resolveUserExecCwd(params)
  )
  ipcMain.handle(
    'skills:resolve-command-retry',
    (
      _event,
      params: { sessionId: string; retryOf?: string; command: string; cwd: string; shell: 'bash' | 'powershell' }
    ) => resolveFailedCommandRetry(params)
  )
  ipcMain.handle('skills:user-exec-cancel', (_event, params: Pick<UserExecParams, 'sessionId' | 'toolCallId'>) =>
    cancelUserExecCommand(params)
  )

  ipcMain.handle('skills:check-updates-batch', async () => {
    try {
      const skillsDir = getSkillsDir()
      const results: Record<string, { hasUpdate: boolean; error?: string }> = {}

      if (!fs.existsSync(skillsDir)) return results

      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const sourcePath = path.join(skillsDir, entry.name, 'source.json')
        if (!fs.existsSync(sourcePath)) continue

        const result = await checkForUpdates(entry.name)
        results[entry.name] = { hasUpdate: result.hasUpdate, error: result.error }
      }

      return results
    } catch (error) {
      log.error('skills:check-updates-batch failed', error)
      throw error
    }
  })
}
