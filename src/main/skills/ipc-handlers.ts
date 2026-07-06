import type { MarketplaceSkill } from '@shared/types/skills'
import { spawn } from 'child_process'
import { app, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  parseIpcPayload,
  skillNamePayload,
  skillsCreatePayload,
  skillsExecuteScriptPayload,
  skillsInstallMarketplacePayload,
  skillsInstallPayload,
  skillsReadScriptPayload,
  skillsScanRepoPayload,
} from '../ipc-payloads'
import { getLogger } from '../util'
import { discoverSkills } from './discovery'
import { detectSkillsInRepo } from './github-fetcher'
import { checkForUpdates, deleteSkill, installSkillFromGitHub, installSkillFromMarketplace } from './installer'
import { parseSkillFile } from './parser'
import { readSkillScript } from './script-reader'
import { isValidScriptName, isValidSkillName } from './validation'

const log = getLogger('skills:ipc-handlers')
function getSkillsDir(): string {
  return path.join(app.getPath('userData'), 'skills')
}

export function registerSkillsHandlers() {
  ipcMain.handle('skills:discover', async () => {
    try {
      const skillsDir = getSkillsDir()
      return discoverSkills(skillsDir)
    } catch (error) {
      log.error('skills:discover failed', error)
      throw error
    }
  })

  ipcMain.handle('skills:load', async (_event, rawName: string) => {
    const name = parseIpcPayload('skills:load', skillNamePayload, rawName)
    try {
      if (!name) {
        return null
      }
      if (!isValidSkillName(name)) {
        return null
      }

      const skillsDir = getSkillsDir()
      if (!fs.existsSync(skillsDir)) {
        return null
      }
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) continue

        const parsed = parseSkillFile(skillMdPath, entry.name)
        if (parsed && parsed.metadata.name === name) {
          return { body: parsed.body, metadata: parsed.metadata }
        }
      }

      return null
    } catch (error) {
      log.error(`skills:load failed for name=${name}`, error)
      throw error
    }
  })

  ipcMain.handle('skills:get-directory', async () => {
    return getSkillsDir()
  })

  ipcMain.handle('skills:create', async (_event, rawParams: { name: string; description: string; body: string }) => {
    try {
      const { name, description, body } = parseIpcPayload('skills:create', skillsCreatePayload, rawParams)
      if (!isValidSkillName(name)) {
        return {
          success: false,
          skillName: name,
          error: 'Invalid name. Use lowercase letters, numbers and hyphens (max 64 chars).',
        }
      }
      const trimmedDescription = (description ?? '').trim()
      if (!trimmedDescription) {
        return { success: false, skillName: name, error: 'Description is required.' }
      }
      if (trimmedDescription.length > 1024) {
        return { success: false, skillName: name, error: 'Description must be 1024 characters or fewer.' }
      }

      const skillDir = path.join(getSkillsDir(), name)
      if (fs.existsSync(skillDir)) {
        return { success: false, skillName: name, error: 'A skill with this name already exists.' }
      }
      fs.mkdirSync(skillDir, { recursive: true })
      // name is validated kebab-case; description is double-quoted + escaped for YAML safety.
      const yamlDescription = `"${trimmedDescription.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      const content = `---\nname: ${name}\ndescription: ${yamlDescription}\n---\n\n${(body ?? '').trim()}\n`
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
      return { success: true, skillName: name }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('skills:create failed', error)
      const fallbackName = typeof rawParams?.name === 'string' ? rawParams.name : ''
      return { success: false, skillName: fallbackName, error: msg }
    }
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
      let skillName = ''
      let scriptName = ''
      try {
        const parsed = parseIpcPayload('skills:execute-script', skillsExecuteScriptPayload, params)
        skillName = parsed.skillName
        scriptName = parsed.scriptName
        const args = parsed.args ?? []

        if (!skillName || !scriptName) {
          throw new Error('Skill name and script name are required')
        }

        // Strict allowlist validation (defense in depth on top of the realpath
        // prefix check below): skill names are lowercase-kebab; script names may
        // carry an extension but cannot be hidden files, contain separators, or
        // traverse with `..`.
        if (!isValidSkillName(skillName)) {
          throw new Error('Invalid skill name')
        }

        if (!isValidScriptName(scriptName)) {
          throw new Error('Invalid script name')
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
          const KILL_GRACE_MS = 3_000
          let stdout = ''
          let stderr = ''
          let settled = false
          let timedOut = false
          let timeoutTimer: NodeJS.Timeout | undefined
          let killTimer: NodeJS.Timeout | undefined

          const clearTimers = () => {
            if (timeoutTimer) clearTimeout(timeoutTimer)
            if (killTimer) clearTimeout(killTimer)
            timeoutTimer = undefined
            killTimer = undefined
          }

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
            clearTimers()
            resolve(result)
          }

          const child = spawn(resolvedScriptPath, args, {
            cwd: scriptDir,
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

          // Resolve only on the real process exit ('close' fires after the child's
          // stdio streams have flushed) so a killed child's streams are never
          // abandoned mid-write.
          child.on('close', (code, signal) => {
            if (timedOut) {
              resolveOnce({ success: false, stdout, stderr: stderr || 'Script timed out (30s)', exitCode: null })
            } else if (signal) {
              resolveOnce({ success: false, stdout, stderr: stderr || `Script terminated (${signal})`, exitCode: null })
            } else {
              resolveOnce({ success: code === 0, stdout, stderr, exitCode: code })
            }
          })

          timeoutTimer = setTimeout(() => {
            if (settled || child.killed) {
              return
            }
            timedOut = true
            child.kill('SIGTERM')
            // Escalate to SIGKILL if the child ignores SIGTERM. Resolution still
            // happens on 'close', so output collected so far isn't lost and the
            // child is guaranteed to be reaped.
            killTimer = setTimeout(() => {
              if (!settled) {
                child.kill('SIGKILL')
              }
            }, KILL_GRACE_MS)
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

  ipcMain.handle('skills:read-script', (_event, rawParams: { skillName: string; scriptName: string }) => {
    try {
      const { skillName, scriptName } = parseIpcPayload('skills:read-script', skillsReadScriptPayload, rawParams)
      return readSkillScript(getSkillsDir(), skillName, scriptName)
    } catch (error) {
      log.error('skills:read-script failed', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('skills:scan-repo', async (_event, rawOwner: string, rawRepo: string) => {
    const [owner, repo] = parseIpcPayload('skills:scan-repo', skillsScanRepoPayload, [rawOwner, rawRepo])
    try {
      return await detectSkillsInRepo(owner, repo)
    } catch (error) {
      log.error(`skills:scan-repo failed for ${owner}/${repo}`, error)
      throw error
    }
  })

  ipcMain.handle('skills:install', async (_event, rawParams: { owner: string; repo: string; skillPath: string }) => {
    try {
      const params = parseIpcPayload('skills:install', skillsInstallPayload, rawParams)
      return await installSkillFromGitHub(params.owner, params.repo, params.skillPath)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('skills:install failed', error)
      return { success: false, skillName: '', error: msg }
    }
  })

  ipcMain.handle('skills:install-marketplace', async (_event, rawSkill: MarketplaceSkill) => {
    try {
      const skill = parseIpcPayload('skills:install-marketplace', skillsInstallMarketplacePayload, rawSkill)
      return await installSkillFromMarketplace(skill)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('skills:install-marketplace failed', error)
      const fallbackName = typeof rawSkill?.name === 'string' ? rawSkill.name : ''
      return { success: false, skillName: fallbackName, error: msg }
    }
  })

  ipcMain.handle('skills:delete', async (_event, rawSkillName: string) => {
    try {
      const skillName = parseIpcPayload('skills:delete', skillNamePayload, rawSkillName)
      return await deleteSkill(skillName)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`skills:delete failed for "${String(rawSkillName)}"`, error)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('skills:check-update', async (_event, rawSkillName: string) => {
    try {
      const skillName = parseIpcPayload('skills:check-update', skillNamePayload, rawSkillName)
      return await checkForUpdates(skillName)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`skills:check-update failed for "${String(rawSkillName)}"`, error)
      return { hasUpdate: false, error: msg }
    }
  })

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
