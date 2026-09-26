/**
 * How a run of tool calls reads in the folded work timeline: what the run *did*,
 * counted per action, so a long run still says something instead of listing tools.
 */

import { BUILT_IN_BROWSER_TOOL_NAME, builtInBrowserCommandOf } from './built-in-browser'
import { KNOWLEDGE_BASE_TOOL_NAME, knowledgeBaseCommandOf } from './tools/knowledge-base'

export type WorkActivityAction =
  | 'commands'
  | 'edits'
  | 'fileSearch'
  | 'files'
  | 'images'
  | 'pages'
  | 'tools'
  | 'webSearch'

export interface WorkActivitySegment {
  action: WorkActivityAction
  count: number
}

/** What naming a step needs: its type, its tool and that tool's arguments. */
export interface WorkActivityStep {
  type: string
  toolName?: string
  args?: unknown
  /** Narration and reasoning carry text; only tool calls are counted. */
  text?: string
}

const FILE_TOOLS = new Set(['parse_file', 'read_file', 'read_file_chunks', 'sandbox_read', 'view_image'])

const FILE_SEARCH_TOOLS = new Set([
  'code_search',
  'file_search',
  'get_files_meta',
  'list_files',
  'query_knowledge_base',
  'sandbox_find',
  'sandbox_grep',
  'sandbox_ls',
  'search_file_content',
  'search_files',
])

const COMMAND_TOOLS = new Set(['code_execution', 'run_command', 'sandbox_bash', 'terminal', 'user_exec'])

const EDIT_TOOLS = new Set([
  'create_download',
  'create_file',
  'delete_file',
  'edit_file',
  'sandbox_edit',
  'sandbox_write',
  'write_file',
])

const WEB_SEARCH_TOOLS = new Set(['web_search'])
const PAGE_TOOLS = new Set(['parse_link'])
const IMAGE_TOOLS = new Set(['create_image', 'generate_image', 'image_generation'])

function isImageCliCall(args: unknown): boolean {
  const argv = (args as { argv?: unknown } | undefined)?.argv
  return Array.isArray(argv) && argv[0] === 'image' && argv[1] === 'generate'
}

/** The action a tool call performs, as the folded run names it. */
export function classifyWorkActivity(toolName: string, args?: unknown): WorkActivityAction {
  if (toolName === 'chatbox_cli') return isImageCliCall(args) ? 'images' : 'tools'
  if (toolName === BUILT_IN_BROWSER_TOOL_NAME) return builtInBrowserCommandOf(args) === 'run' ? 'tools' : 'pages'
  if (toolName === KNOWLEDGE_BASE_TOOL_NAME) return knowledgeBaseCommandOf(args) === 'read' ? 'files' : 'fileSearch'
  if (IMAGE_TOOLS.has(toolName)) return 'images'
  if (COMMAND_TOOLS.has(toolName)) return 'commands'
  if (EDIT_TOOLS.has(toolName)) return 'edits'
  if (WEB_SEARCH_TOOLS.has(toolName)) return 'webSearch'
  if (PAGE_TOOLS.has(toolName)) return 'pages'
  if (FILE_SEARCH_TOOLS.has(toolName)) return 'fileSearch'
  if (FILE_TOOLS.has(toolName)) return 'files'
  return 'tools'
}

/** What a run did, counted per action, in the order the actions first appeared. */
export function countWorkActivity(steps: readonly WorkActivityStep[]): WorkActivitySegment[] {
  const segments: WorkActivitySegment[] = []
  for (const step of steps) {
    if (step.type !== 'tool-call' || !step.toolName) continue
    const action = classifyWorkActivity(step.toolName, step.args)
    const segment = segments.find((candidate) => candidate.action === action)
    if (segment) segment.count += 1
    else segments.push({ action, count: 1 })
  }
  return segments
}

/**
 * The action a folded run is mostly made of, which picks the run's icon: the most
 * frequent one, and the earliest of those on a tie.
 */
export function dominantWorkActivity(steps: readonly WorkActivityStep[]): WorkActivityAction {
  let dominant: WorkActivitySegment | undefined
  for (const segment of countWorkActivity(steps)) {
    if (!dominant || segment.count > dominant.count) dominant = segment
  }
  return dominant?.action ?? 'tools'
}

// One phrase per action, in the voice the work reads in: "read 3 files, ran a command".
// Phrases stay lower case — the summary capitalises the first word it joins.
const ACTIVITY_PHRASES: Record<WorkActivityAction, { one: string; many: string }> = {
  commands: { one: 'ran a command', many: 'ran {{count}} commands' },
  edits: { one: 'edited a file', many: 'edited {{count}} files' },
  fileSearch: { one: 'searched files', many: 'ran {{count}} file searches' },
  files: { one: 'read a file', many: 'read {{count}} files' },
  images: { one: 'generated an image', many: 'generated {{count}} images' },
  pages: { one: 'opened a page', many: 'opened {{count}} pages' },
  tools: { one: 'used a tool', many: 'used {{count}} tools' },
  webSearch: { one: 'searched the web', many: 'ran {{count}} web searches' },
}

/**
 * How many actions a folded run names before it stops listing and counts the rest.
 * Long agent runs reach every action; the row has to stay one readable line.
 */
export const MAX_WORK_ACTIVITY_ACTIONS = 4

/** Stands in for the actions a long run performed beyond the ones it names. */
export const workActivityMoreKey = 'and {{count}} more'

/** Every phrase key a run summary can ask a locale for. */
export const workActivityPhraseKeys: readonly string[] = [
  ...Object.values(ACTIVITY_PHRASES).flatMap((phrases) => [phrases.one, phrases.many]),
  workActivityMoreKey,
]

export type WorkActivityTranslate = (key: string, options?: { count?: number }) => string

/** How a locale joins a list of actions: East Asian copy enumerates with "、". */
export function workActivitySeparator(language: string | undefined): string {
  return /^(zh|ja)/i.test(language ?? '') ? '、' : ', '
}

/**
 * One line naming what a run of tool calls did, joined the way the locale lists items.
 * The first `MAX_WORK_ACTIVITY_ACTIONS` actions are named; whatever is left is counted.
 */
export function summarizeWorkActivity(
  steps: readonly WorkActivityStep[],
  t: WorkActivityTranslate,
  language?: string
): string {
  const segments = countWorkActivity(steps)
  const named = segments.slice(0, MAX_WORK_ACTIVITY_ACTIONS)
  const phrases = named.map(({ action, count }) =>
    count > 1 ? t(ACTIVITY_PHRASES[action].many, { count }) : t(ACTIVITY_PHRASES[action].one)
  )
  const remaining = segments.length - named.length
  if (remaining > 0) phrases.push(t(workActivityMoreKey, { count: remaining }))
  const summary = phrases.join(workActivitySeparator(language))
  // The phrases are written for the middle of a sentence; the row starts one.
  return summary.charAt(0).toUpperCase() + summary.slice(1)
}
