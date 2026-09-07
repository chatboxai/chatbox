import {
  COPILOT_PROMPT_MAX_CHARS,
  MEMORY_PROMPT_MAX_CHARS,
  SOUL_MAX_CHARS,
  SOUL_VIRTUAL_PATH,
} from '@shared/types/agent-persona'
import { describe, expect, test } from 'vitest'
import {
  boundCopilotPersona,
  buildAgentIdentityPrompt,
  buildAgentPersonaPrompt,
  buildMemoriesSection,
  buildSoulSection,
  DEFAULT_SOUL_PERSONA,
  extractSoulContent,
} from './prompt'

describe('buildAgentIdentityPrompt', () => {
  test('formats desktop macOS', () => {
    const prompt = buildAgentIdentityPrompt({ platformType: 'desktop', os: 'Mac' })
    expect(prompt).toContain('You are Chatbox agent, running inside the Chatbox client.')
    expect(prompt).toContain('Current platform: Desktop (macOS)')
  })

  test('omits unknown OS', () => {
    const prompt = buildAgentIdentityPrompt({ platformType: 'web', os: 'Unknown' })
    expect(prompt).toContain('Current platform: Web')
    expect(prompt).not.toContain('Unknown')
  })
})

describe('extractSoulContent', () => {
  test('treats an unedited template as empty', () => {
    const template = `# Soul

> This file defines who your Chatbox agent is.
> Keep it short and sharp.

## Personality & Tone

<!-- e.g. Concise and direct. -->

## Boundaries

<!-- e.g. Private things stay private. -->
`
    expect(extractSoulContent(template)).toBe('')
  })

  test('keeps user content while preserving structure', () => {
    const soul = `# Soul

## Personality & Tone

Direct, dry humor, no filler.

<!-- guidance comment -->
`
    const extracted = extractSoulContent(soul)
    expect(extracted).toContain('Direct, dry humor, no filler.')
    expect(extracted).not.toContain('guidance comment')
  })
})

describe('buildSoulSection', () => {
  test('falls back to the default persona for empty content', () => {
    expect(buildSoulSection('')).toContain(DEFAULT_SOUL_PERSONA)
  })

  test('references the virtual path for self-editing', () => {
    expect(buildSoulSection('')).toContain(SOUL_VIRTUAL_PATH)
  })

  test('truncates oversized souls with a marker', () => {
    const section = buildSoulSection(`custom persona ${'x'.repeat(SOUL_MAX_CHARS + 100)}`)
    expect(section).toContain('[Soul truncated for context safety]')
    expect(section.length).toBeLessThan(SOUL_MAX_CHARS + 500)
  })

  test('splices a Copilot overlay after the global Soul inside the same section', () => {
    const section = buildSoulSection('Be dry and terse.', 'You are a pirate copilot. Always say arr.')
    const soulIx = section.indexOf('Be dry and terse.')
    const overlayIx = section.indexOf('You are a pirate copilot. Always say arr.')
    expect(soulIx).toBeGreaterThan(section.indexOf('<soul>'))
    expect(overlayIx).toBeGreaterThan(soulIx)
    expect(section).toContain('This session is using a Copilot.')
    expect(section).toContain(SOUL_VIRTUAL_PATH)
    expect(section.indexOf('</soul>')).toBeGreaterThan(overlayIx)
  })

  test('keeps the default persona when only a Copilot overlay is present', () => {
    const section = buildSoulSection('', 'You are a pirate copilot.')
    expect(section).toContain(DEFAULT_SOUL_PERSONA)
    expect(section).toContain('You are a pirate copilot.')
  })

  test('ignores blank Copilot overlays', () => {
    const section = buildSoulSection('Be dry and terse.', '   ')
    expect(section).toContain('Be dry and terse.')
    expect(section).not.toContain('This session is using a Copilot.')
  })

  test('keeps a Copilot overlay within the editor budget intact', () => {
    const overlay = `pirate ${'x'.repeat(COPILOT_PROMPT_MAX_CHARS - 20)}`
    const section = buildSoulSection('Be dry and terse.', overlay)
    expect(section).toContain(overlay)
    expect(section).not.toContain('[Copilot truncated for context safety]')
  })

  test('caps an oversized Copilot overlay once, including the truncation marker', () => {
    const overlay = `pirate ${'x'.repeat(COPILOT_PROMPT_MAX_CHARS + 200)}`
    const section = buildSoulSection('Be dry and terse.', overlay)
    expect(section).toContain('[Copilot truncated for context safety]')
    expect(section).not.toContain(overlay)
    expect(section.match(/\[Copilot truncated for context safety\]/g)).toHaveLength(1)
  })
})

