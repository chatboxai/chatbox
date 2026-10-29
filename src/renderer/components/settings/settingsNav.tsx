import { DEFAULT_COMPACTION_THRESHOLD } from '@chatbox/core/application/token-estimation/math'
import { TestId } from '@shared/automation/testids'
import { Theme } from '@shared/types'
import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION } from '@shared/utils/tool-call-limit-pause'
import {
  IconBook,
  IconBrain,
  IconCategory,
  IconCircleDottedLetterM,
  IconDatabase,
  IconFileText,
  IconInfoCircle,
  IconKeyboard,
  IconListDetails,
  IconMessages,
  IconPalette,
  type IconProps,
  IconRobotFace,
  IconSparkles,
  IconStack2,
  IconTool,
  IconWand,
  IconWorldWww,
} from '@tabler/icons-react'
import type { ElementType } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviders } from '@/hooks/useProviders'
import useVersion from '@/hooks/useVersion'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { featureFlags } from '@/utils/feature-flags'

export type SettingsPageKey =
  | 'chatbox-ai'
  | 'provider'
  | 'default-models'
  | 'web-search'
  | 'mcp'
  | 'knowledge-base'
  | 'skills'
  | 'agent'
  | 'document-parser'
  | 'chat'
  | 'context'
  | 'appearance'
  | 'hotkeys'
  | 'data'
  | 'advanced'
  | 'about'

export interface SettingsNavItem {
  key: SettingsPageKey
  label: string
  /** Product names such as "MCP" and "Skills" are shown as-is. */
  noTranslate?: boolean
  icon: ElementType<IconProps>
  testId?: string
}

export interface SettingsNavGroup {
  title: string
  items: SettingsNavItem[]
}

/** Settings navigation shared by the desktop sidebar, the small-screen index and settings search. */
export function getSettingsNavGroups(): SettingsNavGroup[] {
  const capabilities: SettingsNavItem[] = [
    { key: 'web-search', label: 'Web Search', icon: IconWorldWww },
    ...(featureFlags.mcp
      ? [{ key: 'mcp' as const, label: 'MCP', noTranslate: true, icon: IconCircleDottedLetterM }]
      : []),
    ...(featureFlags.knowledgeBase
      ? [{ key: 'knowledge-base' as const, label: 'Knowledge Base', icon: IconBook }]
      : []),
    ...(featureFlags.skills || platform.type === 'mobile'
      ? [{ key: 'skills' as const, label: 'Skills', noTranslate: true, icon: IconWand }]
      : []),
    // Memory works on every platform, so the page stays reachable where agent mode does not
    // run — narrowed there to the memory controls it can actually offer.
    featureFlags.agentMode
      ? { key: 'agent', label: 'Agent & Memory', icon: IconRobotFace }
      : { key: 'agent', label: 'Memory', icon: IconBrain },
    { key: 'document-parser', label: 'Document Parser', icon: IconFileText },
  ]

  return [
    { title: 'Account', items: [{ key: 'chatbox-ai', label: 'Chatbox AI', noTranslate: true, icon: IconSparkles }] },
    {
      title: 'Models',
      items: [
        { key: 'provider', label: 'Model Provider', icon: IconCategory },
        {
          key: 'default-models',
          label: 'Default Models',
          icon: IconListDetails,
          testId: TestId.settings.navDefaultModels,
        },
      ],
    },
    { title: 'Capabilities', items: capabilities },
    {
      title: 'Chat',
      items: [
        { key: 'chat', label: 'Chat', icon: IconMessages, testId: TestId.settings.navChat },
        { key: 'context', label: 'Context & Compaction', icon: IconStack2, testId: TestId.settings.navContext },
      ],
    },
    {
      title: 'App',
      items: [
        { key: 'appearance', label: 'Appearance', icon: IconPalette, testId: TestId.settings.navAppearance },
        ...(platform.type === 'mobile'
          ? []
          : [{ key: 'hotkeys' as const, label: 'Keyboard Shortcuts', icon: IconKeyboard }]),
        { key: 'data', label: 'Data & Backup', icon: IconDatabase, testId: TestId.settings.navData },
        { key: 'advanced', label: 'Advanced', icon: IconTool, testId: TestId.settings.navAdvanced },
        { key: 'about', label: 'About & Updates', icon: IconInfoCircle, testId: TestId.settings.navAbout },
      ],
    },
  ]
}

/** Pages reached from a settings page rather than the navigation, mapped to their nav entry. */
const NESTED_PAGES: Record<string, SettingsPageKey> = {
  'app-icon': 'appearance',
  archive: 'data',
  general: 'appearance',
}

export function settingsNavKeyForSection(section: string | undefined): string | undefined {
  if (!section) return undefined
  return NESTED_PAGES[section] ?? section
}

export interface SettingsSearchEntry {
  /** Row anchor; the page itself when absent. */
  id?: string
  page: SettingsPageKey
  label: string
  labelOptions?: Record<string, unknown>
}

