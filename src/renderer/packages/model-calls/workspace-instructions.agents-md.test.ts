import { describe, expect, it } from 'vitest'
import {
  buildAgentsMdBlock,
  buildGlobalAgentsMdInstructions,
  buildSessionAgentsMdInstructions,
  GLOBAL_AGENTS_MD_MAX_CHARS,
  SESSION_AGENTS_MD_MAX_CHARS,
} from './workspace-instructions'

describe('buildAgentsMdBlock', () => {
  it('wraps content in an AGENTS_MD envelope with the escaped path', () => {
    expect(buildAgentsMdBlock('  line one\nline two  ', 'global')).toBe(
      '<AGENTS_MD path="global">\nline one\nline two\n</AGENTS_MD>'
    )
  })

  it('escapes backslashes and quotes in the path', () => {
    const block = buildAgentsMdBlock('x', 'C:\\work\\dir "quoted"')
    expect(block.startsWith('<AGENTS_MD path="C:/work/dir &quot;quoted&quot;">')).toBe(true)
  })
})

describe('buildGlobalAgentsMdInstructions', () => {
  it('returns empty string when disabled', () => {
    expect(buildGlobalAgentsMdInstructions({ enabled: false, content: 'protocol' })).toBe('')
    expect(buildGlobalAgentsMdInstructions(undefined)).toBe('')
  })

  it('returns empty string when enabled but content is blank', () => {
    expect(buildGlobalAgentsMdInstructions({ enabled: true, content: '   \n ' })).toBe('')
  })

  it('injects the protocol block with the global path when enabled', () => {
    const block = buildGlobalAgentsMdInstructions({ enabled: true, content: 'Prove honestly.' })
    expect(block).toContain('## AGENTS.md (Global Workspace Protocol)')
    expect(block).toContain('<AGENTS_MD path="global">\nProve honestly.\n</AGENTS_MD>')
  })

  it('truncates oversized content to the global cap', () => {
    const block = buildGlobalAgentsMdInstructions({ enabled: true, content: 'x'.repeat(GLOBAL_AGENTS_MD_MAX_CHARS + 10) })
    expect(block.length).toBeLessThan(GLOBAL_AGENTS_MD_MAX_CHARS + 500)
    expect(block).not.toContain('x'.repeat(GLOBAL_AGENTS_MD_MAX_CHARS + 10))
  })
})

describe('buildSessionAgentsMdInstructions', () => {
  it('returns empty string for blank content', () => {
    expect(buildSessionAgentsMdInstructions('  ')).toBe('')
  })

  it('injects the workspace block when content exists', () => {
    const block = buildSessionAgentsMdInstructions('Session rule.')
    expect(block).toContain('## AGENTS.md (Session Workspace)')
    expect(block).toContain('<AGENTS_MD path="workspace">\nSession rule.\n</AGENTS_MD>')
  })

  it('truncates oversized content to the session cap', () => {
    const block = buildSessionAgentsMdInstructions('y'.repeat(SESSION_AGENTS_MD_MAX_CHARS + 10))
    expect(block.length).toBeLessThan(SESSION_AGENTS_MD_MAX_CHARS + 500)
  })
})
