import { Spotlight, type SpotlightActionData, type SpotlightActionGroupData } from '@mantine/spotlight'
import { Theme } from '@shared/types'
import {
  IconMessageCirclePlus,
  IconMessages,
  IconMoon,
  IconPhoto,
  IconPhotoPlus,
  IconSearch,
  IconServerBolt,
  IconSettings,
  IconSun,
} from '@tabler/icons-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { navigateToSettings } from '@/modals/Settings'
import { router } from '@/router'
import { useSessionList } from '@/stores/chatStore'
import { switchCurrentSession } from '@/stores/sessionActions'
import { settingsStore } from '@/stores/settingsStore'
import { uiStore, useUIStore } from '@/stores/uiStore'
import { commandPalette, commandPaletteStore } from './commandPaletteStore'

export default function CommandPalette() {
  const { t } = useTranslation()
  const { sessionMetaList } = useSessionList()
  const realTheme = useUIStore((s) => s.realTheme)

  const actions = useMemo<SpotlightActionGroupData[]>(() => {
    const commands: SpotlightActionData[] = [
      {
        id: 'new-chat',
        label: String(t('New Chat')),
        description: String(t('Start a new conversation')),
        onClick: () => {
          commandPalette.close()
          router.navigate({ to: '/' })
        },
        leftSection: <ScalableIcon icon={IconMessageCirclePlus} size={20} className="text-workspaice-tint-brand" />,
      },
      {
        id: 'new-image',
        label: String(t('Create Image')),
        description: String(t('Open the image creator')),
        onClick: () => {
          commandPalette.close()
          router.navigate({ to: '/image-creator' })
        },
        leftSection: <ScalableIcon icon={IconPhotoPlus} size={20} className="text-workspaice-tint-brand" />,
      },
      {
        id: 'search-conversations',
        label: String(t('Search All Conversations')),
        description: String(t('Full-text search across your chats')),
        onClick: () => {
          commandPalette.close()
          uiStore.getState().setOpenSearchDialog(true, true)
        },
        leftSection: <ScalableIcon icon={IconSearch} size={20} className="text-workspaice-tint-brand" />,
      },
      {
        id: 'toggle-theme',
        label: String(realTheme === 'dark' ? t('Switch to Light Theme') : t('Switch to Dark Theme')),
        onClick: () => {
          commandPalette.close()
          settingsStore.getState().setSettings({ theme: realTheme === 'dark' ? Theme.Light : Theme.Dark })
        },
        leftSection: (
          <ScalableIcon
            icon={realTheme === 'dark' ? IconSun : IconMoon}
            size={20}
            className="text-workspaice-tint-brand"
          />
        ),
      },
      {
        id: 'settings',
        label: String(t('Settings')),
        onClick: () => {
          commandPalette.close()
          navigateToSettings()
        },
        leftSection: <ScalableIcon icon={IconSettings} size={20} className="text-workspaice-tint-brand" />,
      },
      {
        id: 'settings-provider',
        label: String(t('Provider Settings')),
        description: String(t('Configure AI providers and models')),
        onClick: () => {
          commandPalette.close()
          navigateToSettings('/provider')
        },
        leftSection: <ScalableIcon icon={IconServerBolt} size={20} className="text-workspaice-tint-brand" />,
      },
    ]

    const sessions: SpotlightActionData[] = (sessionMetaList ?? []).map((meta) => ({
      id: `session-${meta.id}`,
      label: String(meta.name || t('Untitled')),
      onClick: () => {
        commandPalette.close()
        switchCurrentSession(meta.id)
      },
      leftSection: (
        <ScalableIcon
          icon={meta.type === 'picture' ? IconPhoto : IconMessages}
          size={20}
          className="text-workspaice-tint-secondary"
        />
      ),
    }))

    return [
      { group: String(t('Commands')), actions: commands },
      ...(sessions.length > 0 ? [{ group: String(t('Conversations')), actions: sessions }] : []),
    ]
  }, [t, sessionMetaList, realTheme])

  return (
    <Spotlight
      store={commandPaletteStore}
      actions={actions}
      nothingFound={String(t('Nothing found...'))}
      highlightQuery
      scrollable
      maxHeight="min(480px, calc(100vh - 180px))"
      shortcut={null}
      searchProps={{
        leftSection: <ScalableIcon icon={IconSearch} size={20} stroke={1.5} />,
        placeholder: String(t('Type a command or search conversations...')),
      }}
    />
  )
}