/**
 * Rows reachable from settings search, keyed by their English label. Pages are indexed too, so a
 * search for a page name lands on the page.
 */
export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { page: 'chat', id: 'system-prompt', label: 'System prompt' },
  { page: 'chat', id: 'max-context', label: 'Context message limit' },
  { page: 'chat', id: 'temperature', label: 'Temperature' },
  { page: 'chat', id: 'top-p', label: 'Top P' },
  { page: 'chat', id: 'stream', label: 'Stream output' },
  { page: 'chat', id: 'message-layout', label: 'Message layout' },
  { page: 'chat', id: 'message-meta', label: 'Show below messages' },
  { page: 'chat', id: 'show-avatar', label: 'Show Avatar' },
  { page: 'chat', id: 'hide-system-prompt', label: 'Hide system prompt' },
  { page: 'chat', id: 'auto-scroll', label: 'Auto-scroll new messages to top' },
  { page: 'chat', id: 'auto-title', label: 'Auto-Generate Chat Titles' },
  {
    page: 'chat',
    id: 'pause-on-tool-call-limit',
    label: 'Pause after every {{count}} steps',
    labelOptions: { count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION },
  },
  { page: 'chat', id: 'spell-check', label: 'Spell Check' },
  { page: 'chat', id: 'paste-long-text', label: 'Paste long text as a file' },
  { page: 'chat', id: 'inject-metadata', label: 'Inject default metadata' },
  { page: 'chat', id: 'markdown', label: 'Markdown Rendering' },
  { page: 'chat', id: 'latex', label: 'LaTeX Rendering' },
  { page: 'chat', id: 'mermaid', label: 'Mermaid Diagrams & Charts Rendering' },
  { page: 'chat', id: 'auto-collapse-code', label: 'Auto-collapse code blocks' },
  { page: 'chat', id: 'auto-preview-artifacts', label: 'Auto-preview artifacts' },
  { page: 'context', id: 'auto-compaction', label: 'Auto Compaction' },
  { page: 'context', id: 'compaction-threshold', label: 'Compaction Threshold' },
  { page: 'context', id: 'compaction-prompt', label: 'Compaction Prompt' },
  { page: 'web-search', id: 'search-provider', label: 'Search Provider' },
  ...(featureFlags.agentMode
    ? ([{ page: 'agent', id: 'smart-switching', label: 'Smart Switching' }] satisfies SettingsSearchEntry[])
    : []),
  { page: 'agent', id: 'memory', label: 'Memory' },
  { page: 'document-parser', id: 'parser-type', label: 'Parser Type' },
  { page: 'appearance', id: 'theme', label: 'Theme' },
  { page: 'appearance', id: 'language', label: 'Language' },
  { page: 'appearance', id: 'theme-color', label: 'Theme color' },
  { page: 'appearance', id: 'font-size', label: 'Font Size' },
  { page: 'appearance', id: 'startup-page', label: 'Startup Page' },
  { page: 'appearance', id: 'user-avatar', label: 'User Avatar' },
  { page: 'appearance', id: 'assistant-avatar', label: 'Default Assistant Avatar' },
  { page: 'appearance', id: 'background-image', label: 'Background Image' },
  { page: 'data', id: 'recover-sessions', label: 'Recover Conversation List' },
  { page: 'data', id: 'export-data', label: 'Export Data' },
  { page: 'data', id: 'import-data', label: 'Import Backup' },
  { page: 'data', id: 'archived-chats', label: 'Archived Chats' },
  { page: 'advanced', id: 'proxy', label: 'Network Proxy' },
  { page: 'advanced', id: 'diagnostic-logs', label: 'Diagnostic Logs' },
  { page: 'advanced', id: 'error-reporting', label: 'Error Reporting' },
  ...(platform.type === 'desktop'
    ? ([
        { page: 'about', id: 'auto-launch', label: 'Launch at system startup' },
        { page: 'about', id: 'auto-update', label: 'Automatic updates' },
        { page: 'about', id: 'beta-update', label: 'Beta updates' },
      ] satisfies SettingsSearchEntry[])
    : []),
]

/** Current value shown beside a page on the small-screen settings index. */
export function useSettingsNavMeta(): Partial<Record<SettingsPageKey, string>> {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const version = useVersion()
  const theme = useSettingsStore((s) => s.theme)
  const compactionThreshold = useSettingsStore((s) => s.compactionThreshold)
  const autoCompaction = useSettingsStore((s) => s.autoCompaction)
  const defaultChatModelId = useSettingsStore((s) => s.defaultChatModel?.model)

  return {
    provider: providers.length > 0 ? String(t('{{count}} configured', { count: providers.length })) : undefined,
    'default-models': defaultChatModelId,
    context:
      (autoCompaction ?? true)
        ? `${Math.round((compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD) * 100)}%`
        : String(t('Off')),
    appearance: String(
      theme === Theme.Dark ? t('Dark Mode') : theme === Theme.Light ? t('Light Mode') : t('Follow System')
    ),
    about: version.version && /\d/.test(version.version) ? version.version : undefined,
  }
}