describe('boundCopilotPersona', () => {
  test('returns undefined for blank input', () => {
    expect(boundCopilotPersona(undefined)).toBeUndefined()
    expect(boundCopilotPersona('   ')).toBeUndefined()
  })

  test('keeps a 32k-character overlay intact', () => {
    const overlay = 'You are a writing coach. '.padEnd(32_000, 'x')
    expect(overlay).toHaveLength(32_000)
    expect(boundCopilotPersona(overlay)).toBe(overlay)
  })

  test('caps overlay text to the Copilot budget and stays idempotent', () => {
    const overlay = `pirate ${'x'.repeat(COPILOT_PROMPT_MAX_CHARS + 200)}`
    const bounded = boundCopilotPersona(overlay)
    expect(bounded).toBeDefined()
    expect(bounded).toContain('[Copilot truncated for context safety]')
    expect(bounded?.startsWith('pirate ')).toBe(true)
    expect(bounded?.length).toBeLessThan(overlay.length)
    expect(boundCopilotPersona(bounded)).toBe(bounded)
  })
})

describe('buildMemoriesSection', () => {
  test('empty memories produce no section', () => {
    expect(buildMemoriesSection([])).toBe('')
  })

  test('renders entries with ids for delete_memory', () => {
    const section = buildMemoriesSection([{ id: 'm1', content: 'User prefers pnpm', createdAt: 1 }])
    expect(section).toContain('- [m1] User prefers pnpm')
  })

  test('keeps newest entries when over budget and notes omissions', () => {
    const bigEntry = 'y'.repeat(900)
    const memories = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      content: `${i}-${bigEntry}`,
      createdAt: i,
    }))
    const section = buildMemoriesSection(memories)
    expect(section.length).toBeLessThan(MEMORY_PROMPT_MAX_CHARS + 800)
    // Newest survives, oldest is dropped.
    expect(section).toContain('[m19]')
    expect(section).not.toContain('[m0]')
    expect(section).toContain('older memories omitted')
  })
})

describe('buildAgentPersonaPrompt', () => {
  test('orders identity, soul, then memories', () => {
    const prompt = buildAgentPersonaPrompt({
      platformType: 'desktop',
      os: 'Windows',
      soul: 'Persona body text.',
      memories: [{ id: 'm1', content: 'A fact', createdAt: 1 }],
    })
    const identityIx = prompt.indexOf('You are Chatbox agent')
    const soulIx = prompt.indexOf('## Soul')
    const memoriesIx = prompt.indexOf('## Memories')
    expect(identityIx).toBeGreaterThanOrEqual(0)
    expect(soulIx).toBeGreaterThan(identityIx)
    expect(memoriesIx).toBeGreaterThan(soulIx)
  })

  test('places Copilot overlay inside Soul and before Memories', () => {
    const prompt = buildAgentPersonaPrompt({
      platformType: 'desktop',
      os: 'Windows',
      soul: 'Persona body text.',
      copilotPersona: 'You are a pirate copilot.',
      memories: [{ id: 'm1', content: 'A fact', createdAt: 1 }],
    })
    const overlayIx = prompt.indexOf('You are a pirate copilot.')
    expect(overlayIx).toBeGreaterThan(prompt.indexOf('Persona body text.'))
    expect(overlayIx).toBeLessThan(prompt.indexOf('## Memories'))
  })
})
