import type { ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import type { SkillInfo } from '@shared/types/skills'
import { describe, expect, it, vi } from 'vitest'
import { getToolSet as getSessionAttachmentRagToolSet } from '@/packages/model-calls/toolsets/session-attachment-rag'
import { buildToolsForSession, generateSkillsXml, normalizeToolSetErrors } from '@/stores/session/tools-builder'

const mockSettings = vi.hoisted(() => ({
  provider: 'bing',
}))

vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: () => ({
    webSearch: {
      provider: mockSettings.provider,
    },
  }),
}))

vi.mock('@/packages/model-calls/toolsets/session-attachment-rag', () => ({
  getToolSet: vi.fn(async (attachmentIds: number[]) => ({
    description: [
      `<session_attachment_rag ids="${attachmentIds.join(',')}">`,
      'Use retrieval tools.',
      '</session_attachment_rag>',
    ].join(''),
    tools: {
      query_session_attachment: {
        description: 'mock query tool',
      },
    },
  })),
}))

function makeSkill(name: string, description: string): SkillInfo {
  return {
    name,
    description,
    path: `/skills/${name}`,
    isBuiltin: false,
  }
}

describe('generateSkillsXml', () => {
  it('should generate valid XML containing skill names and descriptions', () => {
    const skills: SkillInfo[] = [
      makeSkill('code-review', 'Review code for bugs and improvements'),
      makeSkill('translation', 'Translate text between languages'),
    ]

    const xml = generateSkillsXml(skills)

    expect(xml).toContain('<available_skills>')
    expect(xml).toContain('</available_skills>')
    expect(xml).toContain('<name>code-review</name>')
    expect(xml).toContain('<description>Review code for bugs and improvements</description>')
    expect(xml).toContain('<name>translation</name>')
    expect(xml).toContain('<description>Translate text between languages</description>')
  })

  it('should include all enabled skills', () => {
    const skills: SkillInfo[] = [
      makeSkill('skill-a', 'Description A'),
      makeSkill('skill-b', 'Description B'),
      makeSkill('skill-c', 'Description C'),
    ]

    const xml = generateSkillsXml(skills)

    const skillTagCount = (xml.match(/<skill>/g) || []).length
    expect(skillTagCount).toBe(3)
  })

  it('should handle empty skills array', () => {
    const xml = generateSkillsXml([])

    expect(xml).toContain('<available_skills>')
    expect(xml).toContain('</available_skills>')
    expect(xml).not.toContain('<skill>')
  })

  it('should include load_skill usage instruction when toolUseSupported is true', () => {
    const xml = generateSkillsXml([makeSkill('test', 'Test skill')], true)

    expect(xml).toContain('load_skill')
  })

  it('should not include load_skill usage instruction when toolUseSupported is false', () => {
    const xml = generateSkillsXml([makeSkill('test', 'Test skill')])

    expect(xml).not.toContain('load_skill')
  })

  it('should handle single skill', () => {
    const xml = generateSkillsXml([makeSkill('only-one', 'The only skill')])

    expect(xml).toContain('<name>only-one</name>')
    expect(xml).toContain('<description>The only skill</description>')
    const skillTagCount = (xml.match(/<skill>/g) || []).length
    expect(skillTagCount).toBe(1)
  })

  it('should escape XML special characters in skill names and descriptions', () => {
    const skills: SkillInfo[] = [makeSkill('a&b<c>', 'Use & and < and > in descriptions')]

    const xml = generateSkillsXml(skills)

    expect(xml).toContain('<name>a&amp;b&lt;c&gt;</name>')
    expect(xml).toContain('<description>Use &amp; and &lt; and &gt; in descriptions</description>')
  })
})

describe('buildToolsForSession session attachment RAG', () => {
  function makeModel(toolUseSupported = true): ModelInterface {
    return {
      name: 'mock',
      modelId: 'mock-model',
      isSupportVision: () => false,
      isSupportToolUse: () => toolUseSupported,
      isSupportSystemMessage: () => true,
      chat: vi.fn(),
      chatStream: vi.fn(),
      paint: vi.fn(),
    } as unknown as ModelInterface
  }

  it('should add session attachment RAG tools and system instructions for retrieval attachments', async () => {
    const messages: Message[] = [
      {
        id: 'm1',
        role: 'user',
        timestamp: Date.now(),
        contentParts: [{ type: 'text', text: 'What does the uploaded manual say?' }],
        files: [
          {
            id: 'f1',
            name: 'manual.md',
            fileType: 'text/markdown',
            ragMode: 'session-retrieval',
            sessionAttachmentId: 42,
            sessionAttachmentAvailability: 'allowed',
            sessionAttachmentIndexStatus: 'ready',
          },
        ],
      },
    ]

    const result = await buildToolsForSession(makeModel(true), {
      webBrowsing: false,
      messages,
    })

    expect(getSessionAttachmentRagToolSet).toHaveBeenCalledWith([42])
    expect(result.instructions).toContain('session_attachment_rag')
    expect(result.instructions).toContain('Use retrieval tools')
    expect(result.tools).toHaveProperty('query_session_attachment')
  })

  it('should not add session attachment RAG tools when the model cannot use tools', async () => {
    const messages: Message[] = [
      {
        id: 'm1',
        role: 'user',
        timestamp: Date.now(),
        contentParts: [{ type: 'text', text: 'What does the uploaded manual say?' }],
        files: [
          {
            id: 'f1',
            name: 'manual.md',
            fileType: 'text/markdown',
            ragMode: 'session-retrieval',
            sessionAttachmentId: 42,
            sessionAttachmentAvailability: 'allowed',
            sessionAttachmentIndexStatus: 'ready',
          },
        ],
      },
    ]

    const result = await buildToolsForSession(makeModel(false), {
      webBrowsing: false,
      messages,
    })

    expect(result.instructions).not.toContain('session_attachment_rag')
    expect(result.tools).not.toHaveProperty('query_session_attachment')
  })
})

