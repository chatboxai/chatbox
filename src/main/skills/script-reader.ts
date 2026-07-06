import fs from 'node:fs'
import path from 'node:path'
import { isValidScriptName, isValidSkillName } from './validation'

// Preview cap: enough for any sane script, bounded against a hostile huge file.
export const MAX_SCRIPT_PREVIEW_BYTES = 128 * 1024

export interface ScriptReadResult {
  success: boolean
  content?: string
  truncated?: boolean
  error?: string
}

// Read-only counterpart of skills:execute-script with the same defenses
// (strict name allowlists + realpath containment), used by the enable-time
// script review UI (FABLE §7.6).
export function readSkillScript(skillsDir: string, skillName: string, scriptName: string): ScriptReadResult {
  if (!isValidSkillName(skillName)) {
    return { success: false, error: 'Invalid skill name' }
  }
  if (!isValidScriptName(scriptName)) {
    return { success: false, error: 'Invalid script name' }
  }

  const scriptPath = path.join(skillsDir, skillName, 'scripts', scriptName)
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `Script not found: ${scriptName}` }
  }

  const resolvedSkillsDir = fs.realpathSync(skillsDir)
  const resolvedScriptPath = fs.realpathSync(scriptPath)
  if (!resolvedScriptPath.startsWith(`${resolvedSkillsDir}${path.sep}`)) {
    return { success: false, error: 'Script path escapes skills directory' }
  }

  const stat = fs.statSync(resolvedScriptPath)
  if (!stat.isFile()) {
    return { success: false, error: 'Script is not a regular file' }
  }

  const fd = fs.openSync(resolvedScriptPath, 'r')
  try {
    const size = Math.min(stat.size, MAX_SCRIPT_PREVIEW_BYTES)
    const buffer = new Uint8Array(size)
    const bytesRead = fs.readSync(fd, buffer, 0, size, 0)
    return {
      success: true,
      content: Buffer.from(buffer.subarray(0, bytesRead)).toString('utf-8'),
      truncated: stat.size > MAX_SCRIPT_PREVIEW_BYTES,
    }
  } finally {
    fs.closeSync(fd)
  }
}
