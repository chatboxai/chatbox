import { z } from 'zod'

// FABLE_REVIEW §6.2: the preload allowlist controls WHICH channels are
// callable; these schemas control WHAT a (possibly compromised) renderer can
// send on the high-value ones (process spawn, script execution, sandbox FS).
// This layer guarantees shape and primitive types only — domain rules
// (kebab-case skill names, realpath containment, approval fingerprints) stay
// in the handlers behind it.

export function parseIpcPayload<S extends z.ZodType>(channel: string, schema: S, payload: unknown): z.output<S> {
  const result = schema.safeParse(payload)
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`Invalid payload for ${channel}: ${detail}`)
  }
  return result.data
}

// ── skills ──────────────────────────────────────────────────────────────────

export const skillNamePayload = z.string()

export const skillsCreatePayload = z.object({
  name: z.string(),
  description: z.string().nullish(),
  body: z.string().nullish(),
})

export const skillsExecuteScriptPayload = z.object({
  skillName: z.string(),
  scriptName: z.string(),
  args: z.array(z.string()).optional(),
})

export const skillsScanRepoPayload = z.tuple([z.string(), z.string()])

export const skillsReadScriptPayload = z.object({
  skillName: z.string(),
  scriptName: z.string(),
})

export const skillsInstallPayload = z.object({
  owner: z.string(),
  repo: z.string(),
  skillPath: z.string(),
})

export const skillsInstallMarketplacePayload = z.object({
  id: z.string(),
  skillId: z.string(),
  name: z.string(),
  installs: z.number(),
  source: z.string(),
  description: z.string().optional(),
})

// ── sandbox ─────────────────────────────────────────────────────────────────

export const sandboxInitPayload = z.object({ workingDirectory: z.string() })

export const sandboxExecPayload = z.object({
  command: z.string(),
  timeout: z.number().positive().finite().optional(),
  cwd: z.string().optional(),
})

export const sandboxReadPayload = z.object({ filePath: z.string() })

export const sandboxWritePayload = z.object({ filePath: z.string(), content: z.string() })

export const sandboxEditPayload = z.object({
  filePath: z.string(),
  search: z.string(),
  replace: z.string(),
})

export const sandboxLsPayload = z.object({ dirPath: z.string() })

export const sandboxGrepPayload = z.object({
  pattern: z.string(),
  dirPath: z.string().optional(),
  include: z.string().optional(),
})

export const sandboxFindPayload = z.object({ dirPath: z.string(), pattern: z.string().optional() })

// ── mcp stdio transport ─────────────────────────────────────────────────────

// Only the fields the handler actually consumes (command/args/env feed the
// approval fingerprint and the spawn); everything else a renderer might
// attach to StdioServerParameters is stripped.
export const mcpStdioCreatePayload = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

export const mcpStdioCreateMetaPayload = z.object({ name: z.string().optional() }).optional()

export const mcpTransportIdPayload = z.string().min(1)