describe('normalizeToolSetErrors', () => {
  type AnyToolSet = Parameters<typeof normalizeToolSetErrors>[0]
  const callOptions = { toolCallId: 'tc1', messages: [] } as never

  it('passes successful results through unchanged', async () => {
    const tools = normalizeToolSetErrors({
      ok_tool: { execute: () => Promise.resolve({ value: 42 }) },
    } as unknown as AnyToolSet)

    await expect(tools.ok_tool.execute?.({}, callOptions)).resolves.toEqual({ value: 42 })
  })

  it('rethrows Error throws unchanged', async () => {
    const boom = new Error('backend unavailable')
    const tools = normalizeToolSetErrors({
      failing_tool: {
        execute: () => Promise.reject(boom),
      },
    } as unknown as AnyToolSet)

    await expect(tools.failing_tool.execute?.({}, callOptions)).rejects.toBe(boom)
  })

  it('wraps non-Error throws into an Error naming the tool', async () => {
    const tools = normalizeToolSetErrors({
      stringy_tool: {
        execute: () => Promise.reject('plain string failure'),
      },
    } as unknown as AnyToolSet)

    await expect(tools.stringy_tool.execute?.({}, callOptions)).rejects.toThrow(
      'Tool "stringy_tool" failed: plain string failure'
    )
  })

  it('converts returned Error instances into throws (legacy MCP return-err pattern)', async () => {
    const returned = new Error('mcp server exploded')
    const tools = normalizeToolSetErrors({
      mcp__srv__tool: { execute: () => Promise.resolve(returned) },
    } as unknown as AnyToolSet)

    await expect(tools.mcp__srv__tool.execute?.({}, callOptions)).rejects.toBe(returned)
  })

  it('lets AbortError pass through untouched', async () => {
    const abort = new DOMException('Aborted', 'AbortError')
    const tools = normalizeToolSetErrors({
      slow_tool: {
        execute: () => Promise.reject(abort),
      },
    } as unknown as AnyToolSet)

    await expect(tools.slow_tool.execute?.({}, callOptions)).rejects.toBe(abort)
  })

  it('leaves tools without execute untouched', () => {
    const providerExecuted = { description: 'runs provider-side' }
    const tools = normalizeToolSetErrors({
      provider_tool: providerExecuted,
    } as unknown as AnyToolSet)

    expect(tools.provider_tool).toBe(providerExecuted)
  })
})

describe('buildToolsForSession web search tools', () => {
  function makeModel(toolUseSupported = true): ModelInterface {
    return {
      name: 'mock',
      modelId: 'mock-model',
      isSupportVision: () => false,
      isSupportToolUse: () => toolUseSupported,
      isSupportSystemMessage: () => true,
      chat: vi.fn(),
      chatStream: vi.fn(),
      paint: vi.fn(),
    } as unknown as ModelInterface
  }

  it('should not mention parse_link when the selected search provider does not expose it', async () => {
    mockSettings.provider = 'bing'

    const result = await buildToolsForSession(makeModel(true), {
      webBrowsing: true,
      messages: [],
    })

    expect(result.tools).toHaveProperty('web_search')
    expect(result.tools).not.toHaveProperty('parse_link')
    expect(result.instructions).toContain('web_search')
    expect(result.instructions).not.toContain('parse_link')
  })

  it('should mention parse_link only when the selected search provider exposes it', async () => {
    mockSettings.provider = 'tavily'

    const result = await buildToolsForSession(makeModel(true), {
      webBrowsing: true,
      messages: [],
    })

    expect(result.tools).toHaveProperty('web_search')
    expect(result.tools).toHaveProperty('parse_link')
    expect(result.instructions).toContain('web_search')
    expect(result.instructions).toContain('parse_link')
  })
})
