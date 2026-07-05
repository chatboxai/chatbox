import { describe, expect, it } from 'vitest'
import {
  mcpStdioCreateMetaPayload,
  mcpStdioCreatePayload,
  mcpTransportIdPayload,
  parseIpcPayload,
  sandboxExecPayload,
  sandboxInitPayload,
  skillsCreatePayload,
  skillsExecuteScriptPayload,
  skillsInstallMarketplacePayload,
  skillsScanRepoPayload,
} from './ipc-payloads'

describe('parseIpcPayload', () => {
  it('returns the parsed value for a valid payload', () => {
    expect(parseIpcPayload('test', sandboxInitPayload, { workingDirectory: '/tmp/x' })).toEqual({
      workingDirectory: '/tmp/x',
    })
  })

  it('throws a channel-labelled error for an invalid payload', () => {
    expect(() => parseIpcPayload('sandbox:init', sandboxInitPayload, { workingDirectory: 42 })).toThrow(
      /Invalid payload for sandbox:init: workingDirectory/
    )
  })

  it('labels root-level type mismatches', () => {
    expect(() => parseIpcPayload('skills:load', mcpTransportIdPayload, null)).toThrow(
      /Invalid payload for skills:load: \(root\)/
    )
  })
})

describe('skills payloads', () => {
  it('accepts a create payload with nullish description/body (handler defaults them)', () => {
    expect(() => parseIpcPayload('skills:create', skillsCreatePayload, { name: 'x', description: null })).not.toThrow()
  })

  it('rejects execute-script args that are not all strings', () => {
    expect(() =>
      parseIpcPayload('skills:execute-script', skillsExecuteScriptPayload, {
        skillName: 'a-skill',
        scriptName: 'run.sh',
        args: ['ok', { evil: true }],
      })
    ).toThrow(/args/)
  })

  it('accepts execute-script without args', () => {
    expect(
      parseIpcPayload('skills:execute-script', skillsExecuteScriptPayload, {
        skillName: 'a-skill',
        scriptName: 'run.sh',
      })
    ).toEqual({ skillName: 'a-skill', scriptName: 'run.sh' })
  })

  it('validates scan-repo positional args as a tuple', () => {
    expect(parseIpcPayload('skills:scan-repo', skillsScanRepoPayload, ['owner', 'repo'])).toEqual(['owner', 'repo'])
    expect(() => parseIpcPayload('skills:scan-repo', skillsScanRepoPayload, ['owner', 7])).toThrow(/1/)
  })

  it('strips unknown fields from marketplace skill payloads', () => {
    const parsed = parseIpcPayload('skills:install-marketplace', skillsInstallMarketplacePayload, {
      id: '1',
      skillId: 's',
      name: 'n',
      installs: 3,
      source: 'https://example.com',
      __proto__polluter: 'x',
    })
    expect(parsed).toEqual({ id: '1', skillId: 's', name: 'n', installs: 3, source: 'https://example.com' })
  })
})

describe('sandbox payloads', () => {
  it('rejects a non-numeric exec timeout', () => {
    expect(() => parseIpcPayload('sandbox:exec', sandboxExecPayload, { command: 'ls', timeout: '9001' })).toThrow(
      /timeout/
    )
  })

  it('accepts exec with only a command', () => {
    expect(parseIpcPayload('sandbox:exec', sandboxExecPayload, { command: 'ls' })).toEqual({ command: 'ls' })
  })
})

describe('mcp stdio payloads', () => {
  it('strips fields the handler does not consume (cwd, stderr)', () => {
    const parsed = parseIpcPayload('mcp:stdio-transport:create', mcpStdioCreatePayload, {
      command: 'npx',
      args: ['-y', 'some-server'],
      env: { FOO: 'bar' },
      cwd: '/somewhere',
      stderr: 'inherit',
    })
    expect(parsed).toEqual({ command: 'npx', args: ['-y', 'some-server'], env: { FOO: 'bar' } })
  })

  it('rejects an empty command and non-string args/env values', () => {
    expect(() => parseIpcPayload('mcp:stdio-transport:create', mcpStdioCreatePayload, { command: '' })).toThrow()
    expect(() =>
      parseIpcPayload('mcp:stdio-transport:create', mcpStdioCreatePayload, { command: 'npx', args: [1] })
    ).toThrow()
    expect(() =>
      parseIpcPayload('mcp:stdio-transport:create', mcpStdioCreatePayload, { command: 'npx', env: { A: 1 } })
    ).toThrow()
  })

  it('accepts absent and named meta', () => {
    expect(parseIpcPayload('mcp:stdio-transport:create (meta)', mcpStdioCreateMetaPayload, undefined)).toBeUndefined()
    expect(parseIpcPayload('mcp:stdio-transport:create (meta)', mcpStdioCreateMetaPayload, { name: 'ctx7' })).toEqual({
      name: 'ctx7',
    })
  })
})
