import { translationResources } from '@chatbox/i18n'
import { describe, expect, it } from 'vitest'
import {
  classifyWorkActivity,
  countWorkActivity,
  dominantWorkActivity,
  summarizeWorkActivity,
  type WorkActivityStep,
  workActivityPhraseKeys,
  workActivitySeparator,
} from './work-activity'

// Mirrors how the app interpolates a phrase, so expectations read like the UI.
const t = (key: string, options?: { count?: number }) => key.replace('{{count}}', String(options?.count ?? ''))

const toolCall = (toolName: string, args?: unknown): WorkActivityStep => ({ type: 'tool-call', toolName, args })

describe('classifyWorkActivity', () => {
  it.each([
    ['read_file', 'files'],
    ['search_file_content', 'fileSearch'],
    ['list_files', 'fileSearch'],
    ['query_knowledge_base', 'fileSearch'],
    ['run_command', 'commands'],
    ['user_exec', 'commands'],
    ['write_file', 'edits'],
    ['edit_file', 'edits'],
    ['web_search', 'webSearch'],
    ['parse_link', 'pages'],
    ['load_skill', 'tools'],
    ['mcp__github__create_issue', 'tools'],
  ])('reads %s as %s', (toolName, action) => {
    expect(classifyWorkActivity(toolName)).toBe(action)
  })

  it.each(['status', 'history', 'models'])('does not count image %s as generation', (command) => {
    expect(classifyWorkActivity('chatbox_cli', { argv: ['image', command] })).toBe('tools')
  })

  it('reads a CLI image task as an image, and any other CLI task as a tool', () => {
    expect(classifyWorkActivity('chatbox_cli', { argv: ['image', 'generate', 'a cat'] })).toBe('images')
    expect(classifyWorkActivity('chatbox_cli', { argv: ['chats', 'list'] })).toBe('tools')
  })

  it('counts browser reads and screenshots as pages and scripts as tools', () => {
    expect(classifyWorkActivity('browser', { command: 'read', url: 'https://example.com' })).toBe('pages')
    expect(classifyWorkActivity('browser', { command: 'screenshot' })).toBe('pages')
    expect(classifyWorkActivity('browser', { command: 'run', url: 'https://example.com', code: 'return 1' })).toBe(
      'tools'
    )
  })

  it('counts knowledge base searches and listings as file searches and reads as files', () => {
    expect(classifyWorkActivity('knowledge_base', { command: 'search', query: 'pricing' })).toBe('fileSearch')
    expect(classifyWorkActivity('knowledge_base', { command: 'list' })).toBe('fileSearch')
    expect(classifyWorkActivity('knowledge_base', { command: 'read', fileId: 7 })).toBe('files')
  })
})

describe('dominantWorkActivity', () => {
  it('picks the action a run performed most', () => {
    expect(dominantWorkActivity([toolCall('read_file'), toolCall('run_command'), toolCall('run_command')])).toBe(
      'commands'
    )
  })

  it('picks the earliest action on a tie', () => {
    expect(dominantWorkActivity([toolCall('web_search'), toolCall('run_command')])).toBe('webSearch')
  })

  it('falls back to a generic tool when the run has no tool calls', () => {
    expect(dominantWorkActivity([{ type: 'reasoning', text: 'thinking' }])).toBe('tools')
  })
})

describe('countWorkActivity', () => {
  it('counts each action in the order it first appeared', () => {
    const counts = countWorkActivity([
      { type: 'reasoning', text: 'First look around.' },
      toolCall('read_file'),
      toolCall('search_file_content'),
      toolCall('run_command'),
      toolCall('read_file'),
    ])

    expect(counts).toEqual([
      { action: 'files', count: 2 },
      { action: 'fileSearch', count: 1 },
      { action: 'commands', count: 1 },
    ])
  })
})

describe('summarizeWorkActivity', () => {
  it('names the actions the run performed and counts repeats', () => {
    const summary = summarizeWorkActivity(
      [
        toolCall('read_file'),
        toolCall('read_file'),
        toolCall('run_command'),
        { type: 'reasoning', text: 'Checking the search results.' },
        toolCall('web_search'),
      ],
      t
    )

    expect(summary).toBe('Read 2 files, ran a command, searched the web')
  })

  it('stops naming actions after four and counts the rest', () => {
    const run: WorkActivityStep[] = [
      toolCall('read_file'),
      toolCall('run_command'),
      toolCall('edit_file'),
      toolCall('web_search'),
      toolCall('parse_link'),
      toolCall('load_skill'),
    ]

    expect(summarizeWorkActivity(run, t)).toBe(
      'Read a file, ran a command, edited a file, searched the web, and 2 more'
    )
  })

  it('names every action when a run stays within the named limit', () => {
    const run: WorkActivityStep[] = [
      toolCall('read_file'),
      toolCall('run_command'),
      toolCall('edit_file'),
      toolCall('web_search'),
    ]

    expect(summarizeWorkActivity(run, t)).toBe('Read a file, ran a command, edited a file, searched the web')
  })

  it('stays one informative line for a long run that never narrates', () => {
    // A model can grind through dozens of steps without emitting text: everything
    // folds into one row, so the row has to name the work, not just its first tool.
    const run: WorkActivityStep[] = [
      ...Array.from({ length: 12 }, (_, index) => toolCall('read_file', { path: `src/file-${index}.ts` })),
      ...Array.from({ length: 8 }, () => toolCall('run_command', { command: 'pnpm test' })),
      ...Array.from({ length: 3 }, (_, index) => toolCall('edit_file', { path: `src/edit-${index}.ts` })),
      toolCall('web_search'),
      toolCall('parse_link'),
      toolCall('load_skill'),
      { type: 'reasoning', text: 'Verifying the patch.' },
    ]

    expect(summarizeWorkActivity(run, t)).toBe(
      'Read 12 files, ran 8 commands, edited 3 files, searched the web, and 2 more'
    )
    expect(countWorkActivity(run).reduce((total, segment) => total + segment.count, 0)).toBe(26)
  })

  it('joins actions the way the locale lists them', () => {
    const steps = [toolCall('read_file'), toolCall('run_command')]

    expect(summarizeWorkActivity(steps, t, 'en')).toBe('Read a file, ran a command')
    expect(summarizeWorkActivity(steps, t, 'zh-Hans')).toBe('Read a file、ran a command')
    expect(workActivitySeparator(undefined)).toBe(', ')
    expect(workActivitySeparator('ja')).toBe('、')
  })
})

describe('work activity phrases', () => {
  it('has an English source for every phrase the summary asks for', () => {
    const english = translationResources.en.translation as Record<string, string>

    expect(workActivityPhraseKeys.filter((key) => !english[key])).toEqual([])
  })
})
